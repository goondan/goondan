import { describe, it, expect } from 'vitest';
import { ConfigRegistry } from '../src/config/registry.js';
import { validateConfig } from '../src/config/validator.js';

const apiVersion = 'agents.example.io/v1alpha1';

describe('validateConfig', () => {
  it('validates a minimal config set', () => {
    const resources = [
      {
        apiVersion,
        kind: 'Model',
        metadata: { name: 'openai-gpt-5' },
        spec: { provider: 'openai', name: 'gpt-5' },
      },
      {
        apiVersion,
        kind: 'OAuthApp',
        metadata: { name: 'slack-bot' },
        spec: {
          provider: 'slack',
          flow: 'authorizationCode',
          subjectMode: 'global',
          client: {
            clientId: { value: 'client-id' },
            clientSecret: { value: 'client-secret' },
          },
          endpoints: {
            authorizationUrl: 'https://example.com/auth',
            tokenUrl: 'https://example.com/token',
          },
          scopes: ['chat:write'],
          redirect: { callbackPath: '/oauth/callback/slack-bot' },
        },
      },
      {
        apiVersion,
        kind: 'Tool',
        metadata: { name: 'slackToolkit' },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.ts',
          auth: { oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' }, scopes: ['chat:write'] },
          exports: [{ name: 'slack.postMessage' }],
        },
      },
      {
        apiVersion,
        kind: 'Agent',
        metadata: { name: 'planner' },
        spec: {
          modelConfig: { modelRef: { kind: 'Model', name: 'openai-gpt-5' } },
          tools: [{ kind: 'Tool', name: 'slackToolkit' }],
        },
      },
      {
        apiVersion,
        kind: 'Swarm',
        metadata: { name: 'default' },
        spec: {
          entrypoint: { kind: 'Agent', name: 'planner' },
          agents: [{ kind: 'Agent', name: 'planner' }],
        },
      },
    ];

    const registry = new ConfigRegistry(resources);
    const result = validateConfig(resources, { registry });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects tool scopes outside oauth app', () => {
    const resources = [
      {
        apiVersion,
        kind: 'OAuthApp',
        metadata: { name: 'slack-bot' },
        spec: {
          provider: 'slack',
          flow: 'authorizationCode',
          subjectMode: 'global',
          client: {
            clientId: { value: 'client-id' },
            clientSecret: { value: 'client-secret' },
          },
          endpoints: {
            authorizationUrl: 'https://example.com/auth',
            tokenUrl: 'https://example.com/token',
          },
          scopes: ['chat:write'],
          redirect: { callbackPath: '/oauth/callback/slack-bot' },
        },
      },
      {
        apiVersion,
        kind: 'Tool',
        metadata: { name: 'slackToolkit' },
        spec: {
          runtime: 'node',
          entry: './tools/slack/index.ts',
          auth: { oauthAppRef: { kind: 'OAuthApp', name: 'slack-bot' }, scopes: ['admin'] },
          exports: [{ name: 'slack.postMessage' }],
        },
      },
    ];

    const registry = new ConfigRegistry(resources);
    const result = validateConfig(resources, { registry });
    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.path === 'spec.auth.scopes')).toBe(true);
  });
});
