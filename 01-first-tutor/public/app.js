// The chat page. It talks only to your own server (/api/turn), never to Learn directly.
const messages = document.querySelector('#messages');
const form = document.querySelector('#composer');
const input = document.querySelector('#message');
const button = form.querySelector('button');

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
  const html = [];
  let list = null;
  for (const line of text.split('\n')) {
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
  return html.join('');
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

// Read the server's stream: "text" pieces while the reply arrives, then "done" or "failed".
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
  add('learner', text);
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
      body: JSON.stringify({ message: text }),
    });
    for await (const { event, data } of events(response)) {
      if (event === 'text' && data.part === 'conversation') {
        conversation += data.text;
        said.innerHTML = inline(conversation);
      } else if (event === 'text' && data.part === 'display') {
        display += data.text;
        board.innerHTML = markdown(display);
      } else if (event === 'done') {
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.append(
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
