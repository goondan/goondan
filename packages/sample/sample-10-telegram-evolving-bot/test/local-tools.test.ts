import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ToolContext } from '@goondan/types';
import { evolve } from '../src/local-tools.js';

const tempDirs: string[] = [];

async function createTempProjectRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-sample10-tools-'));
  tempDirs.push(root);

  await fs.mkdir(path.join(root, 'prompts'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'goondan.yaml'),
    [
      'apiVersion: goondan.ai/v1',
      'kind: Agent',
      'metadata:',
      '  name: a',
      'spec:',
      '  modelConfig:',
      '    modelRef: "Model/m"',
      '---',
      'apiVersion: goondan.ai/v1',
      'kind: Swarm',
      'metadata:',
      '  name: default',
      'spec:',
      '  entryAgent: "Agent/a"',
      '  agents:',
      '    - ref: "Agent/a"',
    ].join('\n'),
    'utf8',
  );

  return root;
}

function createToolContext(workdir: string): ToolContext {
  return {
    agentName: 'telegram-evolver',
    instanceKey: 'telegram:1',
    turnId: 'turn-1',
    traceId: 'trace-1',
    toolCallId: 'tool-1',
    message: {
      id: 'message-1',
      data: {
        role: 'user',
        content: 'update',
      },
      metadata: {},
      createdAt: new Date(),
      source: {
        type: 'user',
      },
    },
    workdir,
    logger: console,
  };
}

afterEach(async () => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

describe('local-tools evolve', () => {
  it('evolve 적용 성공 시 restart 신호를 반환한다', async () => {
    const root = await createTempProjectRoot();

    const output = await evolve(createToolContext(root), {
      summary: 'prompt update',
      updates: [
        {
          path: 'prompts/system.md',
          content: '# updated',
        },
      ],
    });

    if (typeof output !== 'object' || output === null || Array.isArray(output)) {
      throw new Error('evolve 출력 형식이 객체가 아닙니다.');
    }

    expect(output['ok']).toBe(true);
    expect(output['restartRequested']).toBe(true);
    expect(output['restartReason']).toBe('tool:evolve');

    const changed = await fs.readFile(path.join(root, 'prompts', 'system.md'), 'utf8');
    expect(changed).toBe('# updated');
  });
});
