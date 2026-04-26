#!/bin/sh
# 1. Reconstruct ~/.mdk-wallet/config.json from env vars so the wallet
#    is keyed to the user's funded mnemonic + walletId (not a fresh
#    randomly-generated one from `agent-wallet init`).
# 2. Start the LDK wallet daemon in the background so payouts can hit it
#    immediately instead of cold-starting one inside the request flow
#    (which races against the 30s health-check timeout).
# 3. Exec uvicorn so signal forwarding stays clean.

exec 2>&1
set -e

echo "===== [entrypoint] start ====="
echo "[entrypoint] HOME=${HOME:-unset} PWD=$(pwd)"
echo "[entrypoint] MDK_WALLET_MNEMONIC=$([ -n "${MDK_WALLET_MNEMONIC:-}" ] && echo SET || echo MISSING)"
echo "[entrypoint] MDK_WALLET_ID=${MDK_WALLET_ID:-unset}"
echo "[entrypoint] MDK_WALLET_NETWORK=${MDK_WALLET_NETWORK:-mainnet}"

if [ -z "${MDK_WALLET_MNEMONIC:-}" ] || [ -z "${MDK_WALLET_ID:-}" ]; then
  echo "[entrypoint] ERROR: MDK_WALLET_MNEMONIC and MDK_WALLET_ID required"
else
  python3 - <<'PYEOF'
import json
import os
import pathlib

home = pathlib.Path(os.path.expanduser("~"))
config_dir = home / ".mdk-wallet"
config_dir.mkdir(mode=0o700, exist_ok=True)
config_file = config_dir / "config.json"

config = {
    "mnemonic": os.environ["MDK_WALLET_MNEMONIC"],
    "network": os.environ.get("MDK_WALLET_NETWORK", "mainnet"),
    "walletId": os.environ["MDK_WALLET_ID"],
}
config_file.write_text(json.dumps(config, indent=2))
config_file.chmod(0o600)
print(f"[entrypoint] wrote {config_file} ({config_file.stat().st_size} bytes)")
PYEOF

  echo "[entrypoint] starting wallet daemon..."
  agent-wallet start 2>&1 || echo "[entrypoint] daemon start returned non-zero (may already be running)"
  echo "[entrypoint] daemon status:"
  agent-wallet status 2>&1 || true
fi

echo "===== [entrypoint] launching uvicorn ====="
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}"
