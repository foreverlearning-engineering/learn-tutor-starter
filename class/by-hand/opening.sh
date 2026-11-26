#!/usr/bin/env bash
# A tutor for my class with cURL: prepare a session with your tutor's name, your course and
# your assignment (free), then ask for the tutor's opening (one turn) and read the events it sends back.
# Needs FOREVERLEARNING_API_KEY and FOREVERLEARNING_BASE_URL.
set -euo pipefail
LEARNER="learner-$(date +%s)-$RANDOM$RANDOM"   # pseudonymous: in your app, a keyed hash of the student's sign-in
ASSIGNMENT_HEADER=()
if [ -n "${FOREVERLEARNING_ASSIGNMENT_ID:-}" ]; then ASSIGNMENT_HEADER=(-H "X-Assignment-Id: $FOREVERLEARNING_ASSIGNMENT_ID"); fi

# 1. Prepare the session: display_name is your tutor's name. Nothing is generated or charged.
SESSION=$(curl -sS "$FOREVERLEARNING_BASE_URL/quest/sessions" \
  -H "Authorization: Bearer $FOREVERLEARNING_API_KEY" \
  "${ASSIGNMENT_HEADER[@]}" \
  -H "X-User-Id: $LEARNER" \
  -H "FL-API-Version: 2026-12-01" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: setup-$LEARNER" \
  --data '{"setup":{"display_name":"Maple","task":{"kind":"homework","subject":"Algebra 1 (adult education)","assignment":"Solve linear equations in one variable. Show each step."},"learner":{"grade_band":"adult"},"team_dialog":false}}' \
  | grep -o '"session_id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
echo "Session: $SESSION"

# 2. The opening: an empty prompt with operation "opening". For submitted work, send the
#    student's work as the prompt with "posture":"feedback" and "operation":"turn".
curl -sS --no-buffer "$FOREVERLEARNING_BASE_URL/chat" \
  -H "Authorization: Bearer $FOREVERLEARNING_API_KEY" \
  "${ASSIGNMENT_HEADER[@]}" \
  -H "X-User-Id: $LEARNER" \
  -H "FL-API-Version: 2026-12-01" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: opening-$LEARNER" \
  --data "{\"session_id\":\"$SESSION\",\"prompt\":\"\",\"posture\":\"guided\",\"quest\":{\"operation\":\"opening\",\"requested_support\":\"auto\",\"team_dialog\":false}}"
