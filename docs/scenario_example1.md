# 시나리오 예시 1: goondan CLI로 스웜 만들고 실행하기

## 목표
CLI 사용자 관점에서 **에이전트 스웜을 생성하고 실행**하는 전체 흐름을 보여준다.

## 전제
- goondan CLI를 설치/다운로드했다.
- 기본 확장 번들(base)을 사용할 수 있다.

## 1) 초기화
```bash
goondan init
```

### 결과
현재 디렉터리에 `goondan.yaml`이 생성된다. 기본 구성은 다음을 포함한다.
또한 `goondan init`는 Git 번들 `github.com/goondan/goondan/packages/base`를 자동 등록한다.
네트워크 접근이 불가능하면 등록이 실패할 수 있다.

- **Model**: anthropic `claude-sonnet-4-5`
  - openai `gpt-5.2`, google `gemini-2.5-flash`는 주석 처리된 샘플로 제공
- **Agent**: `default`
  - `prompts.system`으로 인라인 시스템 프롬프트 구성
  - `tools`: `fileRead`
  - `extensions`: `compaction`
  - `liveConfig` 없음
- **Swarm**: `default`
  - `entrypoint`: `default` Agent
  - `liveConfig` 없음
- **Connector**: `cli`
  - CLI 입력을 Swarm으로 라우팅

> 주의: `fileRead` 도구와 `compaction` 확장, `cli` 커넥터는 **base 번들**에서 제공된다.

## 2) base 번들 등록
```bash
goondan bundle add github.com/goondan/goondan/packages/base
```

> `goondan init`에서 기본 등록이 수행되므로, 필요 시 재등록/갱신 용도로 사용한다.

- CLI 기준 기본 경로는 `state/bundles.json`에 기록된다.
- 이후 `goondan run`에서 별도 `-b` 옵션 없이 사용할 수 있다.

## 3) 실행
```bash
goondan run
```

### 동작
- `goondan.yaml`이 기본 config로 사용된다.
- 동일 instanceKey를 사용하면 같은 SwarmInstance를 재사용한다.
- CLI 입력이 Agent에 전달되고, 응답은 터미널에 출력된다.
- 종료는 `:exit` 또는 `:quit` 입력으로 가능하다.

## 4) 새로운 인스턴스로 실행
```bash
goondan run --new
```

### 동작
- 새로운 SwarmInstance를 생성해 별도 상태로 실행한다.
- `--new`를 사용할 때마다 새로운 instanceKey가 생성된다.

---

## 참고: goondan.yaml 주요 부분 예시 (요약)
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: default-model
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
kind: Agent
metadata:
  name: default
spec:
  modelConfig:
    modelRef: Model/default-model
  prompts:
    system: |
      너는 Goondan default 에이전트다.
  tools:
    - { kind: Tool, name: fileRead }
  extensions:
    - { kind: Extension, name: compaction }
---
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: default }
  agents:
    - { kind: Agent, name: default }
---
kind: Connector
metadata:
  name: cli
spec:
  type: cli
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        instanceKeyFrom: "$.instanceKey"
        inputFrom: "$.text"
```

---

## 검증 체크리스트
- `goondan.yaml` 생성 확인
- `goondan bundle list`에서 base 번들이 보이는지 확인
- `goondan run` 실행 시 터미널에 응답이 출력되는지 확인
- `goondan run --new`로 신규 상태가 생성되는지 확인
