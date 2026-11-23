# Embed Learn in your app

Learn inside the product you already have, in an afternoon. This folder is the finished example: **Practice Pad**, a small practice product whose help panel now gets its help from Learn. The `start/` folder is the same product before Learn.

## What changed

| File | Change |
| --- | --- |
| `learn.ts` | New: calls Learn (`POST /v1/quest/sessions`, then `POST /v1/chat` for each turn) and accepts a turn only after the final `done` event confirms it. |
| `learn-route.ts` | New: `POST /api/learn/turn`. Keeps the key, turns your user id into a pseudonymous learner id (a keyed hash), keeps one Learn session per learner, sends the reply to your page when it arrives and keeps every receipt in `receipts.jsonl`. |
| `public/learn-client.js` | New: a drop-in browser module. `askLearn(message, element)` renders the reply (both parts), the safety status and the receipt into any element. |
| `server.ts` | One line mounts the route: `app.use('/api/learn', learnRoute)`. |
| `public/app.js` | The help panel calls `askLearn` instead of the placeholder. |
| `public/style.css` | A few rules for the reply, the safety status and the receipt. |

Your product's look, sign-in and stack stay yours. Learn does the teaching.

## Run it

```sh
cp .env.example .env        # then put your key and a LEARNER_ID_SECRET in .env
npm install
npm start
```

Open http://localhost:3000 and ask the help panel about a problem.

## What you should see

- After about 10 to 20 seconds, Learn's reply in the help panel: a sentence about what you are working on, then a hint that leaves the next step to you.
- Under it: `Safety: clear`, `Receipt: 1 turn · $0.05 · settled` and the request id.
- One new line in `receipts.jsonl` for each confirmed turn.

Each turn that succeeds costs 5¢. A turn that fails costs nothing.

The sample keeps each learner's session in memory; keep it in your database. If the server forgets an open session, the next one makes Learn close the earlier session first: that closeout is billed as its own request, and the first reply takes about ten seconds longer, about 19 seconds.

The integration guide: https://developers.foreverlearning.ai/docs/learn/
