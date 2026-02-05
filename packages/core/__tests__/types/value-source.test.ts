/**
 * ValueSource / SecretRef 타입 테스트
 * @see /docs/specs/resources.md - 5. ValueSource / SecretRef 타입
 */
import { describe, it, expect } from 'vitest';
import type { ValueSource, ValueFrom, SecretRef } from '../../src/types/value-source.js';
import { resolveValueSource } from '../../src/types/utils.js';

describe('ValueSource 타입', () => {
  describe('ValueSource 인터페이스', () => {
    it('직접 값을 지정할 수 있다', () => {
      const source: ValueSource = { value: 'my-client-id' };
      expect(source.value).toBe('my-client-id');
    });

    it('valueFrom으로 외부 소스를 지정할 수 있다', () => {
      const source: ValueSource = {
        valueFrom: { env: 'MY_ENV_VAR' },
      };
      expect(source.valueFrom?.env).toBe('MY_ENV_VAR');
    });

    it('valueFrom.secretRef로 비밀 저장소를 참조할 수 있다', () => {
      const source: ValueSource = {
        valueFrom: {
          secretRef: {
            ref: 'Secret/my-secret',
            key: 'api_key',
          },
        },
      };
      expect(source.valueFrom?.secretRef?.ref).toBe('Secret/my-secret');
      expect(source.valueFrom?.secretRef?.key).toBe('api_key');
    });
  });

  describe('SecretRef 인터페이스', () => {
    it('ref와 key 필드가 필수이다', () => {
      const secretRef: SecretRef = {
        ref: 'Secret/slack-oauth',
        key: 'client_secret',
      };
      expect(secretRef.ref).toBe('Secret/slack-oauth');
      expect(secretRef.key).toBe('client_secret');
    });
  });

  describe('resolveValueSource', () => {
    const ctx = {
      env: {
        SLACK_CLIENT_ID: 'xoxb-123',
        EMPTY_VAR: '',
      },
      secrets: {
        'slack-oauth': {
          client_secret: 'secret-value',
          other_key: 'other-value',
        },
        'github-oauth': {
          token: 'gh-token',
        },
      },
    };

    describe('직접 값 해석', () => {
      it('value가 있으면 그 값을 반환해야 한다', () => {
        const source: ValueSource = { value: 'direct-value' };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('direct-value');
      });

      it('빈 문자열도 유효한 값이다', () => {
        const source: ValueSource = { value: '' };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('');
      });
    });

    describe('환경 변수 해석', () => {
      it('환경 변수에서 값을 읽어야 한다', () => {
        const source: ValueSource = {
          valueFrom: { env: 'SLACK_CLIENT_ID' },
        };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('xoxb-123');
      });

      it('빈 환경 변수도 유효하다', () => {
        const source: ValueSource = {
          valueFrom: { env: 'EMPTY_VAR' },
        };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('');
      });

      it('존재하지 않는 환경 변수에 대해 오류를 던져야 한다', () => {
        const source: ValueSource = {
          valueFrom: { env: 'NON_EXISTENT_VAR' },
        };
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Environment variable not found: NON_EXISTENT_VAR'
        );
      });
    });

    describe('SecretRef 해석', () => {
      it('Secret에서 값을 읽어야 한다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'Secret/slack-oauth',
              key: 'client_secret',
            },
          },
        };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('secret-value');
      });

      it('다른 Secret과 키에서도 값을 읽을 수 있다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'Secret/github-oauth',
              key: 'token',
            },
          },
        };
        const result = resolveValueSource(source, ctx);
        expect(result).toBe('gh-token');
      });

      it('잘못된 secretRef 형식에 대해 오류를 던져야 한다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'invalid-ref',
              key: 'client_secret',
            },
          },
        };
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Invalid secretRef format: invalid-ref'
        );
      });

      it('Secret/만 있고 이름이 없으면 오류를 던져야 한다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'Secret/',
              key: 'client_secret',
            },
          },
        };
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Invalid secretRef format: Secret/'
        );
      });

      it('존재하지 않는 Secret에 대해 오류를 던져야 한다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'Secret/non-existent',
              key: 'client_secret',
            },
          },
        };
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Secret not found: non-existent'
        );
      });

      it('존재하지 않는 Secret 키에 대해 오류를 던져야 한다', () => {
        const source: ValueSource = {
          valueFrom: {
            secretRef: {
              ref: 'Secret/slack-oauth',
              key: 'non_existent_key',
            },
          },
        };
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Secret key not found: non_existent_key in slack-oauth'
        );
      });
    });

    describe('오류 케이스', () => {
      it('value도 valueFrom도 없으면 오류를 던져야 한다', () => {
        // 런타임에서 잘못된 객체가 전달될 수 있는 케이스 테스트
        const source = {} as ValueSource;
        expect(() => resolveValueSource(source, ctx)).toThrow(
          'Invalid ValueSource: neither value nor valueFrom provided'
        );
      });
    });
  });
});
