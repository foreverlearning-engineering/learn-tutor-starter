// A small Learn API client for your server. The key is read from the environment
// and never leaves this process. Guide: https://developers.foreverlearning.ai/docs/learn/
import { randomUUID } from 'node:crypto';

const API_VERSION = '2026-12-01';

export type Posture = 'guided' | 'feedback' | 'explain';

export interface SafetyStatus {
  level: 'unknown' | 'clear' | 'watch' | 'warning' | 'critical';
  evaluated: boolean;
  response_action: 'none' | 'support' | 'escalate';
  source: string;
}

export interface Receipt {
  request_id: string;
  session_id: string;
  posture: string;
  turn_index: number;
  billable_units: number;
  charge_micro_usd: number;
  settlement: string;
  safety_level: string;
}

export interface TurnResult {
  request_id: string;
  session_id: string;
  reply: string;
  display: string;
  safety: SafetyStatus;
  receipt: Receipt;
}

export class LearnError extends Error {
  status: number;
  code: string;
  requestId: string;
  constructor(status: number, code: string, message: string, requestId = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

function settings() {
  const key = process.env.FOREVERLEARNING_API_KEY ?? '';
  const base = (process.env.FOREVERLEARNING_BASE_URL ?? 'https://developers-api.foreverlearning.ai/v1').replace(/\/+$/, '');
  const assignment = process.env.FOREVERLEARNING_ASSIGNMENT_ID ?? '';
  return { key, base, assignment };
}

export function isConfigured(): boolean {
  return settings().key.length > 0;
}

function headers(learnerId: string, idempotencyKey?: string): Record<string, string> {
  const { key, assignment } = settings();
  const h: Record<string, string> = {
    Authorization: 'Bearer ' + key,
    'X-User-Id': learnerId,
    'FL-API-Version': API_VERSION,
  };
  if (assignment) h['X-Assignment-Id'] = assignment;
  if (idempotencyKey) {
    h['Idempotency-Key'] = idempotencyKey;
    h['Content-Type'] = 'application/json';
  }
  return h;
}

async function failure(response: Response): Promise<LearnError> {
  let code = 'HTTP_' + response.status;
  let message = 'Learn returned HTTP ' + response.status + '.';
  let requestId = response.headers.get('x-request-id') ?? '';
  try {
    const body = await response.json() as { code?: string; message?: string; request_id?: string };
    if (body.code) code = body.code;
    if (body.message) message = body.message;
    if (body.request_id) requestId = body.request_id;
  } catch { /* keep the HTTP status */ }
  return new LearnError(response.status, code, message, requestId);
}

// Prepare a session. No reply is generated and nothing is charged.
export async function createSession(learnerId: string, setup: Record<string, unknown>): Promise<string> {
  const { base } = settings();
  const response = await fetch(base + '/quest/sessions', {
    method: 'POST',
    headers: headers(learnerId, randomUUID()),
    body: JSON.stringify({ setup }),
  });
  if (!response.ok) throw await failure(response);
  const session = await response.json() as { session_id?: string };
  if (!session.session_id) throw new LearnError(502, 'NO_SESSION', 'Learn did not return a session id.');
  return session.session_id;
}

export interface TurnInput {
  sessionId: string;
  prompt: string;
  // Send the posture on every turn: leaving it out means Guided, except in a Diagnostic
  // session, where null leaves it out so the session stays Diagnostic.
  posture?: Posture | null;
  // 'opening' asks Learn to greet the learner, with an empty prompt. It is a turn like any other.
  operation?: 'turn' | 'opening';
  // Up to four uploaded files (photos of the learner's work) for this turn.
  attachmentIds?: string[];
}

// Upload one file of the learner's work. Free: no reply is generated. The returned id is
// private to this learner and session, and goes with a turn in quest.attachment_ids.
export async function uploadAttachment(learnerId: string, sessionId: string, mediaType: string, base64: string, filename: string): Promise<string> {
  const { base } = settings();
  const response = await fetch(base + '/quest/attachments', {
    method: 'POST',
    headers: headers(learnerId, randomUUID()),
    body: JSON.stringify({ session_id: sessionId, media_type: mediaType, data: base64, filename }),
  });
  if (!response.ok) throw await failure(response);
  const upload = await response.json() as { attachment_id?: string };
  if (!upload.attachment_id) throw new LearnError(502, 'NO_ATTACHMENT', 'Learn did not return an attachment id.');
  return upload.attachment_id;
}

// Send one learner turn and pass on the reply when it arrives. onText receives each part of the
// reply: the "conversation" part (what the tutor says) and the
// "display" part (the hint or working to show, in Markdown). The result is returned
// only after Learn's final "done" event confirms the turn, with its safety status
// and receipt.
export async function sendTurn(
  learnerId: string,
  input: TurnInput,
  onText: (part: 'conversation' | 'display', text: string) => void,
): Promise<TurnResult> {
  const { base } = settings();
  const body = {
    session_id: input.sessionId,
    prompt: input.operation === 'opening' ? '' : input.prompt,
    ...(input.posture === null ? {} : { posture: input.posture ?? 'guided' }),
    quest: {
      operation: input.operation ?? 'turn', requested_support: 'auto', team_dialog: false,
      ...(input.attachmentIds?.length ? { attachment_ids: input.attachmentIds } : {}),
    },
  };
  const response = await fetch(base + '/chat', {
    method: 'POST',
    headers: headers(learnerId, randomUUID()),
    body: JSON.stringify(body),
  });
  if (!response.ok || !response.body) throw await failure(response);

  let requestId = '';
  let sessionId = '';
  let reply = '';
  let display = '';
  let safety: SafetyStatus | undefined;
  let questReceipt: Record<string, unknown> | undefined;
  let commercial: Record<string, any> | undefined;

  const handle = (event: Record<string, any>) => {
    switch (event.type) {
      case 'metadata':
        requestId = event.request_id;
        sessionId = event.sessionId;
        break;
      case 'content':
        if (event.part === 'conversation') {
          reply += event.text;
          onText('conversation', event.text);
        } else if (event.part === 'display') {
          display += event.text;
          onText('display', event.text);
        }
        break;
      case 'safety_status':
        safety = event as SafetyStatus;
        break;
      case 'quest_receipt':
        questReceipt = event.receipt;
        break;
      case 'done':
        commercial = event.commercial;
        break;
      case 'error':
        throw new LearnError(502, event.code ?? 'STREAM_ERROR', event.message ?? 'The turn did not complete.', event.request_id ?? requestId);
      default:
        break; // Unknown future events are ignored, never treated as success.
    }
  };

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (data) handle(JSON.parse(data));
    }
  }

  // A reply is committed only when the final event arrived with the same identity.
  if (!commercial || commercial.request_id !== requestId || !safety || !questReceipt) {
    throw new LearnError(502, 'INCOMPLETE', 'The turn was not confirmed. Look it up with GET /v1/requests/' + requestId + ', as the same learner (X-User-Id), before sending again.', requestId);
  }
  if (sessionId !== input.sessionId) throw new LearnError(502, 'SESSION_MISMATCH', 'The reply belongs to a different session.', requestId);

  return {
    request_id: requestId,
    session_id: sessionId,
    reply,
    display,
    safety,
    receipt: {
      request_id: requestId,
      session_id: sessionId,
      posture: String(questReceipt.posture),
      turn_index: Number(questReceipt.turn_index),
      billable_units: Number(commercial.billable_units),
      charge_micro_usd: Number(commercial.charge?.amount_micro_usd ?? 0),
      settlement: String(commercial.settlement),
      safety_level: safety.level,
    },
  };
}
