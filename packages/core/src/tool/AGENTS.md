# Tool 시스템

Tool은 LLM이 tool call로 호출할 수 있는 1급 실행 단위입니다.

## 스펙 문서

- `/docs/specs/tool.md`

## 파일 구조

```
tool/
├── types.ts      # Tool 관련 타입 정의
├── registry.ts   # ToolRegistry - 동적 Tool 등록/관리
├── catalog.ts    # ToolCatalog - LLM에 노출되는 Tool 목록
├── executor.ts   # ToolExecutor - Tool 실행 엔진
├── loader.ts     # ToolLoader - Tool 모듈 로더
├── context.ts    # ToolContextBuilder - 실행 컨텍스트 빌더
├── utils.ts      # 유틸리티 함수 (truncate, result 생성)
└── index.ts      # 모든 기능 re-export
```

## 핵심 개념

### Tool Registry vs Tool Catalog

| 개념 | 설명 |
|------|------|
| **Tool Registry** | Runtime이 보유한 **실행 가능한 전체 도구 엔드포인트(핸들러 포함) 집합** |
| **Tool Catalog** | **특정 Step에서 LLM에 노출되는 도구 목록** |

### 주요 클래스

- `ToolRegistry`: 동적 Tool 등록/조회/삭제
- `ToolCatalog`: LLM에 노출되는 Tool 목록 관리
- `ToolExecutor`: Tool 호출 실행, 오류 처리
- `ToolLoader`: Tool 리소스의 entry 파일에서 handlers 로드
- `ToolContextBuilder`: ToolContext 안전 생성

## 타입

### ToolHandler

```typescript
type ToolHandler = (ctx: ToolContext, input: JsonObject) => Promise<JsonValue> | JsonValue;
```

### ToolResult

```typescript
interface ToolResult {
  toolCallId: string;
  toolName: string;
  status: 'ok' | 'error' | 'pending';
  output?: JsonValue;
  handle?: string;
  error?: ToolError;
}
```

## 규칙

1. **예외 전파 금지**: Tool 실행 중 오류는 `ToolResult.error`로 변환
2. **errorMessageLimit**: 오류 메시지는 `Tool.spec.errorMessageLimit` 길이로 제한 (기본: 1000)
3. **타입 단언 금지**: `as` 사용하지 않고 타입 가드로 처리

## 사용 예시

```typescript
import { ToolRegistry, ToolExecutor, ToolCatalog } from '@goondan/core/tool';

// Registry에 Tool 등록
const registry = new ToolRegistry();
registry.register({
  name: 'calc.add',
  handler: async (ctx, input) => {
    return { result: input.a + input.b };
  },
});

// Executor로 실행
const executor = new ToolExecutor(registry);
const result = await executor.execute(toolCall, context);
```
