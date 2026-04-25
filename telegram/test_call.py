"""
Quick end-to-end test: hits /verify, waits for you to reply in Telegram, prints the result.

Run this AFTER `uvicorn verifier_bot:app --port 8000` is running in another terminal.
"""

import httpx
import sys

QUESTION = "A 3-year-old has had persistent cough and fever for 8 days. " \
           "Mother is also coughing. What should I tell the parent?"
DOMAIN = "healthcare"

print(f"-> Sending verification request (domain={DOMAIN})")
print(f"   Question: {QUESTION}\n")
print("   Now check Telegram and reply to the message you receive...")

try:
    r = httpx.post(
        "http://localhost:8000/verify",
        json={"question": QUESTION, "domain": DOMAIN},
        timeout=180,
    )
    r.raise_for_status()
    data = r.json()
    print("\nVerifier responded:")
    print(f"  Request ID:  {data['request_id']}")
    print(f"  Verifier:    {data['verifier_name']} ({data['verifier_credentials']})")
    print(f"  Latency:     {data['latency_seconds']}s")
    print(f"  Answer:\n  {data['verified_answer']}")
except httpx.HTTPStatusError as e:
    print(f"\nHTTP {e.response.status_code}: {e.response.text}")
    sys.exit(1)
except Exception as e:
    print(f"\nError: {e}")
    sys.exit(1)
