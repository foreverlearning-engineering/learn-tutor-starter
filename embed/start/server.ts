// Practice Pad: an existing product with a practice page and a help panel.
// The help panel's answers are a placeholder for now.
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const app = express();
const PORT = Number(process.env.PORT ?? 3000);

// Stands in for your real sign-in: every visitor gets a user id in a cookie.
app.use((request, response, next) => {
  const match = /(?:^|;\s*)user=([A-Za-z0-9_-]{1,64})/.exec(request.headers.cookie ?? '');
  const id = match ? match[1] : 'u-' + randomUUID();
  if (!match) response.setHeader('Set-Cookie', 'user=' + id + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000');
  response.locals.userId = id;
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(join(import.meta.dirname, 'public')));

const problems = [
  { id: 'p1', text: 'Solve for x: 3x + 5 = 20' },
  { id: 'p2', text: 'Solve for x: 2(x - 4) = 10' },
  { id: 'p3', text: 'Solve for y: 7 - y = 2y + 1' },
];

app.get('/api/problems', (_request, response) => {
  response.json({ unit: 'Unit 3: Linear equations', problems });
});

// The help panel calls this. Placeholder: no real help yet.
app.post('/api/help', (request, response) => {
  const message = String(request.body?.message ?? '').trim();
  if (!message) return response.status(400).json({ error: 'Type a question first.' });
  response.json({ reply: 'Thanks for your question. Help is coming soon.' });
});

app.listen(PORT, () => console.log('Practice Pad is running at http://localhost:' + PORT));
