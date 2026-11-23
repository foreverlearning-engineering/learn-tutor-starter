// Your first tutor: a small server that keeps the Learn key and a chat page that
// shows the reply. Node 24+, no packages. Start it with: npm start
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createSession, sendTurn, isConfigured, LearnError } from './learn.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const RECEIPTS = join(import.meta.dirname, 'receipts.jsonl');

// One Learn session per learner. A real app keeps this in its database.
const sessions = new Map<string, string>();

// The task every session in this checkpoint starts with.
const SETUP = { task: { kind: 'homework' }, team_dialog: false };

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

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('Message too long');
  }
  return JSON.parse(raw || '{}');
}

// What the learner sees when a request fails: your app's own short words. Learn's own message is
// for you, in the server log with the request id; never show it to the learner.
function forLearner(e: LearnError): string {
  if (e.code === 'DEVELOPER_POLICY_BLOCKED') return "I can't help with that message. Try asking another way.";
  if (e.status === 429) return 'The tutor is busy right now. Try again in a moment.';
  return "That didn't go through. Try again in a moment.";
}

function send(response: ServerResponse, event: string, data: unknown) {
  response.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

async function turn(request: IncomingMessage, response: ServerResponse) {
  const learner = learnerId(request, response);
  const { message } = await readJson(request);
  if (typeof message !== 'string' || !message.trim()) {
    response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'Type a message first.' }));
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  try {
    let sessionId = sessions.get(learner);
    if (!sessionId) {
      sessionId = await createSession(learner, SETUP);
      sessions.set(learner, sessionId);
    }
    const result = await sendTurn(learner, { sessionId, prompt: message.trim(), posture: 'guided' }, (part, text) => send(response, 'text', { part, text }));
    // Keep the receipt: one line per confirmed turn.
    await appendFile(RECEIPTS, JSON.stringify({ at: new Date().toISOString(), learner_id: learner, ...result.receipt }) + '\n');
    send(response, 'done', { safety: result.safety, receipt: result.receipt });
  } catch (error) {
    const e = error instanceof LearnError ? error : new LearnError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Learn turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    send(response, 'failed', { status: e.status, code: e.code, message: forLearner(e), request_id: e.requestId });
  }
  response.end();
}

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (request.method === 'POST' && request.url === '/api/turn') return await turn(request, response);
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
