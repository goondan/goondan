/**
 * OAuth 시스템 메인 엔트리포인트
 * @see /docs/specs/oauth.md
 */

// Types
export type {
  OAuthApi,
  OAuthTokenRequest,
  OAuthTokenResult,
  OAuthTokenReady,
  OAuthTokenAuthorizationRequired,
  OAuthTokenError,
  TurnAuth,
  TurnAuthActor,
  TurnAuthSubjects,
  EncryptedValue,
  EncryptionService,
  OAuthGrantRecord,
  OAuthGrantSpec,
  OAuthGrantToken,
  AuthSessionRecord,
  AuthSessionSpec,
  AuthSessionFlow,
  ResumeInfo,
  PKCEChallenge,
  StatePayload,
  CallbackParams,
  TokenResponse,
  OAuthErrorCode,
} from './types.js';

// PKCE
export { generatePKCE, verifyPKCE } from './pkce.js';

// Subject
export { resolveSubject } from './subject.js';

// Store
export type { OAuthStore } from './store.js';
export { createOAuthStore, generateGrantId } from './store.js';

// Token
export {
  isTokenValid,
  needsRefresh,
  createRefreshManager,
  type RefreshManager,
  type RefreshFn,
} from './token.js';

// Authorization
export {
  generateState,
  parseState,
  buildAuthorizationUrl,
  validateScopes,
} from './authorization.js';

// API (OAuthManager)
export type { OAuthManager, ConfigLoader, OAuthManagerDependencies } from './api.js';
export { createOAuthManager } from './api.js';
