#!/usr/bin/env python3
"""
Reads MDK_MNEMONIC from a local .env file and uploads it as
MDK_WALLET_MNEMONIC on Railway (the env var name the agent-wallet CLI
expects on container startup).

Usage:
  RAILWAY_API_TOKEN=<token> python3 scripts/alias-mnemonic-to-wallet.py <env_file>
"""
import json
import os
import sys
import urllib.error
import urllib.request

PROJECT_ID = "5e7a74ec-420f-4163-9bac-4f21b341b07f"
ENVIRONMENT_ID = "d858f100-b4ae-4a21-ac87-98120090f10d"
SERVICE_ID = "22c69904-a443-4822-b941-22caca9b54f5"
API_URL = "https://backboard.railway.com/graphql/v2"

token = os.environ.get("RAILWAY_API_TOKEN")
if not token:
    sys.exit("RAILWAY_API_TOKEN env var is required")

if len(sys.argv) < 2:
    sys.exit("Usage: alias-mnemonic-to-wallet.py <env_file>")

path = sys.argv[1]
if not os.path.exists(path):
    sys.exit(f"{path} not found")

mnemonic = None
with open(path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        if name.strip() == "MDK_MNEMONIC":
            mnemonic = value.strip().strip('"').strip("'")
            break

if not mnemonic:
    sys.exit(f"MDK_MNEMONIC not found or empty in {path}")

mutation = "mutation Upsert($i: VariableUpsertInput!) { variableUpsert(input: $i) }"

for target_name in ("MDK_WALLET_MNEMONIC", "MDK_WALLET_NETWORK"):
    value = mnemonic if target_name == "MDK_WALLET_MNEMONIC" else "mainnet"
    payload = {
        "query": mutation,
        "variables": {
            "i": {
                "projectId": PROJECT_ID,
                "environmentId": ENVIRONMENT_ID,
                "serviceId": SERVICE_ID,
                "name": target_name,
                "value": value,
            }
        },
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "User-Agent": "vouch-deploy/1.0",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            result = json.load(resp)
    except urllib.error.HTTPError as e:
        print(f"  {target_name}: HTTP {e.code}")
        continue
    if result.get("errors"):
        print(f"  {target_name}: error")
    else:
        print(f"  {target_name}: ok")
