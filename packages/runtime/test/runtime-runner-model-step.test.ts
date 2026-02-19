import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

import {
  classifyModelStepRetryKind,
  normalizeModelStepParseResult,
  type ToolUseBlock,
} from '../src/runner/runtime-runner.js';

describe('normalizeModelStepParseResult', () => {
  it('assistant 메시지가 없고 tool call만 있을 때 synthetic tool-call content를 생성한다', () => {
    const responseMessages: ModelMessage[] = [
      {
        role: 'user',
        content: '사용자 메시지',
      },
    ];
    const toolUseBlocks: ToolUseBlock[] = [
      {
        id: 'tool-1',
        name: 'bash__exec',
        input: {
          command: 'pwd',
        },
      },
    ];

    const result = normalizeModelStepParseResult({
      responseMessages,
      text: '',
      toolUseBlocks,
      finishReason: 'tool-calls',
      rawFinishReason: 'tool_use',
    });

    expect(result.assistantContent).toEqual([
      {
        type: 'tool-call',
        toolCallId: 'tool-1',
        toolName: 'bash__exec',
        input: {
          command: 'pwd',
        },
      },
    ]);
    expect(result.textBlocks).toEqual([]);
    expect(result.finishReason).toBe('tool-calls');
    expect(result.rawFinishReason).toBe('tool_use');
  });

  it('rawFinishReason 공백값은 undefined로 정규화한다', () => {
    const result = normalizeModelStepParseResult({
      responseMessages: [],
      text: 'ok',
      toolUseBlocks: [],
      finishReason: 'stop',
      rawFinishReason: '   ',
    });

    expect(result.textBlocks).toEqual(['ok']);
    expect(result.rawFinishReason).toBeUndefined();
  });
});

describe('classifyModelStepRetryKind', () => {
  it('tool-calls 종료인데 tool call 블록이 없으면 malformed_tool_calls로 분류한다', () => {
    const retryKind = classifyModelStepRetryKind({
      assistantContent: [],
      textBlocks: [],
      toolUseBlocks: [],
      finishReason: 'tool-calls',
    });

    expect(retryKind).toBe('malformed_tool_calls');
  });

  it('텍스트/툴/assistant content가 모두 없으면 empty_output으로 분류한다', () => {
    const retryKind = classifyModelStepRetryKind({
      assistantContent: [],
      textBlocks: [],
      toolUseBlocks: [],
      finishReason: 'stop',
    });

    expect(retryKind).toBe('empty_output');
  });

  it('유효한 텍스트가 있으면 재시도 분류를 하지 않는다', () => {
    const retryKind = classifyModelStepRetryKind({
      assistantContent: [{ type: 'text', text: '완료' }],
      textBlocks: ['완료'],
      toolUseBlocks: [],
      finishReason: 'stop',
    });

    expect(retryKind).toBeUndefined();
  });
});
