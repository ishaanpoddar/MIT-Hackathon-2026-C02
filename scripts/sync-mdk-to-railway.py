#!/usr/bin/env python3
"""
Reads MDK_* values from a Vercel-pulled .env file and uploads them to
the Railway backend service. Never echoes values to stdout.

Usage:
  RAILWAY_API_TOKEN=<token> python3 scripts/sync-mdk-to-railway.py <env_file>
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
WANTED_PREFIX = "MDK_"

token = os.environ.get("RAILWAY_API_TOKEN")
if not token:
    sys.exit("RAILWAY_API_TOKEN env var is required")

if len(sys.argv) < 2:
    sys.exit("Usage: sync-mdk-to-railway.py <env_file>")

path = sys.argv[1]
if not os.path.exists(path):
    sys.exit(f"{path} not found")

mutation = "mutation Upsert($i: VariableUpsertInput!) { variableUpsert(input: $i) }"

with open(path, encoding="utf-8") as f:
    lines = [
        line.strip()
        for line in f
        if line.strip()
        and not line.lstrip().startswith("#")
        and "=" in line
        and line.split("=", 1)[0].strip().startswith(WANTED_PREFIX)
    ]

if not lines:
    sys.exit(f"No {WANTED_PREFIX}* vars in {path}")

for line in lines:
    name, value = line.split("=", 1)
    name = name.strip()
    value = value.strip().strip('"').strip("'")
    if not value:
        print(f"  {name}: empty, skipping")
        continue
    payload = {
        "query": mutation,
        "variables": {
            "i": {
                "projectId": PROJECT_ID,
                "environmentId": ENVIRONMENT_ID,
                "serviceId": SERVICE_ID,
                "name": name,
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
        print(f"  {name}: HTTP {e.code}")
        continue

    if result.get("errors"):
        print(f"  {name}: error")
    else:
        print(f"  {name}: ok")
