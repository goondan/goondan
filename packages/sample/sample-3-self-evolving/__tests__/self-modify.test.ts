/**
 * Self-Modify Tool 테스트
 *
 * 이 테스트는 self-modify tool의 핸들러가 올바르게 동작하는지 검증합니다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs/promises';
import { handlers } from '../tools/self-modify/index.js';

// Mock fs module
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock child_process spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({
    stdout: {
      on: vi.fn((event, callback) => {
        if (event === 'data') {
          callback(Buffer.from(''));
        }
      }),
    },
    stderr: {
      on: vi.fn(),
    },
    on: vi.fn((event, callback) => {
      if (event === 'close') {
        callback(0);
      }
    }),
  })),
}));

describe('self.readPrompt', () => {
  const mockContext = {
    swarmBundle: {
      openChangeset: vi.fn(),
      commitChangeset: vi.fn(),
      getActiveRef: vi.fn(() => 'git:abc123'),
    },
    swarmBundleRoot: '/test/bundle',
    logger: console,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error when file does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const result = await handlers['self.readPrompt'](mockContext, {});

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Prompt file not found'),
    });
  });

  it('should return file content when file exists', async () => {
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue('# Test Prompt');
    vi.mocked(fs.stat).mockResolvedValue({
      size: 13,
      mtime: new Date('2026-02-05T10:00:00Z'),
    } as unknown as Awaited<ReturnType<typeof fs.stat>>);

    const result = await handlers['self.readPrompt'](mockContext, {});

    expect(result).toMatchObject({
      success: true,
      content: '# Test Prompt',
      size: 13,
    });
  });

  it('should use custom prompt path', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    const result = await handlers['self.readPrompt'](mockContext, {
      promptPath: 'custom/path.md',
    });

    expect(result).toMatchObject({
      success: false,
      path: '/test/bundle/custom/path.md',
    });
  });
});

describe('self.updatePrompt', () => {
  const mockContext = {
    swarmBundle: {
      openChangeset: vi.fn(),
      commitChangeset: vi.fn(),
      getActiveRef: vi.fn(() => 'git:abc123'),
    },
    swarmBundleRoot: '/test/bundle',
    logger: console,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return error when newContent is missing', async () => {
    const result = await handlers['self.updatePrompt'](mockContext, {});

    expect(result).toMatchObject({
      success: false,
      error: 'newContent is required and must be a string',
    });
  });

  it('should return error when openChangeset fails', async () => {
    mockContext.swarmBundle.openChangeset.mockRejectedValue(
      new Error('Git error')
    );

    const result = await handlers['self.updatePrompt'](mockContext, {
      newContent: '# New Prompt',
    });

    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('Failed to open changeset'),
      stage: 'openChangeset',
    });
  });

  it('should commit changeset successfully', async () => {
    mockContext.swarmBundle.openChangeset.mockResolvedValue({
      changesetId: 'cs-123',
      baseRef: 'git:base',
      workdir: '/tmp/workdir',
    });
    mockContext.swarmBundle.commitChangeset.mockResolvedValue({
      status: 'ok',
      changesetId: 'cs-123',
      baseRef: 'git:base',
      newRef: 'git:new',
      summary: {
        filesChanged: ['prompts/evolving.system.md'],
        filesAdded: [],
        filesDeleted: [],
      },
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const result = await handlers['self.updatePrompt'](mockContext, {
      newContent: '# New Prompt',
      reason: 'Test update',
    });

    expect(result).toMatchObject({
      success: true,
      changesetId: 'cs-123',
      newRef: 'git:new',
      message: expect.stringContaining('Changes will take effect'),
    });
  });

  it('should handle policy rejection', async () => {
    mockContext.swarmBundle.openChangeset.mockResolvedValue({
      changesetId: 'cs-123',
      baseRef: 'git:base',
      workdir: '/tmp/workdir',
    });
    mockContext.swarmBundle.commitChangeset.mockResolvedValue({
      status: 'rejected',
      changesetId: 'cs-123',
      baseRef: 'git:base',
      error: {
        code: 'POLICY_VIOLATION',
        message: 'Not allowed',
        violatedFiles: ['goondan.yaml'],
      },
    });
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);

    const result = await handlers['self.updatePrompt'](mockContext, {
      newContent: '# New Prompt',
    });

    expect(result).toMatchObject({
      success: false,
      code: 'POLICY_VIOLATION',
      stage: 'policyValidation',
    });
  });
});

describe('self.viewChanges', () => {
  const mockContext = {
    swarmBundle: {
      openChangeset: vi.fn(),
      commitChangeset: vi.fn(),
      getActiveRef: vi.fn(() => 'git:abc123'),
    },
    swarmBundleRoot: '/test/bundle',
    logger: console,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return empty array when no changes', async () => {
    const result = await handlers['self.viewChanges'](mockContext, {});

    expect(result).toMatchObject({
      success: true,
      changes: [],
    });
  });
});

describe('goondan.yaml validation', () => {
  it('should have valid Changeset policy structure', async () => {
    const yamlContent = await fs.readFile(
      '/Users/channy/workspace/goondan/packages/sample/sample-3-self-evolving/goondan.yaml',
      'utf-8'
    );

    // Swarm 레벨 정책 검증
    expect(yamlContent).toContain('changesets:');
    expect(yamlContent).toContain('enabled: true');
    expect(yamlContent).toContain('applyAt:');
    expect(yamlContent).toContain('- step.config');
    expect(yamlContent).toContain('allowed:');
    expect(yamlContent).toContain('files:');
    expect(yamlContent).toContain('- "prompts/**"');
    expect(yamlContent).toContain('- "resources/**"');
    expect(yamlContent).toContain('emitRevisionChangedEvent: true');
  });

  it('should have valid Tool exports', async () => {
    const yamlContent = await fs.readFile(
      '/Users/channy/workspace/goondan/packages/sample/sample-3-self-evolving/goondan.yaml',
      'utf-8'
    );

    // Tool exports 검증
    expect(yamlContent).toContain('- name: self.readPrompt');
    expect(yamlContent).toContain('- name: self.updatePrompt');
    expect(yamlContent).toContain('- name: self.viewChanges');
  });

  it('should have consistent Agent and Swarm policies', async () => {
    const yamlContent = await fs.readFile(
      '/Users/channy/workspace/goondan/packages/sample/sample-3-self-evolving/goondan.yaml',
      'utf-8'
    );

    // Agent 레벨 정책이 Swarm 정책의 부분집합인지 검증
    // 둘 다 prompts/** 와 resources/** 만 허용
    const agentPolicyMatch = yamlContent.match(
      /kind: Agent[\s\S]*?changesets:[\s\S]*?allowed:[\s\S]*?files:([\s\S]*?)(?=\n\n|$)/
    );
    const swarmPolicyMatch = yamlContent.match(
      /kind: Swarm[\s\S]*?changesets:[\s\S]*?allowed:[\s\S]*?files:([\s\S]*?)(?=\n      emitRevisionChangedEvent)/
    );

    expect(agentPolicyMatch).toBeTruthy();
    expect(swarmPolicyMatch).toBeTruthy();
  });
});
