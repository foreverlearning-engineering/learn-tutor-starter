// A tutor for my class. Students sign in with the class code; the tutor carries your name
// for it, your course and your assignment. Questions get Guided help; submitted work gets
// Feedback. Your instructor page shows what each student worked on. Node 24+, no packages.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { createSession, sendTurn, isConfigured, LearnError, type Posture } from './learn.ts';

const PORT = Number(process.env.PORT ?? 3000);
const HERE = import.meta.dirname;
const PUBLIC = join(HERE, 'public');
const DATA = join(HERE, 'data');
const STORE = join(DATA, 'class-store.json');
const RECEIPTS = join(HERE, 'receipts.jsonl');
const CLASS_CODE = (process.env.CLASS_CODE ?? '').trim();
const TEACHER_CODE = (process.env.TEACHER_CODE ?? '').trim();
const SECRET = process.env.LEARNER_ID_SECRET ?? '';
// No default codes, ever. With a missing or example code, anyone could join your class or open
// your instructor page and read every student's work, so the server will not start.
const EXAMPLES = new Set(['demo-class', 'demo-teacher', 'class-code', 'teacher-code', 'change-me', 'change-this-secret']);
const unset: string[] = [];
if (!CLASS_CODE || EXAMPLES.has(CLASS_CODE.toLowerCase())) unset.push('CLASS_CODE (the code your students enter)');
if (!TEACHER_CODE || EXAMPLES.has(TEACHER_CODE.toLowerCase()) || TEACHER_CODE === CLASS_CODE) unset.push('TEACHER_CODE (the code for your instructor page, different from the class code)');
if (SECRET.length < 16 || EXAMPLES.has(SECRET.toLowerCase())) unset.push('LEARNER_ID_SECRET (a long random string, 16 characters or more)');
if (unset.length) {
  console.error('Not starting. Choose your own ' + unset.join('; ') + '. Set ' + (unset.length > 1 ? 'them' : 'it') + ' in .env (see .env.example).');
  process.exit(1);
}

// Your tutor: name, welcome, course, assignment and colors. Edit class.json.
const settings = JSON.parse(await readFile(join(HERE, 'class.json'), 'utf8'));

interface Message { role: 'student' | 'tutor'; kind: 'opening' | 'ask' | 'submit'; text: string; display?: string; safety?: string; request_id?: string; at: string }
interface Student { handle: string; session_id?: string; messages: Message[] }
type Store = { students: Record<string, Student> };

// Your app's own record of each student. Learn sees only the pseudonymous learner id.
let store: Store = { students: {} };
try { store = JSON.parse(await readFile(STORE, 'utf8')); } catch { /* first run */ }
async function save() {
  await mkdir(DATA, { recursive: true });
  await writeFile(STORE, JSON.stringify(store, null, 2));
}

const sign = (value: string) => createHmac('sha256', SECRET).update(value).digest('hex');
// A pseudonymous learner id: a keyed hash of the student's sign-in, never a name or an email.
const learnerIdFor = (handle: string) => 'learner-' + sign('student:' + handle.trim().toLowerCase()).slice(0, 32);

function same(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function signedIn(request: IncomingMessage): string | null {
  const match = /(?:^|;\s*)student=(learner-[0-9a-f]{32})\.([0-9a-f]{64})/.exec(request.headers.cookie ?? '');
  return match && same(match[2], sign(match[1])) && store.students[match[1]] ? match[1] : null;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 20000) throw new Error('Message too long');
  }
  return JSON.parse(raw || '{}');
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
}

function send(response: ServerResponse, event: string, data: unknown) {
  response.write('event: ' + event + '\ndata: ' + JSON.stringify(data) + '\n\n');
}

async function signIn(request: IncomingMessage, response: ServerResponse) {
  const { class_code, handle } = await readJson(request);
  if (typeof class_code !== 'string' || !same(class_code.trim(), CLASS_CODE)) return json(response, 403, { error: 'That class code is not right.' });
  if (typeof handle !== 'string' || !/^[A-Za-z0-9 ._-]{2,40}$/.test(handle.trim())) return json(response, 400, { error: 'Use 2 to 40 letters, numbers, spaces, dots, dashes or underscores.' });
  const learner = learnerIdFor(handle);
  store.students[learner] ??= { handle: handle.trim(), messages: [] };
  await save();
  response.setHeader('Set-Cookie', 'student=' + learner + '.' + sign(learner) + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000');
  json(response, 200, { ok: true });
}

// One turn: an opening, a question (Guided) or submitted work (Feedback).
async function turn(request: IncomingMessage, response: ServerResponse, learner: string) {
  const { message, kind } = await readJson(request);
  if (kind !== 'opening' && kind !== 'ask' && kind !== 'submit') return json(response, 400, { error: 'Unknown kind.' });
  const text = typeof message === 'string' ? message.trim() : '';
  if (kind !== 'opening' && !text) return json(response, 400, { error: 'Type a message first.' });
  const student = store.students[learner];
  if (kind === 'opening' && student.messages.length) return json(response, 409, { error: 'This session already started.' });
  const posture: Posture = kind === 'submit' ? 'feedback' : 'guided';
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store' });
  try {
    if (!student.session_id) {
      // The app sets the tutor's name, the course and the assignment. Learn does the teaching.
      student.session_id = await createSession(learner, {
        display_name: settings.tutor_name,
        task: { kind: 'homework', subject: settings.course, assignment: settings.assignment },
        learner: { grade_band: 'adult' },
        team_dialog: false,
      });
      await save();
    }
    const result = await sendTurn(learner, { sessionId: student.session_id, prompt: text, posture, operation: kind === 'opening' ? 'opening' : 'turn' }, (part, piece) => send(response, 'text', { part, text: piece }));
    const at = new Date().toISOString();
    if (kind !== 'opening') student.messages.push({ role: 'student', kind, text, at });
    student.messages.push({ role: 'tutor', kind, text: result.reply, display: result.display, safety: result.safety.level, request_id: result.request_id, at });
    await save();
    await appendFile(RECEIPTS, JSON.stringify({ at, learner_id: learner, ...result.receipt }) + '\n');
    send(response, 'done', { safety: result.safety, receipt: result.receipt });
  } catch (error) {
    const e = error instanceof LearnError ? error : new LearnError(500, 'SERVER_ERROR', (error as Error).message);
    console.error('Learn turn failed:', e.status, e.code, e.message, e.requestId ? 'request ' + e.requestId : '');
    send(response, 'failed', { status: e.status, code: e.code, message: e.message, request_id: e.requestId });
  }
  response.end();
}

// The instructor code arrives in the request body, never in the address, so it stays out of
// server logs and browser history.
async function teacher(request: IncomingMessage, response: ServerResponse) {
  const { code } = await readJson(request);
  if (typeof code !== 'string' || !same(code.trim(), TEACHER_CODE)) return json(response, 403, { error: 'That instructor code is not right.' });
  const students = Object.values(store.students).map((s) => ({
    handle: s.handle,
    started: s.messages[0]?.at ?? null,
    questions: s.messages.filter((m) => m.role === 'student' && m.kind === 'ask').length,
    submissions: s.messages.filter((m) => m.role === 'student' && m.kind === 'submit').length,
    safety: [...new Set(s.messages.map((m) => m.safety).filter(Boolean))],
    worked_on: s.messages.filter((m) => m.role === 'student').map((m) => ({ kind: m.kind, text: m.text, at: m.at })),
  }));
  json(response, 200, { course: settings.course, assignment: settings.assignment, tutor_name: settings.tutor_name, students });
}

const FILES: Record<string, string> = { '/': 'index.html', '/teacher': 'teacher.html', '/app.js': 'app.js', '/teacher.js': 'teacher.js', '/style.css': 'style.css' };
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const path = (request.url ?? '/').split('?')[0];
    if (request.method === 'POST' && path === '/api/sign-in') return await signIn(request, response);
    if (request.method === 'POST' && path === '/api/sign-out') {
      response.setHeader('Set-Cookie', 'student=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
      return json(response, 200, { ok: true });
    }
    if (request.method === 'POST' && path === '/api/teacher') return await teacher(request, response);
    if (request.method === 'GET' && path === '/api/me') {
      const learner = signedIn(request);
      const student = learner ? store.students[learner] : null;
      const { tutor_name, welcome, course, colors } = settings;
      return json(response, 200, { tutor: { name: tutor_name, welcome, course, colors }, signed_in: Boolean(student), handle: student?.handle ?? null, messages: student?.messages ?? [] });
    }
    if (request.method === 'POST' && path === '/api/turn') {
      const learner = signedIn(request);
      if (!learner) return json(response, 401, { error: 'Sign in first.' });
      return await turn(request, response, learner);
    }
    const file = request.method === 'GET' ? FILES[path] : undefined;
    if (!file) return void response.writeHead(404).end('Not found');
    const body = await readFile(join(PUBLIC, file));
    response.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()!], 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(500).end('Server error');
    console.error(error);
  }
});

if (!isConfigured()) console.warn('FOREVERLEARNING_API_KEY is not set. Copy .env.example to .env and add your key.');
server.listen(PORT, '127.0.0.1', () => console.log(settings.tutor_name + ' is running at http://localhost:' + PORT + ' (instructor page: /teacher)'));
