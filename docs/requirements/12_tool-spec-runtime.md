## 12. Tool 스펙(런타임 관점)

### 12.1 도구 레지스트리와 도구 카탈로그

- **Tool Registry**: 런타임이 실행할 수 있는 전체 도구 집합. Bundle에 선언된 모든 Tool 리소스의 핸들러를 포함한다.
- **Tool Catalog**: 현재 Step에서 LLM에 노출되는 도구 목록. Step 미들웨어의 `toolCatalog` 필드로 조작할 수 있다.

규칙:

1. AgentProcess는 Step마다 Tool Catalog를 구성해야 한다(MUST).
2. Tool Catalog는 Agent 리소스의 `spec.tools` 선언을 기반으로 초기화해야 한다(MUST).
3. Step 미들웨어는 `ctx.toolCatalog`를 조작하여 LLM에 노출되는 도구를 변경할 수 있다(MAY).
4. Extension이 `api.tools.register()`로 동적 등록한 도구도 Tool Registry에 포함되어야 한다(MUST).

### 12.2 도구 이름 규칙

LLM에 노출되는 도구 이름은 **`{Tool 리소스 이름}__{하위 도구 이름}`** 형식(더블 언더스코어)을 사용해야 한다(MUST).

```
Tool 리소스: bash          → exports: exec, script
LLM 도구 이름:  bash__exec,  bash__script

Tool 리소스: file-system   → exports: read, write
LLM 도구 이름:  file-system__read,  file-system__write
```

규칙:

1. 더블 언더스코어(`__`)를 리소스 이름과 하위 도구 이름의 구분자로 사용해야 한다(MUST).
2. AI SDK에서 허용되는 문자이므로 별도 인코딩/디코딩 없이 그대로 사용해야 한다(MUST).
3. Tool 리소스 이름과 하위 도구 이름 각각에는 `__`를 포함해서는 안 된다(MUST NOT).
4. 단일 export만 가진 Tool 리소스도 `{리소스명}__{export명}` 형식을 따라야 한다(MUST).

### 12.3 tool call의 허용 범위

규칙:

1. 기본 허용 범위는 Tool Catalog여야 한다(MUST).
2. Catalog에 없는 도구 호출은 명시적 정책이 없는 한 거부해야 한다(MUST).
3. Registry 직접 호출 허용 모드는 명시적 보안 정책으로만 활성화할 수 있다(MAY).
4. 거부 결과는 구조화된 ToolResult(`status="error"`, `code`)로 반환해야 한다(MUST).

### 12.4 동기/비동기 결과

- 동기 완료: `output` 포함
- 비동기 제출: `handle` 포함(완료 이벤트 또는 polling)

#### 12.4.1 Tool 오류 결과 및 메시지 제한

AgentProcess는 Tool 실행 오류를 예외 전파 대신 ToolResult로 LLM에 전달해야 한다(MUST).

```json
{
  "status": "error",
  "error": {
    "code": "E_TOOL",
    "name": "Error",
    "message": "요청 실패",
    "suggestion": "입력 파라미터를 확인하세요.",
    "helpUrl": "https://docs.goondan.ai/errors/E_TOOL"
  }
}
```

규칙:

1. `error.message` 길이는 `Tool.spec.errorMessageLimit`를 적용해야 한다(MUST).
2. 미설정 시 기본값은 1000자여야 한다(MUST).
3. 사용자 복구를 돕는 `suggestion` 필드를 제공하는 것을 권장한다(SHOULD).
4. 문서 링크(`helpUrl`) 제공을 권장한다(SHOULD).

### 12.5 ToolContext

Tool 핸들러에 전달되는 ToolContext는 다음 필드를 포함해야 한다(MUST).

```typescript
interface ToolContext {
  /** 현재 에이전트 이름 */
  readonly agentName: string;

  /** 현재 인스턴스 키 */
  readonly instanceKey: string;

  /** 현재 Turn ID */
  readonly turnId: string;

  /** 이 도구 호출의 고유 ID */
  readonly toolCallId: string;

  /** 이 도구 호출을 트리거한 Message */
  readonly message: Message;

  /** 인스턴스 작업 디렉토리 경로 */
  readonly workdir: string;

  /** 로거 */
  readonly logger: Console;
}
```

규칙:

1. `workdir`은 해당 인스턴스의 워크스페이스 경로를 가리켜야 한다(MUST).
2. bash, file-system 등 파일 시스템 접근 도구는 `ctx.workdir`을 기본 작업 디렉토리로 사용해야 한다(MUST).
3. ToolContext에는 `swarmBundle`, `oauth` 등 v1의 제거된 인터페이스를 포함해서는 안 된다(MUST NOT).
4. `message` 필드는 이 도구 호출을 포함하는 assistant Message를 참조해야 한다(MUST).

### 12.6 Handoff 도구 패턴

Agent 간 handoff는 tool call 패턴으로 제공하며, Orchestrator를 경유하는 IPC로 구현한다.

#### 12.6.1 Handoff 흐름

1. Agent A가 handoff 도구를 호출한다.
2. AgentProcess A가 Orchestrator에 `{ type: 'delegate', to: 'AgentB', payload: {...} }` IPC 메시지를 전송한다.
3. Orchestrator가 Agent B 프로세스로 라우팅한다(필요시 스폰).
4. Agent B가 처리 후 Orchestrator에 `{ type: 'delegate_result', to: 'AgentA', ... }` 결과를 전달한다.
5. Orchestrator가 Agent A에 결과를 전달한다.

규칙:

1. handoff 요청은 대상 agent 이름과 입력 payload를 포함해야 한다(MUST).
2. handoff는 비동기 제출 모델을 지원해야 한다(SHOULD).
3. 원래 Agent의 Turn/Trace 컨텍스트는 `correlationId`를 통해 추적 가능해야 한다(MUST).
4. handoff 실패는 구조화된 ToolResult(`status="error"`)로 반환해야 한다(MUST).
5. 기본 handoff 구현체는 `packages/base`에 제공하는 것을 권장한다(SHOULD).
6. Orchestrator는 delegate 대상 AgentProcess가 존재하지 않으면 자동 스폰해야 한다(MUST).

#### 12.6.2 IPC 메시지 형식

```typescript
interface IpcMessage {
  type: 'delegate' | 'delegate_result' | 'event' | 'shutdown';
  from: string;          // agentName
  to: string;            // agentName
  payload: JsonValue;
  correlationId?: string;
}
```
