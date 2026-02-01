import fs from 'node:fs/promises';
import path from 'node:path';
import type { AuthResumePayload, JsonObject, ObjectRefLike } from '../sdk/types.js';
import { ensureDir, readFileIfExists } from '../utils/fs.js';
import type { EncryptedString, EncryptionCodec } from '../utils/encryption.js';

export type StringMap = { [key: string]: string };

export interface OAuthGrantRecord {
  apiVersion?: string;
  kind: 'OAuthGrantRecord';
  metadata: { name: string };
  spec: {
    provider: string;
    oauthAppRef: ObjectRefLike;
    subject: string;
    flow: 'authorization_code' | 'device_code';
    scopesGranted: string[];
    token: {
      tokenType?: string;
      accessToken: EncryptedString;
      refreshToken?: EncryptedString;
      expiresAt?: string;
    };
    createdAt: string;
    updatedAt: string;
    revoked?: boolean;
    providerData?: JsonObject;
  };
}

export interface AuthSessionRecord {
  apiVersion?: string;
  kind: 'AuthSessionRecord';
  metadata: { name: string };
  spec: {
    provider: string;
    oauthAppRef: { kind: string; name: string };
    subjectMode: 'global' | 'user';
    subject: string;
    requestedScopes: string[];
    flow: {
      type: 'authorization_code';
      pkce: {
        method: 'S256';
        codeVerifier: EncryptedString;
        codeChallenge: string;
      };
      state: EncryptedString;
      stateHash: string;
    };
    status: 'pending' | 'completed' | 'failed' | 'expired';
    createdAt: string;
    expiresAt: string;
    resume?: AuthResumePayload;
  };
}

export class OAuthStore {
  private rootDir: string;
  private codec: EncryptionCodec;

  constructor(rootDir: string, codec: EncryptionCodec) {
    this.rootDir = rootDir;
    this.codec = codec;
  }

  private grantPath(subjectHash: string) {
    return path.join(this.rootDir, 'grants', `${subjectHash}.json`);
  }

  private sessionPath(sessionId: string) {
    return path.join(this.rootDir, 'sessions', `${sessionId}.json`);
  }

  private sessionIndexPath() {
    return path.join(this.rootDir, 'sessions', 'index.json');
  }

  async ensure(): Promise<void> {
    await ensureDir(path.join(this.rootDir, 'grants'));
    await ensureDir(path.join(this.rootDir, 'sessions'));
  }

  async loadGrant(subjectHash: string): Promise<OAuthGrantRecord | null> {
    const content = await readFileIfExists(this.grantPath(subjectHash));
    if (!content) return null;
    return JSON.parse(content) as OAuthGrantRecord;
  }

  async saveGrant(subjectHash: string, record: OAuthGrantRecord): Promise<void> {
    await this.ensure();
    await fs.writeFile(this.grantPath(subjectHash), JSON.stringify(record, null, 2), 'utf8');
  }

  async loadSession(sessionId: string): Promise<AuthSessionRecord | null> {
    const content = await readFileIfExists(this.sessionPath(sessionId));
    if (!content) return null;
    return JSON.parse(content) as AuthSessionRecord;
  }

  async saveSession(record: AuthSessionRecord): Promise<void> {
    await this.ensure();
    await fs.writeFile(this.sessionPath(record.metadata.name), JSON.stringify(record, null, 2), 'utf8');
    await this.indexSession(record);
  }

  async updateSession(record: AuthSessionRecord): Promise<void> {
    await fs.writeFile(this.sessionPath(record.metadata.name), JSON.stringify(record, null, 2), 'utf8');
  }

  async findSessionByStateHash(stateHash: string): Promise<AuthSessionRecord | null> {
    const index = await this.loadSessionIndex();
    const sessionId = index[stateHash];
    if (!sessionId) return null;
    return this.loadSession(sessionId);
  }

  private async indexSession(record: AuthSessionRecord): Promise<void> {
    const index = await this.loadSessionIndex();
    index[record.spec.flow.stateHash] = record.metadata.name;
    await fs.writeFile(this.sessionIndexPath(), JSON.stringify(index, null, 2), 'utf8');
  }

  private async loadSessionIndex(): Promise<StringMap> {
    const content = await readFileIfExists(this.sessionIndexPath());
    if (!content) return {};
    return JSON.parse(content) as StringMap;
  }

  encrypt(value: string): EncryptedString {
    return this.codec.encrypt(value);
  }

  decrypt(value: EncryptedString): string {
    return this.codec.decrypt(value);
  }
}
