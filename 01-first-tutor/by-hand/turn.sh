#!/usr/bin/env bash
# Your first tutor with cURL: prepare a session (free), then send one Guided turn
# and watch Learn's event stream. Needs FOREVERLEARNING_API_KEY and FOREVERLEARNING_BASE_URL.
#   bash turn.sh "I am stuck on 3x + 5 = 20. Can you just tell me what x is?"
set -euo pipefail
LEARNER="learner-$(date +%s)-$RANDOM$RANDOM"   # pseudonymous: never a name or an email
MESSAGE="I am stuck on 3x + 5 = 20. Can you just tell me what x is?"
if [ $# -gt 0 ]; then MESSAGE="$1"; fi
ASSIGNMENT_HEADER=()
if [ -n "${FOREVERLEARNING_ASSIGNMENT_ID:-}" ]; then ASSIGNMENT_HEADER=(-H "X-Assignment-Id: $FOREVERLEARNING_ASSIGNMENT_ID"); fi

# 1. Prepare a session. Nothing is generated and nothing is charged.
SESSION=$(curl -sS "$FOREVERLEARNING_BASE_URL/quest/sessions" \
  -H "Authorization: Bearer $FOREVERLEARNING_API_KEY" \
  "${ASSIGNMENT_HEADER[@]}" \
  -H "X-User-Id: $LEARNER" \
  -H "FL-API-Version: 2026-12-01" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: setup-$LEARNER" \
  --data '{"setup":{"task":{"kind":"homework"},"team_dialog":false}}' \
  | grep -o '"session_id":"[^"]*"' | head -n 1 | cut -d'"' -f4)
echo "Session: $SESSION"

# 2. Send one Guided turn. The reply streams back as server-sent events:
#    metadata, content (conversation, then display), safety_status, quest_receipt, done.
BODY=$(printf '{"session_id":"%s","prompt":"%s","posture":"guided","quest":{"operation":"turn","requested_support":"auto","team_dialog":false}}' \
  "$SESSION" "$(printf '%s' "$MESSAGE" | sed 's/\\/\\\\/g; s/"/\\"/g')")
curl -sS --no-buffer "$FOREVERLEARNING_BASE_URL/chat" \
  -H "Authorization: Bearer $FOREVERLEARNING_API_KEY" \
  "${ASSIGNMENT_HEADER[@]}" \
  -H "X-User-Id: $LEARNER" \
  -H "FL-API-Version: 2026-12-01" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: turn-1-$LEARNER" \
  --data "$BODY"
