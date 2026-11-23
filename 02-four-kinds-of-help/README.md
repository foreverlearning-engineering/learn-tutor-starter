# Step 2: The four kinds of help

One tutor, four kinds of help. On each message the learner chooses:

| Kind | For | How the app asks for it |
| --- | --- | --- |
| **Guided** | working on a problem | `"posture": "guided"` on the turn |
| **Feedback** | checking finished work | `"posture": "feedback"` on the turn |
| **Explain** | a worked example they don't follow | `"posture": "explain"` on the turn |
| **Diagnostic** | a quiz they finished | a new session prepared with `"posture": "diagnostic"` and the quiz in `setup.assessment`, opened, then answers with no posture |

Guided, Feedback and Explain share one session and change on any turn. Leaving `posture` out means Guided every time, so the app sends it on every turn. Diagnostic is chosen when a session is prepared, with the finished work, so a Diagnostic message starts a session of its own and opens it. Starting a session closes the learner's open one first: that closeout is billed on its own, and the reply takes about ten seconds longer, about 19 seconds.

## Run it

```sh
cp .env.example .env        # then put your key in .env
npm start
```

Open http://localhost:3000, choose a kind of help, and send a message. Under each reply: its kind (the receipt's posture), the safety status and the receipt. `receipts.jsonl` keeps one line per turn, with the posture.

Starts from step 1 (`01-first-tutor`). Next: step 3, **Photos of handwritten work**.
