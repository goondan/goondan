/**
 * Model Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.1 Model
 */
import { describe, it, expect } from 'vitest';
import type { ModelSpec, ModelResource } from '../../../src/types/specs/model.js';

describe('ModelSpec 타입', () => {
  it('provider와 name은 필수이다', () => {
    const spec: ModelSpec = {
      provider: 'openai',
      name: 'gpt-5',
    };

    expect(spec.provider).toBe('openai');
    expect(spec.name).toBe('gpt-5');
  });

  it('endpoint는 선택이다', () => {
    const spec: ModelSpec = {
      provider: 'openai',
      name: 'gpt-5',
      endpoint: 'https://api.openai.com/v1',
    };

    expect(spec.endpoint).toBe('https://api.openai.com/v1');
  });

  it('options로 제공자별 옵션을 지정할 수 있다', () => {
    const spec: ModelSpec = {
      provider: 'openai',
      name: 'gpt-5',
      options: {
        organization: 'org-xxxxx',
        apiType: 'azure',
      },
    };

    expect(spec.options).toEqual({
      organization: 'org-xxxxx',
      apiType: 'azure',
    });
  });

  it('ModelResource 타입이 올바르게 구성되어야 한다', () => {
    const resource: ModelResource = {
      apiVersion: 'agents.example.io/v1alpha1',
      kind: 'Model',
      metadata: {
        name: 'openai-gpt-5',
        labels: {
          provider: 'openai',
        },
      },
      spec: {
        provider: 'openai',
        name: 'gpt-5',
        endpoint: 'https://api.openai.com/v1',
        options: {
          organization: 'org-xxxxx',
        },
      },
    };

    expect(resource.kind).toBe('Model');
    expect(resource.spec.provider).toBe('openai');
    expect(resource.spec.name).toBe('gpt-5');
  });
});
