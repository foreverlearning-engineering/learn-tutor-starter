// The class page: sign in, then chat with your tutor. It talks only to your own server.
const $ = (selector) => document.querySelector(selector);
const messages = $('#messages');
const input = $('#message');
const buttons = [$('#ask'), $('#submit-work')];

function escape(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
// Safe Markdown for the display part: paragraphs, lists, code, bold, italic.
function markdown(text) {
  // Keep each display-math block (\[ ... \], often over several lines) together in one
  // paragraph, so the math library finds both delimiters.
  const blocks = [];
  text = text.replace(/\\\[[\s\S]*?\\\]/g, (block) => '\u0000' + (blocks.push(block) - 1) + '\u0000');
  const html = [];
  let list = null;
  for (const line of text.split('\n')) {
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      if (list) { html.push('</' + list + '>'); list = null; }
      html.push('<p class="heading"><strong>' + inline(heading[1]) + '</strong></p>');
      continue;
    }
    const item = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      const kind = item[1] ? 'ol' : 'ul';
      if (list !== kind) { if (list) html.push('</' + list + '>'); html.push('<' + kind + '>'); list = kind; }
      html.push('<li>' + inline(item[2]) + '</li>');
      continue;
    }
    if (list) { html.push('</' + list + '>'); list = null; }
    if (line.trim()) html.push('<p>' + inline(line) + '</p>');
  }
  if (list) html.push('</' + list + '>');
  return html.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => escape(blocks[Number(i)]));
}

let tutorName = 'Tutor';

function bubble(role, label) {
  const item = document.createElement('li');
  item.className = 'message ' + (role === 'tutor' ? 'tutor' : 'learner');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = role === 'tutor' ? tutorName : label;
  const body = document.createElement('div');
  body.className = 'bubble';
  item.append(who, body);
  messages.append(item);
  item.scrollIntoView({ block: 'end' });
  return { item, body };
}

function tutorReply(body, conversation, display) {
  body.innerHTML = '<p>' + inline(conversation) + '</p>' + (display ? '<div class="board">' + markdown(display) + '</div>' : '');
  typeset(body);
}
// Math in a reply (\( \) inline, \[ \] on its own line), rendered by KaTeX's auto-render,
// loaded in index.html. Without it the learner would see the raw notation.
function typeset(element) {
  window.renderMathInElement?.(element, {
    delimiters: [{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }],
    throwOnError: false,
  });
}


function chips(item, safety, receipt) {
  const meta = document.createElement('div');
  meta.className = 'meta';
  const add = (text, kind) => { const s = document.createElement('span'); s.className = 'chip ' + (kind ?? ''); s.textContent = text; meta.append(s); };
  add('Safety: ' + safety, 'safety-' + safety);
  if (receipt) {
    add('Receipt: ' + receipt.billable_units + ' turn · $' + (receipt.charge_micro_usd / 1e6).toFixed(2) + ' · ' + receipt.settlement);
    add('Request: ' + receipt.request_id.slice(0, 12) + '…');
  }
  item.append(meta);
}

async function* events(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      if (event && data) yield { event, data: JSON.parse(data) };
    }
  }
}

async function turn(kind, message) {
  buttons.forEach((b) => { b.disabled = true; });
  if (kind !== 'opening') bubble('student', kind === 'submit' ? 'You submitted' : 'You').body.textContent = message;
  const { item, body } = bubble('tutor');
  body.classList.add('waiting');
  let conversation = '', display = '';
  try {
    const response = await fetch('/api/turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, message }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'HTTP ' + response.status);
    for await (const { event, data } of events(response)) {
      if (event === 'text' && data.part === 'conversation') conversation += data.text;
      else if (event === 'text' && data.part === 'display') display += data.text;
      else if (event === 'done') chips(item, data.safety.level, data.receipt);
      else if (event === 'failed') { conversation = 'That did not go through (' + data.code + '). Try again in a moment.'; display = ''; }
      tutorReply(body, conversation, display);
    }
  } catch (error) {
    body.textContent = 'That did not go through. ' + error.message;
  } finally {
    body.classList.remove('waiting');
    buttons.forEach((b) => { b.disabled = false; });
    input.focus();
  }
}

async function load() {
  const me = await (await fetch('/api/me')).json();
  tutorName = me.tutor.name;
  document.title = me.tutor.name;
  $('#tutor-name').textContent = me.tutor.name;
  $('#course').textContent = me.tutor.course;
  $('#welcome').textContent = me.tutor.welcome;
  document.documentElement.style.setProperty('--accent', me.tutor.colors.accent);
  document.documentElement.style.setProperty('--bg', me.tutor.colors.background);
  $('#sign-in').hidden = me.signed_in;
  $('#chat').hidden = !me.signed_in;
  if (!me.signed_in) return;
  $('#who').textContent = me.handle;
  messages.replaceChildren();
  // Pick up where the student left off: the app keeps each student's conversation.
  for (const m of me.messages) {
    if (m.role === 'student') bubble('student', m.kind === 'submit' ? 'You submitted' : 'You').body.textContent = m.text;
    else { const { item, body } = bubble('tutor'); tutorReply(body, m.text, m.display); chips(item, m.safety); }
  }
  if (!me.messages.length) await turn('opening', '');
}

$('#sign-in').addEventListener('submit', async (event) => {
  event.preventDefault();
  const response = await fetch('/api/sign-in', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ class_code: $('#class-code').value, handle: $('#handle').value }) });
  if (!response.ok) { $('#sign-in-error').textContent = (await response.json()).error; return; }
  await load();
});

$('#sign-out').addEventListener('click', async () => {
  await fetch('/api/sign-out', { method: 'POST' });
  await load();
});

$('#composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  turn('ask', text);
});

$('#submit-work').addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) { input.focus(); return; }
  input.value = '';
  turn('submit', text);
});

input.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) { key.preventDefault(); $('#composer').requestSubmit(); }
});

await load();
