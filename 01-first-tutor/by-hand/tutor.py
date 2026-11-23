"""Your first tutor, in the terminal. Python 3.11+, standard library only.

    python tutor.py                      # chat until you press Enter on an empty line
    python tutor.py "I'm stuck on ..."   # send one message and stop

Reads FOREVERLEARNING_API_KEY, FOREVERLEARNING_BASE_URL and (optional)
FOREVERLEARNING_ASSIGNMENT_ID from the environment. Each turn that succeeds costs 5 cents.
"""
import json
import os
import sys
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("FOREVERLEARNING_BASE_URL", "https://developers-api.foreverlearning.ai/v1").rstrip("/")
KEY = os.environ["FOREVERLEARNING_API_KEY"]
ASSIGNMENT = os.environ.get("FOREVERLEARNING_ASSIGNMENT_ID", "")
LEARNER = "learner-" + str(uuid.uuid4())  # pseudonymous: never a name or an email


def post(path, body):
    headers = {
        "Authorization": "Bearer " + KEY,
        "X-User-Id": LEARNER,
        "FL-API-Version": "2026-12-01",
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid4()),
        # Send your own User-Agent, so your requests are easy to recognize.
        "User-Agent": "learn-tutor-starter/1.0 (python)",
    }
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


def create_session():
    """Prepare a session. Nothing is generated and nothing is charged."""
    with post("/quest/sessions", {"setup": {"task": {"kind": "homework"}, "team_dialog": False}}) as response:
        return json.load(response)["session_id"]


def send_turn(session_id, prompt):
    """Send one Guided turn, print the reply when it arrives, and return the receipt."""
    body = {"session_id": session_id, "prompt": prompt, "posture": "guided",
            "quest": {"operation": "turn", "requested_support": "auto", "team_dialog": False}}
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
                print(event["text"], flush=True)
            elif kind == "safety_status":
                safety = event
            elif kind == "quest_receipt":
                receipt_event = event["receipt"]
            elif kind == "done":
                commercial = event["commercial"]
            elif kind == "error":
                raise SystemExit(f"{event['code']}: {event['message']} (request {event['request_id']})")
    # A turn counts only when the final event confirms it with the same identity.
    if not commercial or commercial["request_id"] != request_id or not safety or not receipt_event:
        raise SystemExit(f"The turn was not confirmed. Look it up with GET /v1/requests/{request_id}, as the same learner (X-User-Id), before sending again.")
    receipt = {"request_id": request_id, "session_id": session_id, "learner_id": LEARNER, "posture": receipt_event["posture"],
               "safety_level": safety["level"], "billable_units": commercial["billable_units"],
               "charge_micro_usd": commercial["charge"]["amount_micro_usd"], "settlement": commercial["settlement"]}
    with open("receipts.jsonl", "a", encoding="utf-8") as kept:
        kept.write(json.dumps(receipt) + "\n")
    print(f"\nSafety: {safety['level']} · Receipt: {commercial['billable_units']} turn, "
          f"${commercial['charge']['amount_micro_usd'] / 1e6:.2f}, {commercial['settlement']} · Request: {request_id}\n")
    return receipt


def main():
    session_id = create_session()
    if len(sys.argv) > 1:
        send_turn(session_id, " ".join(sys.argv[1:]))
        return
    while message := input("You: ").strip():
        send_turn(session_id, message)


if __name__ == "__main__":
    main()
