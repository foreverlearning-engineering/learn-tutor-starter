"""A tutor for my class, by hand: the three calls that make it. Python 3.11+, standard library only.

    python class_turns.py

Prepares a session with your tutor's name (display_name), your course and your assignment,
asks for the tutor's opening, then sends one piece of student work as a Feedback turn.
Reads FOREVERLEARNING_API_KEY, FOREVERLEARNING_BASE_URL, LEARNER_ID_SECRET and (optional)
FOREVERLEARNING_ASSIGNMENT_ID.
Two turns, 5 cents each when they succeed.
"""
import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("FOREVERLEARNING_BASE_URL", "https://developers-api.foreverlearning.ai/v1").rstrip("/")
KEY = os.environ["FOREVERLEARNING_API_KEY"]
ASSIGNMENT = os.environ.get("FOREVERLEARNING_ASSIGNMENT_ID", "")
SECRET = os.environ.get("LEARNER_ID_SECRET", "")
# No default secret, as in the server: without your own, learner ids could be traced to sign-ins.
if len(SECRET) < 16 or SECRET.lower() in ("change-this-secret", "change-me"):
    sys.exit("Not starting. Set LEARNER_ID_SECRET to a long random string (16 characters or more).")
CLASS = {"tutor_name": "Maple", "course": "Algebra 1 (adult education)",
         "assignment": "Solve linear equations in one variable. Show each step."}

# A pseudonymous learner id: a keyed hash of the student's own sign-in.
sign_in = "student-" + uuid.uuid4().hex[:6]
LEARNER = "learner-" + hmac.new(SECRET.encode(), ("student:" + sign_in).encode(), hashlib.sha256).hexdigest()[:32]


def post(path, body):
    headers = {"Authorization": "Bearer " + KEY, "X-User-Id": LEARNER, "FL-API-Version": "2026-12-01",
               "Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4()),
               "User-Agent": "learn-tutor-starter/1.0 (python)"}  # so your requests are easy to recognize
    if ASSIGNMENT:
        headers["X-Assignment-Id"] = ASSIGNMENT
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
    try:
        return urllib.request.urlopen(request, timeout=120)
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            detail = json.loads(raw or b"{}")
        except ValueError:
            detail = {"message": raw[:200].decode("utf-8", "replace")}
        raise SystemExit(f"Learn returned {error.code} {detail.get('code', '')}: {detail.get('message', '')} (request {detail.get('request_id', '')})")


def turn(session_id, label, prompt, posture, operation="turn"):
    body = {"session_id": session_id, "prompt": prompt, "posture": posture,
            "quest": {"operation": operation, "requested_support": "auto", "team_dialog": False}}
    print(f"--- {label} ---")
    request_id = safety = receipt_event = commercial = None
    with post("/chat", body) as response:
        data = []
        for raw in response:
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.startswith("data:"):
                data.append(line[5:].lstrip())
                continue
            if line or not data:
                continue
            event, data = json.loads("\n".join(data)), []
            kind = event.get("type")
            if kind == "metadata":
                request_id = event["request_id"]
            elif kind == "content" and event["part"] in ("conversation", "display"):
                print(f"{CLASS['tutor_name']}: {event['text']}" if event["part"] == "conversation" else event["text"], flush=True)
            elif kind == "safety_status":
                safety = event
            elif kind == "quest_receipt":
                receipt_event = event["receipt"]
            elif kind == "done":
                commercial = event["commercial"]
            elif kind == "error":
                raise SystemExit(f"{event['code']}: {event['message']} (request {event['request_id']})")
    if not commercial or commercial["request_id"] != request_id or not safety or not receipt_event:
        raise SystemExit(f"The turn was not confirmed. Look it up with GET /v1/requests/{request_id}, as the same learner (X-User-Id), before sending again.")
    receipt = {"request_id": request_id, "session_id": session_id, "learner_id": LEARNER, "posture": receipt_event["posture"],
               "safety_level": safety["level"], "billable_units": commercial["billable_units"],
               "charge_micro_usd": commercial["charge"]["amount_micro_usd"], "settlement": commercial["settlement"]}
    with open("receipts.jsonl", "a", encoding="utf-8") as kept:
        kept.write(json.dumps(receipt) + "\n")
    print(f"[Safety: {safety['level']} | {receipt_event['posture']} | {commercial['billable_units']} turn, "
          f"${commercial['charge']['amount_micro_usd'] / 1e6:.2f}, {commercial['settlement']} | Request: {request_id}]\n")


# 1. Prepare the session: your tutor's name, your course, your assignment. Free.
setup = {"display_name": CLASS["tutor_name"],
         "task": {"kind": "homework", "subject": CLASS["course"], "assignment": CLASS["assignment"]},
         "learner": {"grade_band": "adult"}, "team_dialog": False}
with post("/quest/sessions", {"setup": setup}) as response:
    session_id = json.load(response)["session_id"]

# 2. The tutor's opening, in its own name. An empty prompt with operation "opening".
turn(session_id, "Opening", "", "guided", operation="opening")

# 3. A student submits work: a Feedback turn.
turn(session_id, "Submit my work (Feedback)", "4x - 7 = 21\n4x = 14\nx = 3.5", "feedback")
