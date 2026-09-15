function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  for (let index = 0; index < length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += byte.toString(16).padStart(2, "0");
  return text;
}

/** Lowercase hexadecimal text with the given number of digits. */
export function randomHex(digits: number): string {
  return hex(randomBytes(Math.ceil(digits / 2))).slice(0, digits);
}

/** A new random message identifier (UUID version 4). */
export function newMessageId(): string {
  const cryptoApi = typeof globalThis.crypto === "undefined" ? undefined : globalThis.crypto;
  if (cryptoApi !== undefined && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID();
  const bytes = randomBytes(16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const text = hex(bytes);
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}
