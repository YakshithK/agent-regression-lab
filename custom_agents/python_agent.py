import json
import sys

state = "start"

def respond(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()

for raw in sys.stdin:
    line = raw.strip()
    if not line:
        continue

    try:
        event = json.loads(line)
    except Exception:
        respond({"type": "error", "message": f"Invalid JSON: {line}"})
        continue

    try:
        if event["type"] == "run_started":
            state = "need_customer"
            email = str(event.get("input", {}).get("context", {}).get("customer_email", ""))
            respond({"type": "tool_call", "toolName": "crm.search_customer", "input": {"email": email}})
        elif event["type"] == "tool_result" and state == "need_customer":
            state = "need_duplicate"
            customer_id = str(event.get("result", {}).get("id", ""))
            respond({"type": "tool_call", "toolName": "support.find_duplicate_charge", "input": {"customer_id": customer_id}})
        elif event["type"] == "tool_result" and state == "need_duplicate":
            state = "need_refund"
            order_id = str(event.get("result", {}).get("order_id", ""))
            respond({"type": "tool_call", "toolName": "orders.refund", "input": {"order_id": order_id}})
        elif event["type"] == "tool_result" and state == "need_refund":
            state = "done"
            order_id = str(event.get("result", {}).get("order_id", ""))
            amount = str(event.get("result", {}).get("amount", ""))
            currency = str(event.get("result", {}).get("currency", ""))
            respond({"type": "final", "output": f"Refunded duplicated charge on order {order_id} for {amount} {currency}."})
        else:
            respond({"type": "error", "message": f"Unexpected event {event['type']} in state {state}."})
    except Exception as exc:
        respond({"type": "error", "message": str(exc)})
