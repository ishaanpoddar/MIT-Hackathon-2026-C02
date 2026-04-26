#!/bin/sh
# Initialise the @moneydevkit/agent-wallet from MDK_WALLET_MNEMONIC env on
# every container start. The CLI persists config to ~/.mdk-wallet/ which is
# ephemeral on Railway, so we re-derive the wallet from the seed each boot.

# Force unbuffered output so logs show up immediately on Railway.
exec 2>&1
set -e

echo "===== [entrypoint] start ====="
echo "[entrypoint] HOME=${HOME:-unset} PWD=$(pwd) USER=$(id -un 2>/dev/null || echo '?')"
echo "[entrypoint] MDK_WALLET_MNEMONIC=$([ -n "${MDK_WALLET_MNEMONIC:-}" ] && echo SET || echo MISSING)"
echo "[entrypoint] MDK_WALLET_NETWORK=${MDK_WALLET_NETWORK:-unset}"

if [ -n "${MDK_WALLET_MNEMONIC:-}" ]; then
  echo "[entrypoint] running: npx -y @moneydevkit/agent-wallet@latest init"
  if npx -y @moneydevkit/agent-wallet@latest init 2>&1; then
    echo "[entrypoint] init exit=0"
  else
    echo "[entrypoint] init exit=$? (often expected on subsequent restarts)"
  fi
  echo "[entrypoint] config dir contents:"
  ls -la "${HOME:-/root}/.mdk-wallet" 2>&1 || echo "  (no .mdk-wallet dir)"
else
  echo "[entrypoint] WARNING: skipping init, payouts will fail"
fi

echo "===== [entrypoint] launching uvicorn ====="
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}"
