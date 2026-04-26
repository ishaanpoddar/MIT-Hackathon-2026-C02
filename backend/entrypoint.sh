#!/bin/sh
# Reconstruct the user's funded MDK agent wallet on every container start
# by writing ~/.mdk-wallet/config.json from env vars. This bypasses
# `agent-wallet init`, which would generate a fresh random mnemonic.

exec 2>&1
set -e

echo "===== [entrypoint] start ====="
echo "[entrypoint] HOME=${HOME:-unset} PWD=$(pwd)"
echo "[entrypoint] MDK_WALLET_MNEMONIC=$([ -n "${MDK_WALLET_MNEMONIC:-}" ] && echo SET || echo MISSING)"
echo "[entrypoint] MDK_WALLET_ID=${MDK_WALLET_ID:-unset}"
echo "[entrypoint] MDK_WALLET_NETWORK=${MDK_WALLET_NETWORK:-mainnet}"

if [ -z "${MDK_WALLET_MNEMONIC:-}" ] || [ -z "${MDK_WALLET_ID:-}" ]; then
  echo "[entrypoint] ERROR: MDK_WALLET_MNEMONIC and MDK_WALLET_ID required for payouts"
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
print(f"[entrypoint] wrote {config_file} ({len(config_file.read_text())} bytes)")
PYEOF
fi

echo "===== [entrypoint] launching uvicorn ====="
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}"
