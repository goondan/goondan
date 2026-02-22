import { describe, expect, it } from 'vitest';
import { buildObserverPayload, serializeObserverPayload } from './worker-lifecycle.js';

function createMessage(role: string, content: unknown): { data: { role: string; content: unknown } } {
  return {
    data: {
      role,
      content,
    },
  };
}

describe('worker-lifecycle observer payload', () => {
  it('tool-call/tool-result/input/output을 구조화 payload로 생성한다', () => {
    const userMessage = '오늘 작업 내용을 journals에 기록해줘';
    const messages = [
      createMessage('user', userMessage),
      createMessage('assistant', [
        {
          type: 'tool-call',
          toolCallId: 'tc-1',
          toolName: 'file-system__appendFile',
          input: {
            path: 'memory/journals/2026-02-22.md',
            content: '10:20 | 요청 요약 | 수행 내용 | 결과 요약',
          },
        },
      ]),
      createMessage('user', [
        {
          type: 'tool-result',
          toolCallId: 'tc-1',
          toolName: 'file-system__appendFile',
          output: { type: 'text', value: '{"ok":true,"written":1}' },
        },
      ]),
      createMessage('assistant', [{ type: 'text', text: '작업 일지를 memory/journals에 기록했고 완료했습니다.' }]),
    ];

    const payload = buildObserverPayload(
      userMessage,
      {
        responseMessage: createMessage('assistant', [{ type: 'text', text: '작업 일지를 기록했습니다.' }]),
      },
      messages,
      new Date('2026-02-22T10:20:00.000Z'),
    );

    expect(payload).toBeDefined();
    expect(payload?.schema).toBe('goondan.observation.turn.v2');
    expect(payload?.turn.toolCallCount).toBe(1);
    expect(payload?.turn.input).toContain('journals');
    expect(payload?.turn.output).toContain('작업 일지를 기록했습니다');

    const tool = payload?.tools[0];
    expect(tool?.toolName).toBe('file-system__appendFile');
    expect(tool?.status).toBe('ok');
    expect(tool?.inputPreview).toContain('"path":"memory/journals/2026-02-22.md"');
    expect(tool?.outputPreview).toContain('"ok":true');

    expect(payload?.signals.fileOperations).toContain('appendFile:memory/journals/2026-02-22.md');
  });

  it('bash 실패 결과를 error 시그널로 분류한다', () => {
    const userMessage = '테스트 명령 실행해줘';
    const messages = [
      createMessage('user', userMessage),
      createMessage('assistant', [
        {
          type: 'tool-call',
          toolCallId: 'tc-2',
          toolName: 'bash__exec',
          input: {
            command: 'not_existing_command --help',
          },
        },
      ]),
      createMessage('user', [
        {
          type: 'tool-result',
          toolCallId: 'tc-2',
          toolName: 'bash__exec',
          output: { type: 'text', value: 'Error: command not found' },
        },
      ]),
      createMessage('assistant', [{ type: 'text', text: '명령 실행에 실패했습니다.' }]),
    ];

    const payload = buildObserverPayload(
      userMessage,
      {
        responseMessage: createMessage('assistant', [{ type: 'text', text: '실패 내용을 확인했습니다.' }]),
      },
      messages,
      new Date('2026-02-22T10:30:00.000Z'),
    );

    expect(payload).toBeDefined();
    expect(payload?.tools[0]?.status).toBe('error');
    expect(payload?.signals.shellCommands).toContain('not_existing_command --help');
    expect(payload?.signals.toolErrors[0]).toContain('bash__exec(tc-2)');
  });

  it('입력/도구/출력이 모두 없으면 observer payload를 만들지 않는다', () => {
    const payload = buildObserverPayload(
      undefined,
      {},
      [],
      new Date('2026-02-22T10:40:00.000Z'),
    );
    expect(payload).toBeUndefined();
  });

  it('긴 출력은 truncate하고 직렬화 문자열에 JSON 블록을 포함한다', () => {
    const userMessage = '긴 보고서를 작성해줘';
    const longOutput = `결과:${'x'.repeat(2200)}`;
    const messages = [
      createMessage('user', userMessage),
      createMessage('assistant', [{ type: 'text', text: longOutput }]),
    ];

    const payload = buildObserverPayload(
      userMessage,
      {
        responseMessage: createMessage('assistant', [{ type: 'text', text: longOutput }]),
      },
      messages,
      new Date('2026-02-22T10:50:00.000Z'),
    );

    expect(payload).toBeDefined();
    expect(payload?.turn.outputTruncated).toBe(true);
    expect(payload?.turn.output.endsWith('...')).toBe(true);

    const serialized = payload ? serializeObserverPayload(payload) : '';
    expect(serialized).toContain('[observer_payload]');
    expect(serialized).toContain('[/observer_payload]');
    expect(serialized).toContain('[input]');
    expect(serialized).toContain('[tools]');
    expect(serialized).toContain('[output]');
  });
});
