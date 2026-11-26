// The instructor page: what each student worked on, from your app's own record.
const form = document.querySelector('#teacher-sign-in');
const list = document.querySelector('#students');
const error = document.querySelector('#teacher-error');

function show(data) {
  document.querySelector('#course').textContent = data.course + ' · ' + data.assignment + ' · Tutor: ' + data.tutor_name;
  list.replaceChildren();
  if (!data.students.length) list.textContent = 'No students have signed in yet.';
  for (const s of data.students) {
    const card = document.createElement('article');
    card.className = 'student';
    const h = document.createElement('h2');
    h.textContent = s.handle;
    const p = document.createElement('p');
    p.className = 'meta-line';
    p.textContent = s.questions + ' questions · ' + s.submissions + ' submissions · safety: ' + (s.safety.join(', ') || 'none yet');
    const ol = document.createElement('ol');
    for (const w of s.worked_on) {
      const li = document.createElement('li');
      li.textContent = (w.kind === 'submit' ? 'Submitted: ' : 'Asked: ') + w.text;
      ol.append(li);
    }
    card.append(h, p, ol);
    list.append(card);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.querySelector('#teacher-code').value;
  // The code goes in the request body, never in the address.
  const response = await fetch('/api/teacher', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
  const data = await response.json();
  if (!response.ok) { error.textContent = data.error; return; }
  error.textContent = '';
  form.hidden = true;
  show(data);
});
