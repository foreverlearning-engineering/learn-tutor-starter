// Practice Pad's page: the problem list and the help panel.
const list = document.querySelector('#problems');
const unit = document.querySelector('#unit');
const helpMessages = document.querySelector('#help-messages');
const helpForm = document.querySelector('#help-form');
const helpInput = document.querySelector('#help-input');

const data = await (await fetch('/api/problems')).json();
unit.textContent = data.unit;
for (const problem of data.problems) {
  const item = document.createElement('li');
  item.textContent = problem.text;
  list.append(item);
}

function addHelp(role, text) {
  const item = document.createElement('li');
  item.className = 'help-message ' + role;
  item.textContent = text;
  helpMessages.append(item);
  return item;
}

helpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = helpInput.value.trim();
  if (!message) return;
  addHelp('learner', message);
  helpInput.value = '';
  const response = await fetch('/api/help', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  const body = await response.json();
  addHelp('helper', body.reply ?? body.error);
});

helpInput.addEventListener('keydown', (key) => {
  if (key.key === 'Enter' && !key.shiftKey) { key.preventDefault(); helpForm.requestSubmit(); }
});
