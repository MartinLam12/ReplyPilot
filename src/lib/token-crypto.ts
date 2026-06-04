import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// AES-256-GCM: authenticated encryption that protects both confidentiality
// and integrity. 96-bit IV is the NIST-recommended size for GCM.
const ALGORITHM = "aes-256-gcm";
const ENCRYPTED_PREFIX = "enc:v1:";

function getKey(): Buffer {
  const raw = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY env var is not set. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY must be exactly 32 bytes (64 hex characters)"
    );
  }
  return key;
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV — standard for GCM
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return (
    ENCRYPTED_PREFIX +
    [iv, authTag, encrypted].map((b) => b.toString("hex")).join(".")
  );
}

// Returns the plaintext token. If the stored value was written before
// encryption was introduced (no "enc:v1:" prefix), it is returned as-is
// so existing connections continue to work until the user re-connects Gmail.
export function decryptToken(stored: string): string {
  if (!stored.startsWith(ENCRYPTED_PREFIX)) {
    return stored; // legacy plaintext — will be re-encrypted on next OAuth callback
  }
  const key = getKey();
  const body = stored.slice(ENCRYPTED_PREFIX.length);
  const parts = body.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token");
  }
  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");
  if (iv.length !== 12 || authTag.length !== 16) {
    throw new Error("Malformed encrypted token: wrong IV or auth tag length");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
