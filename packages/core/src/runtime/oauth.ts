import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ConfigRegistry, Resource } from '../config/registry.js';
import { resolveRef } from '../config/ref.js';
import { ensureDir, readFileIfExists } from '../utils/fs.js';

interface OAuthManagerOptions {
  registry?: ConfigRegistry | null;
  stateDir?: string;
  encryptionKey?: string;
  publicBaseUrl?: string;
  logger?: Console;
  events?: { emit?: (event: string, payload: Record<string, unknown>) => void } | null;
}

interface OAuthTokenReady {
  status: 'ready';
  accessToken: string;
  tokenType?: string;
  expiresAt?: string;
  scopes?: string[];
}

interface OAuthTokenAuthorizationRequired {
  status: 'authorization_required';
  authSessionId: string;
  authorizationUrl: string;
  expiresAt: string;
  message: string;
}

interface OAuthTokenError {
  status: 'error';
  error: { code: string; message: string };
}

export type OAuthTokenResult = OAuthTokenReady | OAuthTokenAuthorizationRequired | OAuthTokenError;

interface OAuthRequest {
  oauthAppRef: { kind: string; name: string };
  scopes?: string[];
  minTtlSeconds?: number;
}

interface TurnAuthContext {
  actor?: Record<string, unknown>;
  subjects?: { global?: string; user?: string };
}

interface OAuthContext {
  auth?: TurnAuthContext;
  origin?: Record<string, unknown>;
  swarmRef?: { kind: string; name: string };
  instanceKey?: string;
  agentName?: string;
}

interface OAuthContext {
  auth?: TurnAuthContext;
  origin?: Record<string, unknown>;
  swarmRef?: { kind: string; name: string };
  instanceKey?: string;
  agentName?: string;
}

interface OAuthAppResource extends Resource {
  spec?: {
    provider?: string;
    flow?: 'authorizationCode' | 'deviceCode';
    subjectMode?: 'global' | 'user';
    client?: {
      clientId?: ValueSource;
      clientSecret?: ValueSource;
    };
    endpoints?: {
      authorizationUrl?: string;
      tokenUrl?: string;
    };
    scopes?: string[];
    redirect?: { callbackPath?: string };
    options?: Record<string, unknown>;
  };
}

interface ValueSource {
  value?: string;
  valueFrom?: {
    env?: string;
    secretRef?: { ref: string; key: string };
  };
}

type EncryptedString = string;

interface OAuthGrantRecord {
  apiVersion?: string;
  kind: 'OAuthGrantRecord';
  metadata: { name: string };
  spec: {
    provider: string;
    oauthAppRef: { kind: string; name: string };
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
    providerData?: Record<string, unknown>;
  };
}

interface AuthSessionRecord {
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
    resume?: Record<string, unknown>;
  };
}

class OAuthStore {
  private rootDir: string;
  private key: Buffer;

  constructor(rootDir: string, key: Buffer) {
    this.rootDir = rootDir;
    this.key = key;
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

  private async loadSessionIndex(): Promise<Record<string, string>> {
    const content = await readFileIfExists(this.sessionIndexPath());
    if (!content) return {};
    return JSON.parse(content) as Record<string, string>;
  }

  encrypt(value: string): EncryptedString {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    const payload = {
      alg: 'A256GCM',
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64'),
    };
    return `enc:${Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')}`;
  }

  decrypt(value: EncryptedString): string {
    if (!value.startsWith('enc:')) {
      return value;
    }
    const payloadJson = Buffer.from(value.slice(4), 'base64').toString('utf8');
    const payload = JSON.parse(payloadJson) as { iv: string; tag: string; data: string };
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const encrypted = Buffer.from(payload.data, 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  }
}

export class OAuthManager {
  private registry: ConfigRegistry | null;
  private stateDir: string;
  private publicBaseUrl: string | null;
  private logger: Console;
  private store: OAuthStore;
  private events: OAuthManagerOptions['events'];

  constructor(options: OAuthManagerOptions = {}) {
    this.registry = options.registry || null;
    this.stateDir = options.stateDir || path.join(process.cwd(), 'state');
    this.publicBaseUrl = options.publicBaseUrl || process.env.GOONDAN_PUBLIC_URL || null;
    this.logger = options.logger || console;
    const key = loadEncryptionKey(options.encryptionKey || process.env.GOONDAN_OAUTH_KEY, this.logger);
    this.store = new OAuthStore(path.join(this.stateDir, 'oauth'), key);
    this.events = options.events || null;
  }

  setRegistry(registry: ConfigRegistry): void {
    this.registry = registry;
  }

  withContext(context?: OAuthContext): { getAccessToken: (request: OAuthRequest) => Promise<OAuthTokenResult> } {
    return {
      getAccessToken: (request: OAuthRequest) => this.getAccessToken(request, context),
    };
  }

  async getAccessToken(request: OAuthRequest, context?: OAuthContext): Promise<OAuthTokenResult> {
    if (!this.registry) {
      return { status: 'error', error: { code: 'registryMissing', message: 'Config registry가 설정되지 않았습니다.' } };
    }

    const oauthApp = resolveRef(this.registry, request.oauthAppRef, 'OAuthApp') as OAuthAppResource | null;
    if (!oauthApp) {
      return { status: 'error', error: { code: 'oauthAppNotFound', message: 'OAuthApp을 찾을 수 없습니다.' } };
    }

    if (oauthApp.spec?.flow === 'deviceCode') {
      return { status: 'error', error: { code: 'deviceCodeUnsupported', message: 'deviceCode 플로우는 지원하지 않습니다.' } };
    }

    const subjectMode = oauthApp.spec?.subjectMode || 'global';
    const subject = subjectMode === 'global' ? context?.auth?.subjects?.global : context?.auth?.subjects?.user;
    if (!subject) {
      return {
        status: 'error',
        error: { code: 'subjectUnavailable', message: `turn.auth.subjects.${subjectMode} 값이 없습니다.` },
      };
    }

    const scopes = request.scopes || oauthApp.spec?.scopes || [];
    if (!isSubset(scopes, oauthApp.spec?.scopes || [])) {
      return { status: 'error', error: { code: 'invalidScopes', message: '요청 스코프가 OAuthApp 범위를 벗어났습니다.' } };
    }

    const subjectHash = hashSubject(oauthApp.metadata.name, subject);
    const grant = await this.store.loadGrant(subjectHash);
    const now = new Date();
    const minTtlSeconds = request.minTtlSeconds ?? 60;

    if (grant && !grant.spec.revoked) {
      const expiresAt = grant.spec.token.expiresAt ? new Date(grant.spec.token.expiresAt) : null;
      const isValid = !expiresAt || expiresAt.getTime() - now.getTime() > minTtlSeconds * 1000;
      const scopeOk = isSubset(scopes, grant.spec.scopesGranted || []);
      if (isValid && scopeOk) {
        return {
          status: 'ready',
          accessToken: this.store.decrypt(grant.spec.token.accessToken),
          tokenType: grant.spec.token.tokenType,
          expiresAt: grant.spec.token.expiresAt,
          scopes: grant.spec.scopesGranted,
        };
      }

      if (!isValid && grant.spec.token.refreshToken && oauthApp.spec?.endpoints?.tokenUrl) {
        const refreshed = await refreshGrant({
          oauthApp,
          grant,
          stateDir: this.stateDir,
          store: this.store,
          logger: this.logger,
        });
        if (refreshed) {
          return {
            status: 'ready',
            accessToken: this.store.decrypt(refreshed.spec.token.accessToken),
            tokenType: refreshed.spec.token.tokenType,
            expiresAt: refreshed.spec.token.expiresAt,
            scopes: refreshed.spec.scopesGranted,
          };
        }
      }
    }
    const authSession = await this.createAuthorizationSession({
      oauthApp,
      subject,
      scopes,
      resume: buildResumePayload(context),
    });
    const clientId = await resolveValueSource(oauthApp.spec?.client?.clientId, this.stateDir);
    const authorizationUrl = buildAuthorizationUrl(authSession, oauthApp, this.publicBaseUrl, {
      clientId,
      state: this.store.decrypt(authSession.spec.flow.state),
    });
    return {
      status: 'authorization_required',
      authSessionId: authSession.metadata.name,
      authorizationUrl,
      expiresAt: authSession.spec.expiresAt,
      message: '외부 서비스 연결이 필요합니다. 아래 링크에서 승인을 완료하면 작업을 이어갈 수 있습니다.',
    };
  }

  async handleAuthorizationCallback({ state, code }: { state: string; code: string }): Promise<OAuthTokenResult> {
    if (!this.registry) {
      return { status: 'error', error: { code: 'registryMissing', message: 'Config registry가 설정되지 않았습니다.' } };
    }

    const stateHash = hashValue(state);
    const session = await this.store.findSessionByStateHash(stateHash);
    if (!session) {
      return { status: 'error', error: { code: 'sessionNotFound', message: 'AuthSession을 찾을 수 없습니다.' } };
    }

    if (session.spec.status !== 'pending') {
      return { status: 'error', error: { code: 'sessionInvalid', message: 'AuthSession 상태가 유효하지 않습니다.' } };
    }

    if (new Date(session.spec.expiresAt).getTime() < Date.now()) {
      session.spec.status = 'expired';
      await this.store.updateSession(session);
      return { status: 'error', error: { code: 'sessionExpired', message: 'AuthSession이 만료되었습니다.' } };
    }

    const oauthApp = resolveRef(this.registry, session.spec.oauthAppRef, 'OAuthApp') as OAuthAppResource | null;
    if (!oauthApp) {
      return { status: 'error', error: { code: 'oauthAppNotFound', message: 'OAuthApp을 찾을 수 없습니다.' } };
    }

    const tokenUrl = oauthApp.spec?.endpoints?.tokenUrl;
    if (!tokenUrl) {
      return { status: 'error', error: { code: 'tokenUrlMissing', message: 'tokenUrl이 설정되지 않았습니다.' } };
    }

    const clientId = await resolveValueSource(oauthApp.spec?.client?.clientId, this.stateDir);
    const clientSecret = await resolveValueSource(oauthApp.spec?.client?.clientSecret, this.stateDir);
    const codeVerifier = this.store.decrypt(session.spec.flow.pkce.codeVerifier);

    const redirectUri = buildRedirectUri(oauthApp, this.publicBaseUrl);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId || '',
      code_verifier: codeVerifier,
    });
    if (clientSecret) {
      body.set('client_secret', clientSecret);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });

    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      session.spec.status = 'failed';
      await this.store.updateSession(session);
      return { status: 'error', error: { code: 'tokenExchangeFailed', message: JSON.stringify(payload) } };
    }

    const accessToken = payload.access_token as string | undefined;
    if (!accessToken) {
      session.spec.status = 'failed';
      await this.store.updateSession(session);
      return { status: 'error', error: { code: 'tokenMissing', message: 'access_token이 없습니다.' } };
    }

    const now = new Date();
    const expiresAt = payload.expires_in
      ? new Date(now.getTime() + Number(payload.expires_in) * 1000).toISOString()
      : undefined;

    if (!verifySubjectMatch(oauthApp, session.spec.subject, payload)) {
      session.spec.status = 'failed';
      await this.store.updateSession(session);
      return { status: 'error', error: { code: 'subjectMismatch', message: 'OAuth subject 검증에 실패했습니다.' } };
    }

    const tokenType = typeof payload.token_type === 'string' ? payload.token_type : undefined;
    const refreshToken = typeof payload.refresh_token === 'string' ? payload.refresh_token : undefined;

    const grant: OAuthGrantRecord = {
      apiVersion: oauthApp.apiVersion,
      kind: 'OAuthGrantRecord',
      metadata: { name: `sha256:${hashValue(session.spec.subject)}` },
      spec: {
        provider: oauthApp.spec?.provider || 'unknown',
        oauthAppRef: { kind: 'OAuthApp', name: oauthApp.metadata.name },
        subject: session.spec.subject,
        flow: 'authorization_code',
        scopesGranted: session.spec.requestedScopes,
        token: {
          tokenType,
          accessToken: this.store.encrypt(accessToken),
          refreshToken: refreshToken ? this.store.encrypt(refreshToken) : undefined,
          expiresAt,
        },
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        revoked: false,
        providerData: payload,
      },
    };

    const subjectHash = hashSubject(oauthApp.metadata.name, session.spec.subject);
    await this.store.saveGrant(subjectHash, grant);

    session.spec.status = 'completed';
    await this.store.updateSession(session);

    if (session.spec.resume) {
      this.events?.emit?.('auth.granted', { resume: session.spec.resume });
    }

    return {
      status: 'ready',
      accessToken,
      tokenType,
      expiresAt,
      scopes: session.spec.requestedScopes,
    };
  }

  private async createAuthorizationSession({
    oauthApp,
    subject,
    scopes,
    resume,
  }: {
    oauthApp: OAuthAppResource;
    subject: string;
    scopes: string[];
    resume?: Record<string, unknown>;
  }): Promise<AuthSessionRecord> {
    const sessionId = `as-${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    const codeVerifier = base64Url(crypto.randomBytes(32));
    const codeChallenge = base64Url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64Url(crypto.randomBytes(16));

    const session: AuthSessionRecord = {
      apiVersion: oauthApp.apiVersion,
      kind: 'AuthSessionRecord',
      metadata: { name: sessionId },
      spec: {
        provider: oauthApp.spec?.provider || 'unknown',
        oauthAppRef: { kind: 'OAuthApp', name: oauthApp.metadata.name },
        subjectMode: oauthApp.spec?.subjectMode || 'global',
        subject,
        requestedScopes: scopes,
        flow: {
          type: 'authorization_code',
          pkce: {
            method: 'S256',
            codeVerifier: this.store.encrypt(codeVerifier),
            codeChallenge,
          },
          state: this.store.encrypt(state),
          stateHash: hashValue(state),
        },
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt,
        resume,
      },
    };

    await this.store.saveSession(session);
    return session;
  }
}

function isSubset(target: string[], allowed: string[]): boolean {
  return target.every((value) => allowed.includes(value));
}

function hashSubject(appName: string, subject: string): string {
  return hashValue(`${appName}:${subject}`);
}

function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function loadEncryptionKey(rawKey: string | undefined, logger: Console): Buffer {
  if (!rawKey) {
    logger.warn('GOONDAN_OAUTH_KEY가 없어 임시 키를 생성했습니다. 재시작 시 토큰 복호화가 불가능할 수 있습니다.');
    return crypto.randomBytes(32);
  }
  if (rawKey.startsWith('base64:')) {
    const buf = Buffer.from(rawKey.replace('base64:', ''), 'base64');
    if (buf.length !== 32) throw new Error('GOONDAN_OAUTH_KEY는 32바이트여야 합니다.');
    return buf;
  }
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex');
  }
  const buf = Buffer.from(rawKey, 'base64');
  if (buf.length !== 32) {
    throw new Error('GOONDAN_OAUTH_KEY는 32바이트여야 합니다.');
  }
  return buf;
}

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildResumePayload(context?: OAuthContext): Record<string, unknown> | undefined {
  if (!context?.swarmRef || !context.instanceKey || !context.agentName) return undefined;
  return {
    swarmRef: context.swarmRef,
    instanceKey: context.instanceKey,
    agentName: context.agentName,
    origin: context.origin,
    auth: context.auth,
  };
}

function verifySubjectMatch(oauthApp: OAuthAppResource, subject: string, payload: Record<string, unknown>): boolean {
  const provider = oauthApp.spec?.provider || 'unknown';
  if (provider === 'slack') {
    const teamId = extractSlackTeamId(payload);
    const userId = extractSlackUserId(payload);
    if (subject.startsWith('slack:team:')) {
      return teamId ? subject === `slack:team:${teamId}` : false;
    }
    if (subject.startsWith('slack:user:')) {
      if (!teamId || !userId) return false;
      return subject === `slack:user:${teamId}:${userId}`;
    }
    return false;
  }

  const candidate = (payload.subject || payload.sub || payload.user_id) as string | undefined;
  if (candidate) {
    return candidate === subject;
  }
  return false;
}

function extractSlackTeamId(payload: Record<string, unknown>): string | undefined {
  const team = payload.team as { id?: string } | undefined;
  return team?.id || (payload.team_id as string | undefined);
}

function extractSlackUserId(payload: Record<string, unknown>): string | undefined {
  const authedUser = payload.authed_user as { id?: string } | undefined;
  return authedUser?.id || (payload.user_id as string | undefined);
}

async function refreshGrant(options: {
  oauthApp: OAuthAppResource;
  grant: OAuthGrantRecord;
  stateDir: string;
  store: OAuthStore;
  logger: Console;
}): Promise<OAuthGrantRecord | null> {
  const { oauthApp, grant, stateDir, store, logger } = options;
  const tokenUrl = oauthApp.spec?.endpoints?.tokenUrl;
  if (!tokenUrl) return null;
  const refreshToken = grant.spec.token.refreshToken;
  if (!refreshToken) return null;

  const clientId = await resolveValueSource(oauthApp.spec?.client?.clientId, stateDir);
  const clientSecret = await resolveValueSource(oauthApp.spec?.client?.clientSecret, stateDir);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: store.decrypt(refreshToken),
    client_id: clientId || '',
  });
  if (clientSecret) {
    body.set('client_secret', clientSecret);
  }

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!response.ok) {
    logger.warn('OAuth refresh 실패', payload);
    return null;
  }

  const accessToken = payload.access_token as string | undefined;
  if (!accessToken) return null;

  const now = new Date();
  const expiresAt = payload.expires_in
    ? new Date(now.getTime() + Number(payload.expires_in) * 1000).toISOString()
    : grant.spec.token.expiresAt;

  const updated: OAuthGrantRecord = {
    ...grant,
    spec: {
      ...grant.spec,
      token: {
        tokenType: payload.token_type || grant.spec.token.tokenType,
        accessToken: store.encrypt(accessToken),
        refreshToken: payload.refresh_token ? store.encrypt(payload.refresh_token) : grant.spec.token.refreshToken,
        expiresAt,
      },
      updatedAt: now.toISOString(),
    },
  };

  const subjectHash = hashSubject(oauthApp.metadata.name, grant.spec.subject);
  await store.saveGrant(subjectHash, updated);
  return updated;
}

async function resolveValueSource(source: ValueSource | undefined, stateDir: string): Promise<string | undefined> {
  if (!source) return undefined;
  if (source.value) return source.value;
  if (source.valueFrom?.env) return process.env[source.valueFrom.env];
  if (source.valueFrom?.secretRef) {
    const { ref, key } = source.valueFrom.secretRef;
    const [kind, name] = ref.split('/');
    if (kind !== 'Secret' || !name) return undefined;
    const envKey = `GOONDAN_SECRET_${name}_${key}`.toUpperCase();
    if (process.env[envKey]) return process.env[envKey];
    const secretPath = path.join(stateDir, 'secrets', `${name}.json`);
    const content = await readFileIfExists(secretPath);
    if (!content) return undefined;
    const secret = JSON.parse(content) as Record<string, string>;
    return secret[key];
  }
  return undefined;
}

function buildAuthorizationUrl(
  session: AuthSessionRecord,
  oauthApp: OAuthAppResource,
  publicBaseUrl: string | null,
  options: { clientId?: string; state: string }
): string {
  const authUrl = oauthApp.spec?.endpoints?.authorizationUrl || '';
  if (!authUrl) return '';
  const clientId = options.clientId || '';
  const redirectUri = buildRedirectUri(oauthApp, publicBaseUrl);
  const state = options.state;
  const scope = session.spec.requestedScopes.join(' ');

  const url = new URL(authUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  if (redirectUri) {
    url.searchParams.set('redirect_uri', redirectUri);
  }
  if (scope) {
    url.searchParams.set('scope', scope);
  }
  url.searchParams.set('code_challenge', session.spec.flow.pkce.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);

  return url.toString();
}

function buildRedirectUri(oauthApp: OAuthAppResource, publicBaseUrl: string | null): string {
  const callbackPath = oauthApp.spec?.redirect?.callbackPath || '';
  if (!publicBaseUrl) return callbackPath;
  return `${publicBaseUrl.replace(/\/$/, '')}${callbackPath}`;
}
