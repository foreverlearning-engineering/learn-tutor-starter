# Step 1: Your first tutor in ten minutes

A chat page where a learner asks for help with a problem and gets a hint from Learn, not the answer. Your server keeps the key; the page talks only to your server.

## You need

- A developer workspace with Learn added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key in .env
npm start
```

Open http://localhost:3000 and ask for help with a problem, for example "I'm stuck on 3x + 5 = 20. Can you just tell me what x is?"

## What you should see

- After about 10 to 20 seconds, the tutor's reply: a sentence about what you are working on, then a hint that leaves the next step to you.
- Under it, the safety status (for example `Safety: clear`) and the receipt: `1 turn · $0.05 · settled` and the request id.
- A new line in `receipts.jsonl` for each confirmed turn.

## How it works

| File | What it does |
| --- | --- |
| `server.ts` | Serves the page, gives each new browser a pseudonymous learner id in a cookie, prepares one Learn session per learner, and relays each turn. |
| `learn.ts` | Calls Learn: `POST /v1/quest/sessions` to prepare a session (free), `POST /v1/chat` for each turn. It accepts a turn only after the final `done` event confirms it. |
| `public/` | The chat page. It shows both parts of each reply: what the tutor says (`conversation`) and the hint to work on (`display`, in Markdown). |

Each turn that succeeds costs 5¢. A turn that fails costs nothing.

This step keeps sessions in memory. If the server restarts, a returning browser gets a new session, and Learn first closes its earlier one: that closeout is billed as its own request, and the first reply takes about ten seconds longer, about 19 seconds. Step 4 keeps sessions on disk.

The integration guide: https://developers.foreverlearning.ai/docs/learn/

## Next

Step 2, **The four kinds of help**, starts from this folder.
