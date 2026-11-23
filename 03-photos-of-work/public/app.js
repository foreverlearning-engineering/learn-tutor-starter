// The chat page. It talks only to your own server (/api/turn and /api/upload), never to Learn directly.
const messages = document.querySelector('#messages');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const button = form.querySelector('button[type="submit"], button:not([type])');
const photos = document.querySelector('#photos');
const thumbs = document.querySelector('#thumbs');
let attached = []; // { id, url } for each uploaded photo, up to four

// Upload each chosen photo to your server, which uploads it to Learn. Free: no reply is made.
photos.addEventListener('change', async () => {
  for (const file of [...photos.files].slice(0, 4 - attached.length)) {
    const item = document.createElement('li');
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = 'Your photo: ' + file.name;
    item.append(img);
    thumbs.append(item);
    item.classList.add('uploading');
    const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.readAsDataURL(file); });
    const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media_type: file.type, data, filename: file.name }) });
    const body = await response.json();
    item.classList.remove('uploading');
    if (response.ok) attached.push({ id: body.attachment_id, url: img.src });
    else { item.classList.add('failed'); item.title = body.error; }
  }
  photos.value = '';
});

// A small, safe Markdown renderer for the reply's display part:
// paragraphs, lists, `code`, **bold** and *italic*. Everything is escaped first.
function escape(text) {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function inline(text) {
  return escape(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
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

// Math in a reply (\( \) inline, \[ \] on its own line), rendered by KaTeX's auto-render,
// loaded in index.html. Without it the learner would see the raw notation.
function typeset(element) {
  window.renderMathInElement?.(element, {
    delimiters: [{ left: '\\(', right: '\\)', display: false }, { left: '\\[', right: '\\]', display: true }],
    throwOnError: false,
  });
}

function add(role, text) {
  const item = document.createElement('li');
  item.className = 'message ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (text) bubble.textContent = text;
  item.append(bubble);
  messages.append(item);
  item.scrollIntoView({ block: 'end' });
  return item;
}

function chip(label, value, kind) {
  const span = document.createElement('span');
  span.className = 'chip ' + (kind ?? '');
  span.textContent = label + ': ' + value;
  return span;
}

function dollars(micro) {
  return '$' + (micro / 1e6).toFixed(2);
}

// Read the server's events: the reply's "text" parts, then "done" or "failed".
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

form.addEventListener('submit', async (submit) => {
  submit.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  // The kind of help goes with every message. Diagnostic starts a session of its own.
  const kind = form.querySelector('input[name="kind"]:checked').value;
  const learnerItem = add('learner', text);
  learnerItem.querySelector('.bubble').dataset.kind = kind;
  // The photos go with this message, then the tray clears.
  const sent = attached;
  attached = [];
  thumbs.replaceChildren();
  for (const p of sent) { const img = document.createElement('img'); img.src = p.url; img.alt = 'Your photo'; img.className = 'sent-photo'; learnerItem.append(img); }
  input.value = '';
  button.disabled = true;
  const item = add('tutor', '');
  const bubble = item.querySelector('.bubble');
  const said = document.createElement('p');
  const board = document.createElement('div');
  board.className = 'board';
  bubble.append(said, board);
  bubble.classList.add('waiting');
  let conversation = '';
  let display = '';
  try {
    const response = await fetch('/api/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, kind, attachment_ids: sent.map((p) => p.id) }),
    });
    for await (const { event, data } of events(response)) {
      if (event === 'text' && data.part === 'conversation') {
        conversation += data.text;
        said.innerHTML = inline(conversation);
        typeset(said);
      } else if (event === 'text' && data.part === 'display') {
        display += data.text;
        board.innerHTML = markdown(display);
        typeset(board);
      } else if (event === 'done') {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.append(
          chip('Kind', data.receipt.posture),
          chip('Safety', data.safety.level, 'safety-' + data.safety.level),
          chip('Receipt', data.receipt.billable_units + ' turn · ' + dollars(data.receipt.charge_micro_usd) + ' · ' + data.receipt.settlement),
          chip('Request', data.receipt.request_id.slice(0, 12) + '…'),
        );
        item.append(meta);
      } else if (event === 'failed') {
        said.textContent = 'That turn did not go through (' + data.code + '). ' + data.message;
        item.classList.add('error');
      }
      item.scrollIntoView({ block: 'end' });
    }
  } catch {
    said.textContent = 'The connection dropped. Try again.';
    item.classList.add('error');
  } finally {
    bubble.classList.remove('waiting');
    button.disabled = false;
    input.focus();
  }
});

input.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) {
    key.preventDefault();
    form.requestSubmit();
  }
});
