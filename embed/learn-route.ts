// The Learn route for your existing server: POST /api/learn/turn.
// It keeps the key, maps your user to a pseudonymous learner id, keeps one Learn session
// per learner, sends the reply to your page as it arrives and keeps every receipt.
import { Router, type Request, type Response } from 'express';
import { createHmac } from 'node:crypto';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createSession, sendTurn, LearnError } from './learn.ts';

const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');
const SECRET = process.env.LEARNER_ID_SECRET || 'change-this-secret';
if (SECRET === 'change-this-secret') console.warn('Set LEARNER_ID_SECRET so learner ids cannot be traced back to your users.');

// The session's task. Use what your product knows: the subject, the unit, the assignment.
const SETUP = { task: { kind: 'homework', subject: 'Linear equations' }, team_dialog: false };

// One Learn session per learner. Keep this in your database in production.
const sessions = new Map<string, string>();

// A pseudonymous learner id: a keyed hash of your own user id, never a name or an email.
export function learnerIdFor(userId: string): string {
  return 'learner-' + createHmac('sha256', SECRET).update(userId).digest('hex').slice(0, 32);
}

function send(response: Response, event: string, data: unknown) {
  response.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

export const learnRoute = Router();

learnRoute.post('/turn', async (request: Request, response: Response) => {
  const message = String(request.body?.message ?? '').trim();
  if (!message) return void response.status(400).json({ error: 'Type a question first.' });
  const learner = learnerIdFor(String(response.locals.userId));
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  try {
    let sessionId = sessions.get(learner);
    if (!sessionId) {
      sessionId = await createSession(learner, SETUP);
      sessions.set(learner, sessionId);
    }
    const result = await sendTurn(learner, { sessionId, prompt: message, posture: 'guided' }, (part, text) => send(response, 'text', { part, text }));
    await appendFile(RECEIPTS, JSON.stringify({ at: new Date().toISOString(), learner_id: learner, ...result.receipt }) + '\n');
    send(response, 'done', { safety: result.safety, receipt: result.receipt });
  } catch (error) {
    const e = error instanceof LearnError ? error : new LearnError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Learn turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    send(response, 'failed', { status: e.status, code: e.code, message: e.message, request_id: e.requestId });
  }
  response.end();
});
