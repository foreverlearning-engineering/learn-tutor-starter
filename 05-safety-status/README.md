# Step 5: Show the safety status

Every turn carries Learn's safety status: a response action (`none` or `support` on this release; the contract also defines `escalate`) and a level (`clear`, `watch`, `warning`, `critical`, or `unknown` when the turn was not evaluated). Learn has already replied with care, and its reply is shown at once, as Learn wrote it. What your product adds is yours.

| Response action and level | What this app adds, under the reply |
| --- | --- |
| `none`, clear | nothing |
| `support`, watch | a quiet check-in: it's fine to take a break; talk with someone you trust |
| `support`, warning | a support message: it's fine to stop the work; talking with someone you trust can help |
| `support`, critical (or `escalate`) | a help card: please reach out to someone now, with the US crisis line (988) and local emergency numbers elsewhere; an escalation line in the server log |
| `none`, unknown | "This turn couldn't be checked": never treated as clear |

Nothing covers the reply, and the learner never has to press anything to see it. 988 is the US line: Learn is not told where a learner is, so show your own local resources for the other countries you serve, Canada included.

Every turn that is not clear is recorded in `data/safety-events.jsonl` for the people who oversee your app. The escalation line in `server.ts` only logs: to reach a person, connect it to your own on-call, email or messaging, or opt in to the signed safety webhook in the console. Until it really notifies someone, never tell a learner that a person has been told. Your application owns consent, oversight and escalation; adapt the words and the help to your learners and your region.

When a request fails, the page shows the app's own short words (for a message the safety screening refused: "I can't help with that message. Try asking another way."), and Learn's own message goes to the server log.

## Run it

```sh
cp .env.example .env        # then put your key in .env
npm start
```

Starts from step 4 (`04-remember-the-learner`).
