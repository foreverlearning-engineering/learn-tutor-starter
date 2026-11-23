"""Learn inside your own Python server. Python 3.11+, standard library only.

Call stream_turn(user_id, message) from your web framework's route and forward each
("text", part, text) event to your page, then the ("done", safety, receipt) event.

    python learn_embed.py "I'm stuck on 3x + 5 = 20. Can you just tell me what x is?"

runs one turn for a sample user. Reads FOREVERLEARNING_API_KEY, FOREVERLEARNING_BASE_URL,
LEARNER_ID_SECRET and (optional) FOREVERLEARNING_ASSIGNMENT_ID from the environment.
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
SECRET = os.environ.get("LEARNER_ID_SECRET") or "change-this-secret"
SETUP = {"task": {"kind": "homework", "subject": "Linear equations"}, "team_dialog": False}
SESSIONS = {}  # learner id -> Learn session id. Keep this in your database in production.


class LearnError(Exception):
    pass


def learner_id_for(user_id):
    """A pseudonymous learner id: a keyed hash of your own user id, never a name or an email."""
    return "learner-" + hmac.new(SECRET.encode(), user_id.encode(), hashlib.sha256).hexdigest()[:32]


def _post(learner, path, body):
    headers = {"Authorization": "Bearer " + KEY, "X-User-Id": learner, "FL-API-Version": "2026-12-01",
               "Content-Type": "application/json", "Idempotency-Key": str(uuid.uuid4()),
               "User-Agent": "learn-tutor-starter/1.0 (python)"}  # so your requests are easy to recognise
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
        raise LearnError(f"{error.code} {detail.get('code', '')}: {detail.get('message', '')} (request {detail.get('request_id', '')})")


def stream_turn(user_id, message):
    """Yield ("text", part, text) as the reply arrives, then ("done", safety, receipt)."""
    learner = learner_id_for(user_id)
    if learner not in SESSIONS:
        with _post(learner, "/quest/sessions", {"setup": SETUP}) as response:
            SESSIONS[learner] = json.load(response)["session_id"]
    session_id = SESSIONS[learner]
    body = {"session_id": session_id, "prompt": message, "posture": "guided",
            "quest": {"operation": "turn", "requested_support": "auto", "team_dialog": False}}
    request_id = safety = quest = commercial = None
    with _post(learner, "/chat", body) as response:
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
                yield ("text", event["part"], event["text"])
            elif kind == "safety_status":
                safety = event
            elif kind == "quest_receipt":
                quest = event["receipt"]
            elif kind == "done":
                commercial = event["commercial"]
            elif kind == "error":
                raise LearnError(f"{event['code']}: {event['message']} (request {event['request_id']})")
    if not commercial or commercial["request_id"] != request_id or not safety or not quest:
        raise LearnError(f"The turn was not confirmed. Look it up with GET /v1/requests/{request_id}, as the same learner (X-User-Id), before sending again.")
    receipt = {"request_id": request_id, "session_id": session_id, "learner_id": learner, "posture": quest["posture"],
               "safety_level": safety["level"], "billable_units": commercial["billable_units"],
               "charge_micro_usd": commercial["charge"]["amount_micro_usd"], "settlement": commercial["settlement"]}
    with open("receipts.jsonl", "a", encoding="utf-8") as kept:
        kept.write(json.dumps(receipt) + "\n")
    yield ("done", safety, receipt)


if __name__ == "__main__":
    sample_user = "u-" + str(uuid.uuid4())  # your product's own user id
    for event in stream_turn(sample_user, " ".join(sys.argv[1:]) or "I'm stuck on 3x + 5 = 20. Where do I start?"):
        if event[0] == "text":
            print(event[2], flush=True)
        else:
            _, safety, receipt = event
            print(f"\nSafety: {safety['level']} | Receipt: {receipt['billable_units']} turn, "
                  f"${receipt['charge_micro_usd'] / 1e6:.2f}, {receipt['settlement']} | Request: {receipt['request_id']}")
