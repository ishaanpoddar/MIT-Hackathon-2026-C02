#!/usr/bin/env python3
"""
Reads selected env vars from frontend/.env and pushes them to Vercel
production via the `vercel` CLI. Overrides FASTAPI_URL +
NEXT_PUBLIC_APP_URL to point at the production URLs.

Run from repo root after `vercel login` is set up:
  python3 scripts/push-env-to-vercel.py
"""
import os
import subprocess
import sys

ENV_FILE = "frontend/.env"

# Vars to copy verbatim from frontend/.env
PASSTHROUGH = ["MDK_ACCESS_TOKEN", "MDK_MNEMONIC", "MDK_WEBHOOK_SECRET", "OPENAI_API_KEY"]

# Vars to set with explicit production values (overrides whatever local has)
OVERRIDES = {
    "FASTAPI_URL": "https://backend-production-372a.up.railway.app",
    "NEXT_PUBLIC_APP_URL": "https://vouch-hackathon-mit.vercel.app",
}

VERCEL_CWD = "frontend"  # vercel CLI must run from the linked project dir


def parse_env(path):
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            v = v.strip().strip('"').strip("'")
            out[k.strip()] = v
    return out


USE_SHELL = sys.platform == "win32"


def vercel_remove(key):
    subprocess.run(
        f'vercel env rm {key} production -y' if USE_SHELL
        else ["vercel", "env", "rm", key, "production", "-y"],
        cwd=VERCEL_CWD,
        capture_output=True,
        text=True,
        shell=USE_SHELL,
    )


def vercel_add(key, value):
    proc = subprocess.run(
        f'vercel env add {key} production' if USE_SHELL
        else ["vercel", "env", "add", key, "production"],
        cwd=VERCEL_CWD,
        input=value + "\n",
        capture_output=True,
        text=True,
        shell=USE_SHELL,
    )
    return proc.returncode == 0, (proc.stderr or proc.stdout)


def main():
    local = parse_env(ENV_FILE)

    if not local:
        sys.exit(f"{ENV_FILE} not found or empty")

    targets = {}
    for k in PASSTHROUGH:
        if local.get(k):
            targets[k] = local[k]
        else:
            print(f"skipping {k}: not in {ENV_FILE}")
    targets.update(OVERRIDES)

    for k, v in targets.items():
        if not v:
            print(f"  {k}: empty, skip")
            continue
        vercel_remove(k)
        ok, msg = vercel_add(k, v)
        marker = "ok" if ok else f"FAIL: {msg.strip()[:120]}"
        print(f"  {k}: {marker}")

    print("\nDone. Run `cd frontend && vercel --prod --yes` to redeploy.")


if __name__ == "__main__":
    main()
