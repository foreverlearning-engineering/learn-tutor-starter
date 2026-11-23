// Photos of handwritten work: the learner attaches photos of their page (up to four) and gets
// help on their own lines. Builds on step 2's four kinds of help. A small server that keeps
// the Learn key and a chat page that shows the reply. Node 24+, no packages. npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSession, sendTurn, uploadAttachment, isConfigured, LearnError } from './learn.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// One Learn session per learner. A real app keeps this in its database.
const sessions = new Map<string, { id: string; diagnostic: boolean }>();

// The task for teaching sessions (Guided, Feedback, Explain): practice, so all three fit.
const SETUP = { task: { kind: 'practice', subject: 'Algebra' }, team_dialog: false };
// A Diagnostic session: the posture and the learner's finished work are set when it is prepared.
function diagnosticSetup(finishedWork: string) {
  return {
    task: { kind: 'practice', subject: 'Algebra', assignment: 'A finished practice quiz.' },
    posture: 'diagnostic',
    // The finished work can only be given here, when the session is prepared.
    assessment: {
      schema_version: 'fl.quest.assessment-input.v1',
      goal: 'Find what the learner understands from their finished practice quiz.',
      sources: [{ id: 'quiz', origin: 'submitted_work', text: finishedWork, attachment_id: null, locator: 'finished quiz', availability: 'available' }],
      items: [], targets: [], original_result: '', limitations: [],
    },
    team_dialog: false,
  };
}

const FILES: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/style.css': 'style.css',
};
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

// A pseudonymous learner id kept in a cookie: never a name or an email.
function learnerId(request: IncomingMessage, response: ServerResponse): string {
  const match = /(?:^|;\s*)learner=([A-Za-z0-9_-]{1,128})/.exec(request.headers.cookie ?? '');
  if (match) return match[1];
  const id = 'learner-' + randomUUID();
  response.setHeader('Set-Cookie', 'learner=' + id + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000');
  return id;
}

async function readJson(request: IncomingMessage, limit = 20000): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > limit) throw new Error('Message too long');
  }
  return JSON.parse(raw || '{}');
}

function send(response: ServerResponse, event: string, data: unknown) {
  response.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

// The learner's teaching session (Guided, Feedback, Explain), prepared the first time.
async function teachingSession(learner: string) {
  let session = sessions.get(learner);
  if (!session || session.diagnostic) {
    session = { id: await createSession(learner, SETUP), diagnostic: false };
    sessions.set(learner, session);
  }
  return session;
}

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

// A photo of the learner's work: uploaded to Learn before the turn that uses it. Free.
async function upload(request: IncomingMessage, response: ServerResponse) {
  const learner = learnerId(request, response);
  const { media_type, data, filename } = await readJson(request, 12_000_000);
  if (typeof media_type !== 'string' || !IMAGE_TYPES.includes(media_type) || typeof data !== 'string' || !data || data.length > 11_200_000) {
    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Attach a PNG, JPEG or WebP photo up to 8 MB.' }));
    return;
  }
  try {
    const session = await teachingSession(learner);
    const id = await uploadAttachment(learner, session.id, media_type, data, typeof filename === 'string' ? filename.slice(0, 120) : 'work');
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ attachment_id: id }));
  } catch (error) {
    const e = error instanceof LearnError ? error : new LearnError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Upload failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    response.writeHead(e.status >= 400 && e.status < 600 ? e.status : 502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: e.message, code: e.code }));
  }
}

const KINDS = ['guided', 'feedback', 'explain', 'diagnostic'] as const;
type Kind = typeof KINDS[number];

async function turn(request: IncomingMessage, response: ServerResponse) {
  const learner = learnerId(request, response);
  const { message, kind, attachment_ids } = await readJson(request);
  const attachmentIds = Array.isArray(attachment_ids) ? attachment_ids.filter((a): a is string => typeof a === 'string').slice(0, 4) : [];
  if (typeof message !== 'string' || !message.trim() || !KINDS.includes(kind as Kind)) {
    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Choose a kind of help and type a message first.' }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  try {
    // Guided, Feedback and Explain share one session: the posture goes with each turn.
    // Diagnostic is chosen when the session is prepared, with the finished work, so it gets a
    // session of its own; later Diagnostic messages are the learner's answers, sent with no posture.
    // Starting either kind of session closes the learner's other open one (its closeout is a turn).
    const diagnostic = kind === 'diagnostic';
    let session = sessions.get(learner);
    let opening = false;
    if (!session || session.diagnostic !== diagnostic) {
      // Diagnostic: the learner's finished quiz goes into the session's setup, then the session opens.
      const setup = diagnostic ? diagnosticSetup(message.trim()) : SETUP;
      session = { id: await createSession(learner, setup), diagnostic };
      opening = diagnostic;
      sessions.set(learner, session);
    }
    const posture = diagnostic ? null : kind as 'guided' | 'feedback' | 'explain';
    // Photos go with teaching turns; they belong to the session they were uploaded to.
    const result = await sendTurn(learner, { sessionId: session.id, prompt: opening ? '' : message.trim(), posture, operation: opening ? 'opening' : 'turn', attachmentIds: diagnostic ? [] : attachmentIds }, (part, text) => send(response, 'text', { part, text }));
    // Keep the receipt: one line per confirmed turn.
    await appendFile(RECEIPTS, JSON.stringify({ at: new Date().toISOString(), learner_id: learner, ...result.receipt }) + '\n');
    send(response, 'done', { safety: result.safety, receipt: result.receipt });
  } catch (error) {
    const e = error instanceof LearnError ? error : new LearnError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Learn turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    send(response, 'failed', { status: e.status, code: e.code, message: e.message, request_id: e.requestId });
  }
  response.end();
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method === 'POST' && request.url === '/api/turn') return await turn(request, response);
    if (request.method === 'POST' && request.url === '/api/upload') return await upload(request, response);
    const file = request.method === 'GET' ? FILES[(request.url ?? '/').split('?')[0]] : undefined;
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }
    learnerId(request, response);
    const body = await readFile(join(PUBLIC, file));
    response.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()!], 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(500).end('Server error');
    console.error(error);
  }
});

if (!isConfigured()) console.warn('FOREVERLEARNING_API_KEY is not set. Copy .env.example to .env and add your key.');
server.listen(PORT, '127.0.0.1', () => console.log('Your tutor is running at http://localhost:' + PORT));
