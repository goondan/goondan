# How to: Swarm 실행하기

> Goondan 스웜 인스턴스를 초기화하고, 실행하고, 재시작하고, 관리하는 방법.

[English version](./run-a-swarm.md)

---

## 사전 요구사항

- [Bun](https://bun.sh) 설치됨 (Goondan이 지원하는 유일한 런타임)
- `@goondan/cli` 전역 설치:
  ```bash
  bun add -g @goondan/cli
  ```
- LLM API 키 (예: `ANTHROPIC_API_KEY`)

---

## 1. 프로젝트 초기화

```bash
gdn init ./my-swarm
cd my-swarm
```

`goondan.yaml`에 `kind: Package` 문서, `Model`, `Agent`, `Swarm`이 생성됩니다. 바로 실행할 수 있는 구성입니다.

**생성되는 파일 구조:**

```
my-swarm/
  goondan.yaml           # 메인 설정 파일 (apiVersion: goondan.ai/v1)
  prompts/
    default.system.md    # 기본 시스템 프롬프트
  .env                   # 환경 변수 템플릿
  .gitignore
```

`--template` 옵션으로 다른 구조를 선택할 수 있습니다:

```bash
# 멀티 에이전트 스웜 스캐폴드
gdn init --template multi-agent

# 최소 구성
gdn init --template minimal
```

> 모든 옵션은 [CLI 레퍼런스: `gdn init`](../reference/cli-reference.ko.md#gdn-init)을 참고하세요.

---

## 2. 환경 변수 설정

`.env` 파일에 API 키를 추가합니다:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

머신별 설정은 `.env.local`에 작성합니다 (기본적으로 gitignore 대상):

```bash
# .env.local -- 이 머신에서만 적용되는 오버라이드
ANTHROPIC_API_KEY=sk-ant-my-local-key...
GOONDAN_LOG_LEVEL=debug
```

**로딩 우선순위** (먼저 로드된 값이 우선):

1. `--env-file <path>` (최우선)
2. `.env.local`
3. `.env`

이미 시스템에 설정된 환경 변수는 `.env` 파일에 의해 **덮어씌워지지 않습니다**.

> 커스텀 env 파일도 사용 가능합니다: `gdn run --env-file ./env.production`

---

## 3. 설정 검증

실행 전에 번들 구성이 올바른지 확인합니다:

```bash
gdn validate
```

스키마 준수, 참조 무결성, 엔트리 파일 존재, 순환 참조, 명명 규칙, Kind 검증을 수행합니다.

JSON 출력 (CI에 유용):

```bash
gdn validate --format json
```

엄격 모드 (경고도 오류로 처리):

```bash
gdn validate --strict
```

> 자세한 내용은 [CLI 레퍼런스: `gdn validate`](../reference/cli-reference.ko.md#gdn-validate)를 참고하세요.

---

## 4. 스웜 실행

```bash
gdn run
```

**동작 순서:**

1. `goondan.yaml`을 파싱하고 `kind: Package` 문서를 검증
2. Swarm 선택 (`Swarm/default`를 기본으로, Swarm이 하나뿐이면 자동 선택)
3. `Swarm.spec.instanceKey ?? Swarm.metadata.name` 규칙으로 instanceKey 계산
4. Orchestrator를 상주 프로세스로 기동
5. 정의된 Connection에 대해 ConnectorProcess 스폰
6. CLI 대화형 루프 시작 (기본 Connector)

동일 instanceKey의 Orchestrator가 이미 실행 중이면, 새 프로세스를 생성하지 않고 기존 프로세스를 재사용(resume)합니다.

### 특정 Swarm 실행

프로젝트에 여러 Swarm이 정의되어 있다면:

```bash
gdn run --swarm code-review
```

### 단일 입력 (비대화형)

```bash
# 메시지 하나를 보내고 종료
gdn run --input "AI 에이전트에 대한 최신 뉴스를 요약해줘"

# 파일에서 입력
gdn run --input-file ./request.txt
```

### 포그라운드 모드

```bash
gdn run --foreground
```

Orchestrator가 현재 터미널에서 실행됩니다. Ctrl+C로 종료합니다.

> 모든 옵션은 [CLI 레퍼런스: `gdn run`](../reference/cli-reference.ko.md#gdn-run)을 참고하세요.

---

## 5. Watch 모드 (개발용)

개발 중에는 `--watch`를 사용하면 파일 변경 시 영향받는 프로세스가 자동 재시작됩니다:

```bash
gdn run --watch
```

Watch 모드에서 Orchestrator는 다음을 감시합니다:

- `goondan.yaml` 및 관련 리소스 파일
- Tool/Extension/Connector 엔트리 파일 (`.ts`/`.js`)

변경이 감지되면 영향받는 AgentProcess만 선택적으로 재시작됩니다. 대화 히스토리는 기본적으로 재시작 후에도 유지됩니다.

> Edit & Restart 모델에 대한 자세한 내용은 [설명: 런타임 모델](../explanation/runtime-model.ko.md#edit--restart-설정-변경-모델)을 참고하세요.

---

## 6. Orchestrator 재시작

`goondan.yaml`을 수정한 후 (`--watch` 미사용 시) 변경사항을 적용하려면:

```bash
# Orchestrator 전체 재시작
gdn restart

# 특정 에이전트 프로세스만 재시작
gdn restart --agent coder

# 모든 상태(메시지 히스토리, Extension 상태) 초기화 후 재시작
gdn restart --fresh

# 특정 에이전트를 상태 초기화와 함께 재시작
gdn restart --agent coder --fresh
```

기본 `gdn restart` 동작:

1. `runtime/active.json`에서 active Orchestrator 인스턴스를 읽음
2. Swarm 정의에서 instanceKey를 재계산
3. 대체 runner 프로세스를 먼저 기동
4. 기존 Orchestrator PID를 종료

`--agent` 지정 시 해당 에이전트의 프로세스만 재시작되며, 다른 에이전트는 중단 없이 계속 실행됩니다. 대화 히스토리는 `--fresh`를 사용하지 않는 한 기본적으로 보존됩니다.

> 모든 옵션은 [CLI 레퍼런스: `gdn restart`](../reference/cli-reference.ko.md#gdn-restart)를 참고하세요.

---

## 7. 인스턴스 관리

### 실행 중인 인스턴스 목록

```bash
gdn instance list
```

출력:

```
INSTANCE KEY    AGENT          STATUS    CREATED              UPDATED
default         orchestrator   running   2026-02-13 09:30:00  2026-02-13 09:30:00
```

### 인터랙티브 TUI

하위 명령어 없이 `gdn instance`를 실행하면 인터랙티브 TUI 모드에 진입합니다 (TTY 필요):

```bash
gdn instance
```

**키보드 단축키:**

| 키 | 동작 |
|----|------|
| `r` | 선택한 인스턴스 재시작 |
| `q` / Ctrl+C | 종료 |

각 행에 `started` 타임스탬프가 표시되어 재시작 여부를 확인할 수 있습니다.

### 특정 인스턴스 재시작

```bash
gdn instance restart default
```

최신 runner 바이너리로 인스턴스를 재시작하고 instanceKey를 재계산합니다.

### 인스턴스 삭제

```bash
# 확인 프롬프트 포함
gdn instance delete user:123

# 확인 없이 강제 삭제
gdn instance delete user:123 --force
```

인스턴스를 삭제하면 모든 상태(메시지 히스토리, Extension 상태, 워크스페이스 디렉터리)가 제거됩니다. 해당 인스턴스의 실행 중인 runtime-runner PID도 종료됩니다.

> 자세한 내용은 [CLI 레퍼런스: `gdn instance`](../reference/cli-reference.ko.md#gdn-instance)를 참고하세요.

---

## 8. 로그 확인

```bash
# active 인스턴스 orchestrator 로그 (최근 200줄)
gdn logs

# 에이전트 이름으로 필터링
gdn logs --agent coder

# 특정 trace 체인을 에이전트 간 추적
gdn logs --trace <traceId>

# 에이전트와 trace 필터 결합
gdn logs --agent coder --trace <traceId>

# 특정 인스턴스, stderr만
gdn logs --instance-key session-001 --stream stderr --lines 100

# 특정 프로세스 로그 (예: connector)
gdn logs --process connector-telegram
```

`--agent`와 `--trace` 플래그는 멀티 에이전트 디버깅에 특히 유용합니다. `--trace`는 스웜 내 모든 에이전트에 걸쳐 단일 인과 체인(traceId)을 추적하므로, 특정 에이전트가 _왜_ 호출되었는지 쉽게 파악할 수 있습니다.

로그 파일 경로:

```
~/.goondan/runtime/logs/<instanceKey>/<process>.stdout.log
~/.goondan/runtime/logs/<instanceKey>/<process>.stderr.log
```

> 모든 옵션은 [CLI 레퍼런스: `gdn logs`](../reference/cli-reference.ko.md#gdn-logs)를 참고하세요.

---

## 9. 환경 진단

```bash
gdn doctor
```

검사 항목:

- **System**: Bun 버전, 패키지 매니저 설치 여부
- **API Keys**: LLM API 키 설정 여부
- **Goondan Packages**: 설치된 패키지 버전
- **Project**: `goondan.yaml` 존재 여부 및 유효성

> 자세한 내용은 [CLI 레퍼런스: `gdn doctor`](../reference/cli-reference.ko.md#gdn-doctor)를 참고하세요.

---

## 트러블슈팅

### "Package document not found"

`gdn run`은 `goondan.yaml`에 `kind: Package` 문서와 `metadata.name`이 필요합니다. `gdn init`으로 생성하거나 수동으로 추가하세요:

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-project
spec:
  version: "0.1.0"
```

### "Orchestrator already running"

`gdn run`이 이미 실행 중인 Orchestrator를 보고하면, 해당 프로세스를 재사용합니다. 새로 시작하려면:

```bash
gdn instance delete default --force
gdn run
```

### Startup handshake 실패

`gdn run`이 즉시 실패하면 로그를 확인하세요:

```bash
gdn logs --stream stderr
```

주요 원인:
- `.env`에 API 키가 없거나 잘못됨
- `goondan.yaml`에서 참조하는 엔트리 파일이 존재하지 않음 (`gdn validate` 실행)
- `@goondan/cli`와 `@goondan/runtime` 버전 불일치

### Watch 모드에서 변경 감지 안 됨

프로젝트 디렉터리 내의 파일을 수정하고 있는지 확인하세요. Watch 모드는 `goondan.yaml`, 리소스 파일, Tool/Extension/Connector가 참조하는 엔트리 파일을 감시합니다.

---

## 빠른 참조: 자주 쓰는 워크플로우

| 작업 | 명령어 |
|------|--------|
| 새 프로젝트 생성 | `gdn init ./my-swarm` |
| 설정 검증 | `gdn validate` |
| 스웜 시작 | `gdn run` |
| Watch 모드로 시작 | `gdn run --watch` |
| 설정 변경 후 재시작 | `gdn restart` |
| 특정 에이전트 재시작 | `gdn restart --agent coder` |
| 상태 초기화 후 재시작 | `gdn restart --fresh` |
| 인스턴스 목록 | `gdn instance list` |
| 인스턴스 재시작 | `gdn instance restart <key>` |
| 인스턴스 삭제 | `gdn instance delete <key> --force` |
| 로그 확인 | `gdn logs` |
| 에이전트별 로그 확인 | `gdn logs --agent coder` |
| trace 체인 추적 | `gdn logs --trace <traceId>` |
| 환경 진단 | `gdn doctor` |

---

## 관련 문서

- [CLI 레퍼런스](../reference/cli-reference.ko.md) -- `gdn` 전체 명령어 레퍼런스
- [설명: 런타임 모델](../explanation/runtime-model.ko.md) -- Orchestrator, 프로세스, IPC 동작 원리
- [How to: 내장 Tool 활용하기](./use-builtin-tools.ko.md) -- `@goondan/base`에 포함된 Tool 활용법
- [레퍼런스: 리소스](../reference/resources.ko.md) -- 8종 리소스 Kind YAML 스키마

---

_위키 버전: v0.0.3_
