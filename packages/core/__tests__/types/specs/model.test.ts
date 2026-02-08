/**
 * Model Spec 타입 테스트
 * @see /docs/specs/resources.md - 6.1 Model
 */
import { describe, it, expect } from 'vitest';
import type { ModelSpec, ModelCapabilities, ModelResource } from '../../../src/types/specs/model.js';

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

  it('capabilities로 모델 기능을 선언할 수 있다', () => {
    const capabilities: ModelCapabilities = {
      streaming: true,
      toolCalling: true,
    };

    const spec: ModelSpec = {
      provider: 'anthropic',
      name: 'claude-sonnet-4-5',
      capabilities,
    };

    expect(spec.capabilities?.streaming).toBe(true);
    expect(spec.capabilities?.toolCalling).toBe(true);
  });

  it('capabilities는 확장 가능한 기능 플래그를 지원해야 한다', () => {
    const capabilities: ModelCapabilities = {
      streaming: true,
      toolCalling: true,
      vision: true,
    };

    expect(capabilities.vision).toBe(true);
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
