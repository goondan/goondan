import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@goondan/core';
import { describe, expect, it } from 'vitest';
import { FileConversationStore } from '../src/chat/session.js';

function message(id: string, text: string): Message {
  return { id, role: 'user', source: 'host', content: [{ type: 'text', text }] };
}

async function sessionRoot(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'gdn-session-'));
}

function sessionPath(root: string, sessionId: string): string {
  return join(root, 'sessions', `${encodeURIComponent(sessionId)}.json`);
}

async function readSession(root: string, sessionId: string): Promise<unknown> {
  return JSON.parse(await readFile(sessionPath(root, sessionId), 'utf8'));
}

describe('FileConversationStore', () => {
  it('대화 식별자와 에이전트 경로별로 기록을 나눈다', async () => {
    const root = await sessionRoot();
    const store = new FileConversationStore(root, 'keys');
    await store.append('keys', 'main', [message('a', 'outer')]);
    await store.append('keys', 'wrap/main', [message('b', 'nested')]);
    await store.append('keys:turn-1:helper', 'main', [message('c', 'sub')]);

    expect(await store.load('keys', 'main')).toEqual([message('a', 'outer')]);
    expect(await store.load('keys', 'wrap/main')).toEqual([message('b', 'nested')]);
    expect(await store.load('keys:turn-1:helper', 'main')).toEqual([message('c', 'sub')]);
    expect(await store.load('keys', 'missing')).toEqual([]);
    expect(await readSession(root, 'keys')).toEqual({
      version: 2,
      conversations: {
        keys: { main: [message('a', 'outer')], 'wrap/main': [message('b', 'nested')] },
        'keys:turn-1:helper': { main: [message('c', 'sub')] },
      },
    });
  });

  it('replace는 해당 대화의 에이전트 기록만 교체한다', async () => {
    const root = await sessionRoot();
    const store = new FileConversationStore(root, 'replace');
    await store.append('replace', 'main', [message('a', 'first')]);
    await store.append('other', 'main', [message('b', 'other')]);
    await store.replace('replace', 'main', [message('c', 'only')]);
    expect(await store.load('replace', 'main')).toEqual([message('c', 'only')]);
    expect(await store.load('other', 'main')).toEqual([message('b', 'other')]);
  });

  it('버전 1 파일을 세션 대화로 읽고 다음 쓰기에서 버전 2로 올린다', async () => {
    const root = await sessionRoot();
    await mkdir(join(root, 'sessions'), { recursive: true });
    await writeFile(
      sessionPath(root, 'old'),
      `${JSON.stringify({ version: 1, agents: { main: [message('a', 'legacy')] } }, null, 2)}\n`,
      'utf8',
    );
    const store = new FileConversationStore(root, 'old');
    expect(await store.load('old', 'main')).toEqual([message('a', 'legacy')]);
    expect(await store.load('old:turn-1:helper', 'main')).toEqual([]);

    await store.append('old', 'main', [message('b', 'new')]);
    expect(await readSession(root, 'old')).toEqual({
      version: 2,
      conversations: { old: { main: [message('a', 'legacy'), message('b', 'new')] } },
    });
  });

  it('형식이 맞지 않는 세션 파일을 거부한다', async () => {
    const root = await sessionRoot();
    await mkdir(join(root, 'sessions'), { recursive: true });
    await writeFile(sessionPath(root, 'broken'), JSON.stringify({ version: 3, conversations: {} }), 'utf8');
    const store = new FileConversationStore(root, 'broken');
    await expect(store.load('broken', 'main')).rejects.toThrow('Invalid chat session');
  });
});
