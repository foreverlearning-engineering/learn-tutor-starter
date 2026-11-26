# A tutor for my class

A small web app your class signs into. The app sets the tutor's name, look, course and assignment. Students get hints while they work, which leave the answer with them, and feedback when they submit work, which checks it line by line and corrects it. Your instructor page shows what each student worked on.

## You need

- A developer workspace with Learn added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.
- Adult learners in a class you run yourself, such as a bootcamp, a workshop or adult education. A class at a school, college or university, or any class of children, is set up under an agreement first.

## Set it up for your class

1. Edit `class.json`: your tutor's name, the welcome line, two colors, your course and the assignment.
2. Copy `.env.example` to `.env` and fill in your key, a class code for your students, a different instructor code for you, and a long random `LEARNER_ID_SECRET`. There are no default codes: the server will not start until all three are set.
3. Run it:

```sh
npm start
```

Students open http://localhost:3000 (or wherever you host it), enter the class code and a short sign-in of their own (not their full name), and start. You open `/teacher` and enter your instructor code; the page sends it in the request body, never in the address.

## What you should see

- The tutor's name on the page and in its opening ("I am Maple. Welcome." style), in your colors.
- **Ask** sends a Guided turn: a hint that leaves the next step to the student, never the answer.
- **Submit my work** sends a Feedback turn: which steps hold, the first one that doesn't and why, and what to practice.
- Under each reply: the safety status and the receipt (`1 turn · $0.05 · settled`, the request id). One line per turn in `receipts.jsonl`.
- When a student signs in again, from any browser, their conversation is there and carries on.
- `/teacher` lists each student's sign-in, what they asked and submitted, and their safety levels, so you can follow up with a student who may need support.

## How it works

| File | What it does |
| --- | --- |
| `class.json` | Your tutor: name, welcome, colors, course, assignment. |
| `server.ts` | Sign-in with the class code; the learner id is a keyed hash of the student's sign-in, so Learn never sees it. One Learn session per student, prepared with `display_name` (your tutor's name) and the task (your course and assignment). Questions go as Guided turns, submitted work as Feedback turns. Keeps each student's conversation in `data/`. |
| `learn.ts` | Calls Learn: `POST /v1/quest/sessions`, the generated opening, and `POST /v1/chat` for each turn. Accepts a turn only after the final `done` event confirms it. |
| `public/` | The class page, the chat and the instructor page. |

The replies are the tutor's teaching, shown under the tutor's name. The app never presents them as your own words.

Each turn that succeeds costs 5¢, and the opening is a turn. A turn that fails costs nothing.

The integration guide: https://developers.foreverlearning.ai/docs/learn/
