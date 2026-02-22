import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

import {
  buildMalformedToolCallRetryMessage,
  classifyModelStepRetryKind,
  normalizeModelStepParseResult,
  type ToolCallInputIssue,
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

  it('toolCallInputIssues를 결과에 포함한다', () => {
    const issues: ToolCallInputIssue[] = [
      {
        toolCallId: 'tool-2',
        toolName: 'agents__send',
        reason: 'non_object_input',
      },
    ];

    const result = normalizeModelStepParseResult({
      responseMessages: [],
      text: '',
      toolUseBlocks: [],
      toolCallInputIssues: issues,
      finishReason: 'tool-calls',
      rawFinishReason: 'tool_use',
    });

    expect(result.toolCallInputIssues).toEqual(issues);
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

  it('toolCallInputIssues가 있으면 malformed_tool_calls로 분류한다', () => {
    const retryKind = classifyModelStepRetryKind({
      assistantContent: [{ type: 'text', text: 'x' }],
      textBlocks: ['x'],
      toolUseBlocks: [
        {
          id: 'tool-1',
          name: 'agents__send',
          input: {
            target: 'coordinator',
          },
        },
      ],
      toolCallInputIssues: [
        {
          toolCallId: 'tool-1',
          toolName: 'agents__send',
          reason: 'non_object_input',
        },
      ],
      finishReason: 'stop',
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

  it('직전 입력이 tool-result 전용이면 빈 응답을 재시도 분류하지 않는다', () => {
    const retryKind = classifyModelStepRetryKind({
      assistantContent: [],
      textBlocks: [],
      toolUseBlocks: [],
      finishReason: 'stop',
      lastInputMessageWasToolResult: true,
    });

    expect(retryKind).toBeUndefined();
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

describe('buildMalformedToolCallRetryMessage', () => {
  it('agents__send 이슈가 있으면 input 문자열 예시를 포함한다', () => {
    const message = buildMalformedToolCallRetryMessage([
      {
        toolCallId: 'tool-1',
        toolName: 'agents__send',
        reason: 'non_object_input',
        inputPreview: '"hello"',
      },
    ]);

    expect(message).toContain('agents__send/agents__request 예시');
    expect(message).toContain('"input":"작업 결과 문자열"');
  });
});
