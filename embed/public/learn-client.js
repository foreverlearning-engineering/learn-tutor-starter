// Drop-in browser module for Learn replies. It talks only to your own server route.
//   import { askLearn } from '/learn-client.js';
//   await askLearn(message, element);   // renders the reply, safety status and receipt into element

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
export function markdown(text) {
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

export async function askLearn(message, element, { endpoint = '/api/learn/turn' } = {}) {
  const said = document.createElement('p');
  const board = document.createElement('div');
  board.className = 'learn-board';
  const meta = document.createElement('div');
  meta.className = 'learn-meta';
  element.replaceChildren(said, board, meta);
  element.classList.add('learn-waiting');
  let conversation = '', display = '';
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error ?? 'HTTP ' + response.status);
    for await (const { event, data } of events(response)) {
      if (event === 'text' && data.part === 'conversation') { conversation += data.text; said.innerHTML = inline(conversation); typeset(said); }
      else if (event === 'text' && data.part === 'display') { display += data.text; board.innerHTML = markdown(display); typeset(board); }
      else if (event === 'done') {
        const r = data.receipt;
        meta.innerHTML = '<span class="learn-safety learn-safety-' + escape(data.safety.level) + '">Safety: ' + escape(data.safety.level) + '</span>'
          + '<span>Receipt: ' + r.billable_units + ' turn · $' + (r.charge_micro_usd / 1e6).toFixed(2) + ' · ' + escape(r.settlement) + '</span>'
          + '<span>Request: ' + escape(r.request_id.slice(0, 12)) + '…</span>';
      } else if (event === 'failed') {
        said.textContent = 'Help is unavailable right now (' + data.code + '). Try again in a moment.';
      }
    }
  } catch (error) {
    said.textContent = 'Help is unavailable right now. ' + error.message;
  } finally {
    element.classList.remove('learn-waiting');
  }
}
