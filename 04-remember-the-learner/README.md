# Step 4: Remember the learner

The tutor picks up where the learner left off.

- **Finish for today** ends the session with `POST /v1/sessions/{id}/end`. Learn writes and saves the session's summary and what it learned about the learner. The closeout is a turn.
- Next time, the **Last time** panel shows the saved summary (`GET /v1/quest/sessions/{id}/summary`) and the concepts in the learner's profile, grouped by name (`GET /v1/quest/learners/{id}/profile`). These reads are free; empty evidence stays empty.
- The app keeps its own record of each learner's sessions in `data/learners.json`, so it knows which session is open and which ended.

## Run it

```sh
cp .env.example .env        # then put your key in .env
npm start
```

Ask a question, press **Finish for today**, then open the page again.

Starts from step 3 (`03-photos-of-work`). Next: step 5, **Show the safety status**.
