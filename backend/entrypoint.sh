#!/bin/sh
# Initialise the @moneydevkit/agent-wallet from MDK_WALLET_MNEMONIC env on
# every container start. The CLI persists config to ~/.mdk-wallet/ which is
# ephemeral on Railway, so we re-derive the wallet from the seed each boot.
# Subsequent starts return "Already initialized" — that's fine, swallow it.

if [ -z "${MDK_WALLET_MNEMONIC:-}" ]; then
  echo "[wallet] WARNING: MDK_WALLET_MNEMONIC not set — payouts will fail"
else
  echo "[wallet] init attempt..."
  npx @moneydevkit/agent-wallet@latest init 2>&1 || \
    echo "[wallet] init returned non-zero (ok if already initialized)"
fi

exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8001}"
