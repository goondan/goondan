/**
 * OAuthManager 구현
 * @see /docs/specs/oauth.md - 12. OAuthManager 구현
 */

import { randomBytes } from 'crypto';
import type { OAuthStore } from './store.js';
import { generateGrantId } from './store.js';
import type {
  OAuthTokenRequest,
  OAuthTokenResult,
  TurnAuth,
  EncryptedValue,
  AuthSessionRecord,
  ObjectRef,
  ObjectRefLike,
} from './types.js';
import type { OAuthAppSpec, OAuthAppResource } from '../types/specs/oauth-app.js';
import type { ValueSource } from '../types/value-source.js';
import { resolveSubject } from './subject.js';
import { generatePKCE } from './pkce.js';
import { generateState, buildAuthorizationUrl, validateScopes } from './authorization.js';
import { isTokenValid, needsRefresh, createRefreshManager } from './token.js';

/**
 * OAuthManager 인터페이스
 */
export interface OAuthManager {
  /** 토큰 조회 (Tool/Connector용) */
  getAccessToken(
    request: OAuthTokenRequest,
    turnAuth: TurnAuth
  ): Promise<OAuthTokenResult>;
}

/**
 * Config Loader 인터페이스
 */
export interface ConfigLoader {
  getOAuthApp(ref: ObjectRefLike): Promise<OAuthAppResource | null>;
  resolveValueSource(source: ValueSource): string;
}

/**
 * OAuthManager 의존성
 */
export interface OAuthManagerDependencies {
  store: OAuthStore;
  configLoader: ConfigLoader;
  encrypt: (plaintext: string) => Promise<EncryptedValue>;
  decrypt: (encrypted: EncryptedValue) => Promise<string>;
  baseCallbackUrl: string;
  sessionTtlSeconds?: number;
  defaultResumeInfo?: Partial<AuthSessionRecord['spec']['resume']>;
}

/**
 * ObjectRefLike를 ObjectRef로 정규화
 */
function normalizeObjectRef(ref: ObjectRefLike): ObjectRef {
  if (typeof ref === 'string') {
    const parts = ref.split('/');
    const kind = parts[0];
    const name = parts[1];
    if (parts.length === 2 && kind !== undefined && name !== undefined) {
      return { kind, name };
    }
    throw new Error(`Invalid ObjectRefLike string: ${ref}`);
  }
  return ref;
}

/**
 * OAuthManager 생성
 */
export function createOAuthManager(deps: OAuthManagerDependencies): OAuthManager {
  const {
    store,
    configLoader,
    encrypt,
    decrypt,
    baseCallbackUrl,
    sessionTtlSeconds = 600, // 기본 10분
    defaultResumeInfo,
  } = deps;

  // Refresh Manager (single-flight 패턴)
  const refreshManager = createRefreshManager(async (grantId: string) => {
    // TODO: 실제 refresh 로직 구현
    // 현재는 grant를 그대로 반환 (refresh 미구현)
    const grant = await store.getGrant(grantId);
    if (!grant) {
      throw new Error('Grant not found');
    }
    return grant;
  });

  return {
    async getAccessToken(
      request: OAuthTokenRequest,
      turnAuth: TurnAuth
    ): Promise<OAuthTokenResult> {
      // 1. OAuthApp 조회
      const oauthApp = await configLoader.getOAuthApp(request.oauthAppRef);
      if (!oauthApp) {
        return {
          status: 'error',
          error: {
            code: 'oauthAppNotFound',
            message: 'OAuthApp not found',
          },
        };
      }

      // 2. Subject 결정
      const subject = resolveSubject(oauthApp.spec, turnAuth);
      if (!subject) {
        return {
          status: 'error',
          error: {
            code: 'subjectUnavailable',
            message: `turn.auth.subjects.${oauthApp.spec.subjectMode} is required`,
          },
        };
      }

      // 3. 스코프 검증
      const requestedScopes = request.scopes ?? oauthApp.spec.scopes;
      if (!validateScopes(requestedScopes, oauthApp.spec.scopes)) {
        return {
          status: 'error',
          error: {
            code: 'scopeNotAllowed',
            message: 'Requested scopes exceed OAuthApp scopes',
          },
        };
      }

      // 4. Grant 조회
      const oauthAppRef = normalizeObjectRef(request.oauthAppRef);
      const grantId = generateGrantId(oauthAppRef, subject);
      const grant = await store.getGrant(grantId);

      const minTtl = request.minTtlSeconds ?? 300;

      if (grant && !grant.spec.revoked) {
        // 5. 토큰 유효성 확인
        if (isTokenValid(grant, minTtl)) {
          const accessToken = await decrypt(grant.spec.token.accessToken);
          return {
            status: 'ready',
            accessToken,
            tokenType: grant.spec.token.tokenType,
            expiresAt: grant.spec.token.expiresAt,
            scopes: grant.spec.scopesGranted,
          };
        }

        // 6. Refresh 시도
        if (needsRefresh(grant, minTtl)) {
          try {
            const refreshed = await refreshManager.refresh(grantId);
            const accessToken = await decrypt(refreshed.spec.token.accessToken);
            return {
              status: 'ready',
              accessToken,
              tokenType: refreshed.spec.token.tokenType,
              expiresAt: refreshed.spec.token.expiresAt,
              scopes: refreshed.spec.scopesGranted,
            };
          } catch {
            // Refresh 실패 → 새 승인 필요
          }
        }
      }

      // 7. AuthSession 생성
      const session = await createAuthSession(
        oauthApp,
        subject,
        requestedScopes,
        turnAuth
      );

      // 8. authorization_required 반환
      return {
        status: 'authorization_required',
        authSessionId: session.metadata.name,
        authorizationUrl: session.authorizationUrl,
        expiresAt: session.spec.expiresAt,
        message: `${oauthApp.spec.provider} 연결이 필요합니다. 링크에서 승인을 완료해 주세요.`,
      };
    },
  };

  /**
   * AuthSession 생성 및 저장
   */
  async function createAuthSession(
    oauthApp: OAuthAppResource,
    subject: string,
    requestedScopes: string[],
    turnAuth: TurnAuth
  ): Promise<AuthSessionRecord & { authorizationUrl: string }> {
    // Session ID 생성
    const sessionId = `as-${randomBytes(6).toString('hex')}`;

    // PKCE 생성
    const pkce = generatePKCE();

    // State 생성
    const stateValue = generateState(sessionId);

    // 콜백 URL 생성
    const callbackUrl = `${baseCallbackUrl}${oauthApp.spec.redirect.callbackPath}`;

    // OAuthApp spec에서 clientId를 해결 (authorization URL 생성용)
    const resolvedSpec = resolveOAuthAppSpec(oauthApp.spec);

    // Authorization URL 생성
    const authorizationUrl = buildAuthorizationUrl(
      resolvedSpec,
      stateValue,
      pkce,
      callbackUrl,
      requestedScopes
    );

    // 만료 시각 계산
    const now = new Date();
    const expiresAt = new Date(now.getTime() + sessionTtlSeconds * 1000);

    // Session 레코드 생성
    const session: AuthSessionRecord = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'AuthSessionRecord',
      metadata: { name: sessionId },
      spec: {
        provider: oauthApp.spec.provider,
        oauthAppRef: { kind: 'OAuthApp', name: oauthApp.metadata.name },
        subjectMode: oauthApp.spec.subjectMode,
        subject,
        requestedScopes,
        flow: {
          type: 'authorization_code',
          pkce: {
            method: 'S256',
            codeVerifier: await encrypt(pkce.codeVerifier),
            codeChallenge: pkce.codeChallenge,
          },
          state: await encrypt(stateValue),
        },
        status: 'pending',
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        resume: {
          swarmRef: defaultResumeInfo?.swarmRef ?? { kind: 'Swarm', name: 'default' },
          instanceKey: defaultResumeInfo?.instanceKey ?? '',
          agentName: defaultResumeInfo?.agentName ?? '',
          origin: defaultResumeInfo?.origin ?? {},
          auth: turnAuth,
        },
      },
    };

    // 저장
    await store.saveSession(session);

    // authorizationUrl을 포함하여 반환
    return { ...session, authorizationUrl };
  }

  /**
   * OAuthApp spec의 ValueSource를 해결
   */
  function resolveOAuthAppSpec(spec: OAuthAppSpec): OAuthAppSpec {
    return {
      ...spec,
      client: {
        clientId: resolveValueSourceToValue(spec.client.clientId),
        clientSecret: resolveValueSourceToValue(spec.client.clientSecret),
      },
    };
  }

  /**
   * ValueSource를 { value: string } 형태로 변환
   */
  function resolveValueSourceToValue(source: ValueSource): { value: string } {
    const resolved = configLoader.resolveValueSource(source);
    return { value: resolved };
  }
}
