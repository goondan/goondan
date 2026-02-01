import crypto from 'node:crypto';

export type EncryptedString = string;

export type EncryptionCodec = {
  encrypt: (value: string) => EncryptedString;
  decrypt: (value: EncryptedString) => string;
};

export function createAes256GcmCodec(key: Buffer): EncryptionCodec {
  return {
    encrypt(value: string): EncryptedString {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      const tag = cipher.getAuthTag();

      const payload = {
        alg: 'A256GCM',
        iv: iv.toString('base64'),
        tag: tag.toString('base64'),
        data: encrypted.toString('base64'),
      };
      return `enc:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
    },
    decrypt(value: EncryptedString): string {
      if (!value.startsWith('enc:')) {
        return value;
      }
      const payloadJson = Buffer.from(value.slice(4), 'base64').toString('utf8');
      const payload = JSON.parse(payloadJson) as { iv: string; tag: string; data: string };
      const iv = Buffer.from(payload.iv, 'base64');
      const tag = Buffer.from(payload.tag, 'base64');
      const encrypted = Buffer.from(payload.data, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      return decrypted.toString('utf8');
    },
  };
}

export function loadEncryptionKey(rawKey: string | undefined, keyLabel: string): Buffer {
  if (!rawKey) {
    throw new Error(`${keyLabel}가 필요합니다. 32바이트 키를 설정하세요.`);
  }
  if (rawKey.startsWith('base64:')) {
    const buf = Buffer.from(rawKey.replace('base64:', ''), 'base64');
    if (buf.length !== 32) throw new Error(`${keyLabel}는 32바이트여야 합니다.`);
    return buf;
  }
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  const buf = Buffer.from(rawKey, 'base64');
  if (buf.length !== 32) {
    throw new Error(`${keyLabel}는 32바이트여야 합니다.`);
  }
  return buf;
}
