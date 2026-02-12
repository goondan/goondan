export interface DistIntegrity {
  shasum: string;
  integrity: string;
}

function toDigestBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

export async function sha1Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-1", toDigestBuffer(data));
  return toHex(new Uint8Array(digest));
}

export async function sha512Base64(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-512", toDigestBuffer(data));
  return toBase64(new Uint8Array(digest));
}

export async function createDistIntegrity(data: Uint8Array): Promise<DistIntegrity> {
  const shasum = await sha1Hex(data);
  const sha512 = await sha512Base64(data);

  return {
    shasum,
    integrity: `sha512-${sha512}`,
  };
}

export function decodeBase64(value: string): Uint8Array | null {
  try {
    if (typeof atob === "function") {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        const code = binary.charCodeAt(index);
        bytes[index] = code;
      }

      return bytes;
    }

    if (typeof Buffer !== "undefined") {
      return new Uint8Array(Buffer.from(value, "base64"));
    }

    return null;
  } catch {
    return null;
  }
}

function toHex(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) {
    value += byte.toString(16).padStart(2, "0");
  }

  return value;
}

function toBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary);
  }

  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  throw new Error("Base64 encoder is not available in this runtime");
}
