function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const buffer = new ArrayBuffer(clean.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJSON).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k]))
      .join(",") +
    "}"
  );
}

export async function verifyReceipt(
  payload: Record<string, unknown>,
  signatureHex: string,
  publicKeyHex: string
): Promise<boolean> {
  if (!payload || !signatureHex || !publicKeyHex) return false;

  try {
    const subtle = (globalThis.crypto as Crypto).subtle;
    const key = await subtle.importKey(
      "raw",
      hexToBytes(publicKeyHex),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    const message = new TextEncoder().encode(canonicalJSON(payload));
    return await subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signatureHex),
      message
    );
  } catch (err) {
    console.error("Signature verification failed", err);
    return false;
  }
}

export function shortHash(hex: string, n = 8): string {
  if (!hex) return "";
  return hex.length > n * 2 ? `${hex.slice(0, n)}…${hex.slice(-n)}` : hex;
}
