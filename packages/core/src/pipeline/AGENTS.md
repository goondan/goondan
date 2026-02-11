# Pipeline 시스템

Goondan Runtime의 실행 라이프사이클에서 Extension이 개입할 수 있는 **표준 확장 지점**입니다.

## 역할

파이프라인을 통해 Extension은 다음을 수행할 수 있습니다:
- 도구 카탈로그 조작 (step.tools)
- 컨텍스트 블록 주입 (step.blocks)
- LLM 입력 메시지 전처리 (step.llmInput)
- LLM 호출 래핑 (step.llmCall)
- 도구 실행 제어 (toolCall.exec)
- 워크스페이스 이벤트 처리 (workspace.*)

## 디렉토리 구조

```
src/pipeline/
├── types.ts      # PipelinePoint, Handler 타입, 타입 가드
├── context.ts    # 파이프라인 컨텍스트 타입 (Turn, Step, ToolCall, Workspace)
├── registry.ts   # 핸들러 등록 관리 (PipelineRegistry)
├── executor.ts   # 파이프라인 실행 엔진 (PipelineExecutor)
├── api.ts        # Extension에 제공되는 PipelineApi
├── index.ts      # 모듈 re-export
└── AGENTS.md     # 이 파일
```

## 핵심 개념

### 1. Mutator (순차 변형)
- 컨텍스트를 순차적으로 변형하는 함수 체인
- 각 Mutator는 이전 Mutator의 출력을 입력으로 받음
- priority가 낮을수록 먼저 실행

```ts
api.pipelines.mutate('step.tools', (ctx) => {
  return { ...ctx, toolCatalog: [...ctx.toolCatalog, newTool] };
});
```

### 2. Middleware (래핑)
- `next()` 기반 onion 구조로 핵심 실행을 래핑
- 먼저 등록된(낮은 priority) Middleware가 바깥 레이어
- next()를 호출하지 않으면 내부 실행 스킵

```ts
api.pipelines.wrap('step.llmCall', async (ctx, next) => {
  console.log('before');
  const result = await next(ctx);
  console.log('after');
  return result;
});
```

## 파이프라인 포인트

| 포인트 | 타입 | 설명 |
|--------|------|------|
| `turn.pre` | Mutator | Turn 시작 직전, 입력 전처리 |
| `turn.post` | Mutator | Turn 종료 직후, 결과 후처리 |
| `step.pre` | Mutator | Step 시작 직전 |
| `step.config` | Mutator | SwarmBundleRef 활성화 및 Effective Config 로드 |
| `step.tools` | Mutator | Tool Catalog 구성 |
| `step.blocks` | Mutator | Context Blocks 구성 |
| `step.llmInput` | Mutator | LLM 입력 메시지 최종 전처리 |
| `step.llmCall` | Middleware | LLM 호출 래핑 |
| `step.llmError` | Mutator | LLM 호출 실패 시 오류 처리 |
| `step.post` | Mutator | Step 종료 직후 |
| `toolCall.pre` | Mutator | 개별 tool call 실행 직전 |
| `toolCall.exec` | Middleware | tool call 실행 래핑 |
| `toolCall.post` | Mutator | 개별 tool call 실행 직후 |
| `workspace.repoAvailable` | Mutator | 레포지토리 확보 시 |
| `workspace.worktreeMounted` | Mutator | worktree 마운트 시 |

## 주요 클래스/함수

### PipelineRegistry
핸들러 등록 및 조회를 관리합니다.
- `mutate(point, handler, options)` - Mutator 등록
- `wrap(point, handler, options)` - Middleware 등록
- `getSortedMutators(point)` - 정렬된 Mutator 목록 반환
- `getSortedMiddlewares(point)` - 정렬된 Middleware 목록 반환

### PipelineExecutor
파이프라인 실행을 담당합니다.
- `runMutators(point, ctx)` - Mutator 체인 실행
- `runMiddleware(point, ctx, core)` - Middleware onion 실행

### createPipelineApi(registry)
Extension에 제공되는 PipelineApi 인터페이스를 생성합니다.

## 주요 타입 변경 사항 (v0.10)

- `Turn.messages` -> `Turn.messageState: { baseMessages, events, nextMessages }` (NextMessages = BaseMessages + SUM(Events))
- `MessageEvent`: discriminated union (`system_message | llm_message | replace | remove | truncate`)
- `TurnContext`: `baseMessages?`, `messageEvents?`, `emitMessageEvent?` 추가
- `ToolCall.input` -> `ToolCall.args`
- `ToolResult.status`: `'ok' | 'error' | 'pending'` (pending 추가)
- `ToolResult.error`: `suggestion?`, `helpUrl?` 추가
- `ToolResult.handle?`: 비동기 결과 핸들 추가
- `LlmMessage`: `id: string` 필수 필드 추가
- `step.llmError`: Middleware -> Mutator로 변경

## 참조 문서

- `/docs/specs/pipeline.md` - 라이프사이클 파이프라인 스펙 (유일한 source of truth)
