/**
 * PKCE 생성/검증 테스트
 * @see /docs/specs/oauth.md - 8.2 PKCE 생성
 */
import { describe, it, expect } from 'vitest';
import { generatePKCE, verifyPKCE } from '../../src/oauth/pkce.js';

describe('PKCE', () => {
  describe('generatePKCE', () => {
    it('codeVerifier, codeChallenge, codeChallengeMethod를 반환한다', () => {
      const pkce = generatePKCE();

      expect(pkce).toHaveProperty('codeVerifier');
      expect(pkce).toHaveProperty('codeChallenge');
      expect(pkce).toHaveProperty('codeChallengeMethod');
    });

    it('codeChallengeMethod는 항상 S256이다', () => {
      const pkce = generatePKCE();
      expect(pkce.codeChallengeMethod).toBe('S256');
    });

    it('codeVerifier는 43자 이상이다', () => {
      const pkce = generatePKCE();
      expect(pkce.codeVerifier.length).toBeGreaterThanOrEqual(43);
    });

    it('codeVerifier는 128자 이하이다', () => {
      const pkce = generatePKCE();
      expect(pkce.codeVerifier.length).toBeLessThanOrEqual(128);
    });

    it('codeVerifier는 URL-safe Base64 문자만 포함한다', () => {
      const pkce = generatePKCE();
      // URL-safe Base64: A-Z, a-z, 0-9, -, _
      expect(pkce.codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('codeChallenge는 SHA256 해시의 Base64URL 인코딩이다', () => {
      const pkce = generatePKCE();
      // Base64URL 형식 검증
      expect(pkce.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
      // SHA256 해시의 Base64URL은 43자
      expect(pkce.codeChallenge.length).toBe(43);
    });

    it('매번 다른 값을 생성한다', () => {
      const pkce1 = generatePKCE();
      const pkce2 = generatePKCE();

      expect(pkce1.codeVerifier).not.toBe(pkce2.codeVerifier);
      expect(pkce1.codeChallenge).not.toBe(pkce2.codeChallenge);
    });
  });

  describe('verifyPKCE', () => {
    it('올바른 codeVerifier와 codeChallenge를 검증한다', () => {
      const pkce = generatePKCE();
      const isValid = verifyPKCE(pkce.codeVerifier, pkce.codeChallenge);
      expect(isValid).toBe(true);
    });

    it('잘못된 codeVerifier는 검증 실패한다', () => {
      const pkce = generatePKCE();
      const isValid = verifyPKCE('wrong-verifier', pkce.codeChallenge);
      expect(isValid).toBe(false);
    });

    it('잘못된 codeChallenge는 검증 실패한다', () => {
      const pkce = generatePKCE();
      const isValid = verifyPKCE(pkce.codeVerifier, 'wrong-challenge');
      expect(isValid).toBe(false);
    });

    it('RFC 7636 테스트 벡터를 검증한다', () => {
      // RFC 7636 Appendix B의 테스트 벡터
      const codeVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
      const expectedChallenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

      const isValid = verifyPKCE(codeVerifier, expectedChallenge);
      expect(isValid).toBe(true);
    });
  });
});
