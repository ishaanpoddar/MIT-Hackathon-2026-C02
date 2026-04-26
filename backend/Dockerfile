FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates gnupg \
 && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

# Pre-install the MDK agent-wallet so the daemon binary is on PATH and
# we don't pay the npx download cost on every payout call.
RUN npm install -g @moneydevkit/agent-wallet@0.16.0

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN chmod +x entrypoint.sh

ENV PORT=8001
EXPOSE 8001
CMD ["./entrypoint.sh"]
