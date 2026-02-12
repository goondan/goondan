# Goondan(군단) 개발자 가이드 (v2)

> Kubernetes for Agent Swarm

이 문서는 Goondan을 처음 접하는 개발자가 v2 스펙 기준으로 바로 실행하고 확장할 수 있도록 정리한 실전 가이드다.
규범적 정의(필드의 MUST/SHOULD, 타입 원형, 예외 케이스)는 `docs/specs/*.md`가 단일 기준(SSOT)이다.

---

## 0. 빠른 네비게이션

- 입문/실행: 이 문서 (`GUIDE.md`)
- 아키텍처 개념: `docs/architecture.md`
- 리소스 스키마 SSOT: `docs/specs/resources.md`
- 런타임/프로세스 모델 SSOT: `docs/specs/runtime.md`
- CLI 명령어 SSOT: `docs/specs/cli.md`
- 구성 계층 역할 개요(`runtime`, `types`, `base`, `cli`, `registry`): `docs/specs/layers.md`
- 공통 타입 SSOT: `docs/specs/shared-types.md`

---

## 1. Goondan v2 한눈에

v2는 “설정은 파일에서, 실행은 Orchestrator가”라는 원칙으로 단순화되었다.

### 핵심 변화

- Runtime: Process-per-Agent
- 상주 프로세스: `gdn run`이 Orchestrator를 띄우고 Agent/Connector를 개별 Bun 프로세스로 관리
- 재구성 방식: **Edit & Restart** 채택
- 파이프라인: Middleware(`turn`/`step`/`toolCall`) 3종 사용
- 메시지 상태: 이벤트 소싱 유지
  - `NextMessages = BaseMessages + SUM(Events)`
- 구성 모델: `apiVersion: goondan.ai/v1`, 지원 Kind 8종
  - `Model`, `Agent`, `Swarm`, `Tool`, `Extension`, `Connector`, `Connection`, `Package`

---

## 2. Quick Start

### 2.1 설치

```bash
# 권장
bun add -g @goondan/cli

# 대안
npm install -g @goondan/cli
pnpm add -g @goondan/cli
```

### 2.2 프로젝트 초기화

```bash
gdn init my-first-swarm
cd my-first-swarm
```

### 2.3 환경 변수

`.env` 파일 예시:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# 또는
OPENAI_API_KEY=sk-...
```

`gdn run`의 env 로딩 우선순위:

1. `--env-file`로 지정한 파일
2. `.env.local`
3. `.env`

이미 시스템에 설정된 환경 변수는 그대로 유지한다.

### 2.4 실행

```bash
gdn run
```

자주 쓰는 옵션:

```bash
# 파일 변경 감시 + 영향받는 프로세스 재시작
gdn run --watch

# 단일 입력 실행
gdn run --input "Hello"

# 특정 Swarm 지정
gdn run --swarm default
```

### 2.5 검증/재시작/진단

```bash
# 구성 검증
gdn validate

# 실행 중 Orchestrator에 재시작 신호
gdn restart

# 특정 에이전트만 재시작
gdn restart --agent assistant

# 히스토리 초기화 후 재시작
gdn restart --fresh

# 환경 진단
gdn doctor
```

---

## 3. `goondan.yaml` 기본 구조

모든 리소스는 동일한 골격을 가진다.

```yaml
apiVersion: goondan.ai/v1
kind: <Kind>
metadata:
  name: <name>
spec:
  ...
```

`apiVersion` 생략은 허용되지 않으며, 모든 리소스에서 `goondan.ai/v1`를 명시해야 한다.

### 3.1 최소 구성 예시 (Package + CLI Connection)

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-first-swarm
spec:
  version: "0.1.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: "Model/default-model"
  prompts:
    systemRef: "./prompts/default.system.md"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/assistant"
  agents:
    - ref: "Agent/assistant"
---
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli-to-default
spec:
  connectorRef:
    kind: Connector
    name: cli
    package: "@goondan/base"
  swarmRef: "Swarm/default"
  ingress:
    rules:
      - route: {}
```

### 3.2 ObjectRef 규칙

- 문자열 축약: `"Kind/name"`
- 객체형: `{ kind, name, package?, apiVersion? }`

예시:

```yaml
modelRef: "Model/default-model"

connectorRef:
  kind: Connector
  name: cli
  package: "@goondan/base"
```

### 3.3 Selector + Overrides

라벨 기반 선택 + 필드 덮어쓰기:

```yaml
tools:
  - selector:
      kind: Tool
      matchLabels:
        tier: base
    overrides:
      spec:
        errorMessageLimit: 2000
```

### 3.4 ValueSource

민감값은 `valueFrom` 사용이 기본 패턴이다.

```yaml
apiKey:
  valueFrom:
    env: ANTHROPIC_API_KEY
```

`value`와 `valueFrom` 동시 사용은 불가.

---

## 4. Runtime 실행 모델

Goondan v2 Runtime은 다음 구조를 따른다.

```text
Orchestrator (상주 프로세스, gdn run)
  ├── AgentProcess (에이전트별/인스턴스별)
  └── ConnectorProcess (커넥터별)
```

### 4.1 ProcessStatus 7종

- `spawning`
- `idle`
- `processing`
- `draining`
- `terminated`
- `crashed`
- `crashLoopBackOff`

### 4.2 IPC 메시지 3종

- `event`
- `shutdown`
- `shutdown_ack`

### 4.3 Graceful Shutdown

재시작/설정 변경 시 Orchestrator는:

1. AgentProcess에 `shutdown` 전송
2. 진행 중 Turn 종료 대기 (`draining`)
3. `events -> base` 폴딩 완료 후 `shutdown_ack` 수신
4. 재스폰

유예시간 초과 시 강제 종료(SIGKILL)한다.

---

## 5. Turn/Step과 메시지 상태 모델

### 5.1 실행 단위

- Turn: 입력 이벤트 1건 처리 단위
- Step: LLM 호출 1회 단위

LLM 응답에 tool call이 있으면 다음 Step으로 진행한다.

### 5.2 이벤트 소싱 규칙

```text
NextMessages = BaseMessages + SUM(Events)
```

- `base.jsonl`: 확정 메시지
- `events.jsonl`: Turn 중 누적 이벤트(`append`/`replace`/`remove`/`truncate`)

Turn 종료 시 최종 메시지를 base로 반영하고 events를 비운다.

문서 소유권:
- 실행 규칙(이벤트 적용/폴딩/복원): `docs/specs/runtime.md`
- 저장 레이아웃(base/events 파일 구조): `docs/specs/workspace.md`

---

## 6. Tool 작성

### 6.1 Tool 리소스

```yaml
apiVersion: goondan.ai/v1
kind: Tool
metadata:
  name: bash
spec:
  entry: "./tools/bash/index.ts"
  errorMessageLimit: 1200
  exports:
    - name: exec
      description: "셸 명령 실행"
      parameters:
        type: object
        properties:
          command: { type: string }
        required: [command]
```

### 6.2 핸들러 모듈

`entry` 모듈은 `handlers: Record<string, ToolHandler>`를 export해야 한다.
Tool 호출은 AgentProcess(Bun) 내부에서 `entry` 모듈 로드 후 같은 프로세스의 JS 함수 호출로 실행된다.

```typescript
import type { ToolHandler } from '@goondan/types';

export const handlers: Record<string, ToolHandler> = {
  exec: async (ctx, input) => {
    const proc = Bun.spawn(['sh', '-c', String(input.command)], {
      cwd: ctx.workdir,
    });
    const stdout = await new Response(proc.stdout).text();
    return { stdout, exitCode: await proc.exited };
  },
};
```

### 6.3 도구 이름 규칙

LLM에 노출되는 이름은 반드시 다음 형식:

```text
{Tool metadata.name}__{export name}
```

예: `bash__exec`, `file-system__read`

---

## 7. Extension 작성

### 7.1 Extension 리소스

```yaml
apiVersion: goondan.ai/v1
kind: Extension
metadata:
  name: logging
spec:
  entry: "./extensions/logging/index.ts"
  config:
    level: info
```

### 7.2 엔트리포인트

`register(api)`를 export해야 한다.

```typescript
import type { ExtensionApi } from '@goondan/runtime';

export function register(api: ExtensionApi): void {
  api.pipeline.register('step', async (ctx) => {
    const started = Date.now();
    const result = await ctx.next();
    api.logger.info(`step=${ctx.stepIndex} latencyMs=${Date.now() - started}`);
    return result;
  });
}
```

### 7.3 ExtensionApi 핵심 5개

- `pipeline`
- `tools`
- `state`
- `events`
- `logger`

상태는 인스턴스별로 `extensions/<ext-name>.json`에 저장된다.

---

## 8. Connector/Connection 작성

### 8.1 Connector 리소스

```yaml
apiVersion: goondan.ai/v1
kind: Connector
metadata:
  name: webhook
spec:
  entry: "./connectors/webhook/index.ts"
  events:
    - name: user_message
      properties:
        channel: { type: string }
```

### 8.2 Connector 엔트리

Connector는 프로토콜 수신을 직접 구현한다.

```typescript
import type { ConnectorContext } from '@goondan/runtime';

export default async function (ctx: ConnectorContext): Promise<void> {
  Bun.serve({
    port: Number(ctx.secrets.PORT ?? '3000'),
    async fetch(req) {
      const body = await req.json();
      await ctx.emit({
        name: 'user_message',
        message: { type: 'text', text: String(body.text ?? '') },
        properties: { channel: String(body.channel ?? 'unknown') },
        instanceKey: `web:${String(body.userId ?? 'anonymous')}`,
      });
      return new Response('ok');
    },
  });
}
```

### 8.3 Connection 리소스

```yaml
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: webhook-to-default
spec:
  connectorRef: "Connector/webhook"
  swarmRef: "Swarm/default"
  secrets:
    PORT:
      valueFrom:
        env: WEBHOOK_PORT
  ingress:
    rules:
      - match:
          event: user_message
        route:
          agentRef: "Agent/assistant"
```

핵심 포인트:

- `connectorRef`는 필수
- `route.agentRef` 생략 시 `entryAgent`로 라우팅
- `secrets`는 Connector에 주입

---

## 9. Package 워크플로우

### 9.1 명령어

```bash
gdn package add @goondan/base
gdn package install
gdn package publish
```

### 9.2 동작 요약

- `add`: 의존성 추가 + 설치 트리거
- `install`: 의존성 해석, 다운로드, integrity 검증, lockfile 갱신
- `publish`: 스키마/구성 검증 후 tarball + 해시 생성, 레지스트리 업로드

### 9.3 파일/경로

- 매니페스트: `goondan.yaml` 첫 문서의 `kind: Package`
- lockfile: `goondan.lock.yaml`
- 설치 경로: `~/.goondan/packages/<scope>/<name>/<version>/`
- 배포 tarball 내부 manifest: `goondan.yaml` 또는 `dist/goondan.yaml`

`package.json`의 `files`를 `["dist"]`로 운영하는 패키지는, 빌드 단계에서 `dist/goondan.yaml`을 생성해야 한다.

`gdn package` 명령 매트릭스는 `docs/specs/help.md`를 단일 기준으로 따른다.

---

## 10. Workspace와 저장소 구조

v2는 2-root 구조를 사용한다.

- Project Root: 코드/설정 (`goondan.yaml`, tools, extensions, connectors)
- System Root: 런타임 상태 (`~/.goondan/`)

### 10.1 System Root 예시

```text
~/.goondan/
├── config.json
├── packages/
└── workspaces/
    └── <workspaceId>/
        └── instances/
            └── <instanceKey>/
                ├── metadata.json
                ├── messages/
                │   ├── base.jsonl
                │   └── events.jsonl
                └── extensions/
                    └── <ext-name>.json
```

`workspaceId`는 Project Root 절대 경로의 SHA-256 기반으로 결정론적으로 생성된다.

---

## 11. CLI 치트시트

### 11.1 주 명령

```bash
gdn init [path]
gdn run [--watch] [--swarm <name>] [--instance-key <key>]
gdn restart [--agent <name>] [--fresh]
gdn validate [path] [--strict] [--format json]
gdn instance list
gdn instance delete <key> [--force]
gdn package add <ref>
gdn package install [--frozen-lockfile]
gdn package publish [--dry-run]
gdn doctor
```

### 11.2 전역 옵션

- `--config <path>`
- `--state-root <path>`
- `--json`
- `--verbose`
- `--quiet`

---

## 12. 샘플 프로젝트 가이드

`packages/sample/`의 주요 샘플:

1. `sample-1-coding-swarm`: Planner/Coder/Reviewer 협업
2. `sample-2-telegram-coder`: Telegram 연동
3. `sample-3-self-evolving`: Edit & Restart 패턴
4. `sample-4-compaction`: 대화 압축 Extension
5. `sample-5-package-consumer`: 패키지 소비
6. `sample-6-cli-chatbot`: 가장 단순한 시작점
7. `sample-7-multi-model`: 다중 모델 라우팅
8. `sample-8-web-researcher`: 웹 수집/요약 분리
9. `sample-9-devops-assistant`: 계획/실행 분리 DevOps 보조

---

## 13. 트러블슈팅

### 13.1 `ObjectRef`를 찾지 못할 때

- `Kind/name` 형식인지 확인
- 패키지 리소스라면 `package` 필드 명시
- `gdn validate --format json`으로 정확한 경로 확인

### 13.2 Tool/Extension/Connector entry 로드 실패

- `spec.entry`가 Project Root(의존 패키지는 Package Root) 기준 상대 경로인지 확인
- `../` 또는 절대 경로 사용 여부 확인
- 파일 존재/권한 확인

### 13.3 환경 변수 누락

- `.env`, `.env.local`, `--env-file` 우선순위를 확인
- 필수 필드(`apiKey` 등)의 `valueFrom.env`가 해석되는지 확인

### 13.4 재시작 후 동작이 이상할 때

- 설정 변경 후 `gdn restart --fresh`로 상태 초기화 재시작
- 인스턴스 상태를 완전히 비우려면 `gdn instance delete <key>` 사용

### 13.5 Crash Loop 발생 시

- 프로세스 로그에서 연속 크래시 원인 확인
- Tool/Extension 초기화 예외 여부 확인
- 백오프 상태(`crashLoopBackOff`)에서 원인 수정 후 재시작

---

## 14. 문서 동기화 원칙

Goondan 문서를 수정할 때는 아래 우선순위를 따른다.

1. 타입: `docs/specs/shared-types.md`
2. 리소스 스키마: `docs/specs/resources.md`
3. 런타임 동작: `docs/specs/runtime.md`
4. CLI 인터페이스: `docs/specs/cli.md`
5. 공통 운영 계약: `docs/specs/help.md`

`GUIDE.md`는 위 SSOT를 해설하는 문서이며, 규범 자체를 재정의하지 않는다.

---

## 15. 다음 액션

처음 시작할 때 권장 순서:

1. `gdn init`으로 프로젝트 생성
2. `goondan.yaml`에 Model/Agent/Swarm/Connection 정의
3. `gdn package add @goondan/base` 후 `gdn package install`
4. `gdn validate`
5. `gdn run --watch`
6. 필요 시 Tool/Extension/Connector를 점진 확장
