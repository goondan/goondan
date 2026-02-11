## 10. 워크스페이스 모델

Goondan v2의 워크스페이스는 **2-root** 구조를 채택한다. 프로젝트 디렉터리(Project Root)와 시스템 상태 디렉터리(System Root, `~/.goondan/`)로 분리하여 관리한다.

### 10.1 루트 구조

규칙:

1. 워크스페이스는 **Project Root**와 **System Root** 두 개의 루트로 분리되어야 한다(MUST).
2. Project Root는 프로젝트 정의(구성 + 코드)를 포함한다.
3. System Root는 인스턴스 실행 상태와 시스템 전역 설정을 포함한다.
4. 두 루트는 물리적으로 분리되어야 한다(MUST). Runtime은 Project Root 하위에 실행 상태 디렉터리를 생성해서는 안 된다(MUST NOT).

### 10.2 Project Root 레이아웃

```text
<projectRoot>/
  goondan.yaml              # 모든 리소스 정의 (또는 분할 YAML)
  tools/                    # Tool entry 파일 (필요시)
  extensions/               # Extension entry 파일 (필요시)
  connectors/               # Connector entry 파일 (필요시)
```

규칙:

1. `gdn init`은 Project Root를 생성해야 한다(MUST).
2. `goondan.yaml`은 프로젝트의 모든 리소스(Model, Agent, Swarm, Tool, Extension, Connector, Connection, Package)를 정의해야 한다(MUST). 단일 파일 또는 복수 파일 분할을 모두 지원해야 한다(MUST).
3. Tool/Extension/Connector의 entry 파일은 Project Root 하위에 위치해야 한다(MUST).
4. Project Root에는 `.git/` 등 버전 관리 디렉터리를 포함할 수 있다(MAY).

### 10.3 System Root 레이아웃

```text
~/.goondan/                              # System Root
├── config.json                          # CLI/시스템 설정
├── packages/                            # 설치된 패키지
│   └── <packageName>@<version>/
└── workspaces/
    └── <workspaceId>/                   # 프로젝트별
        └── instances/
            └── <instanceKey>/           # 인스턴스별
                ├── metadata.json        # 상태, 생성일시
                ├── messages/
                │   ├── base.jsonl       # 확정된 Message 목록
                │   └── events.jsonl     # Turn 중 누적 MessageEvent 로그
                └── extensions/
                    └── <ext-name>.json  # Extension 상태
```

규칙:

1. `~/.goondan/`을 System Root 기본 경로로 사용해야 한다(SHOULD). 환경 변수 또는 설정으로 변경 가능해야 한다(MAY).
2. System Root는 `config.json`, `packages/`, `workspaces/`를 포함해야 한다(MUST).
3. `workspaceId`는 프로젝트 디렉터리 경로로부터 결정론적으로 생성되어야 한다(MUST).
4. 인스턴스 상태는 `workspaces/<workspaceId>/instances/<instanceKey>/` 하위에 저장되어야 한다(MUST).

### 10.4 Instance State 레이아웃

#### 10.4.1 metadata.json

규칙:

1. `metadata.json`에는 최소 상태(`idle` | `processing`)와 생성 일시, 최종 갱신 시각을 포함해야 한다(MUST).
2. `metadata.json`은 인스턴스의 Agent 이름, instanceKey를 포함해야 한다(MUST).
3. 인스턴스 `delete` 연산은 `metadata.json`을 포함한 인스턴스 디렉터리 전체를 제거해야 한다(MUST).

#### 10.4.2 messages/ 디렉터리

메시지 상태는 `base.jsonl`과 `events.jsonl`로 분리 저장된다.

##### 10.4.2.1 Message Base Log (`base.jsonl`)

Runtime은 인스턴스별 확정 메시지 스냅샷을 `base.jsonl`에 기록해야 한다(MUST).

레코드 형식:
```jsonl
{"id":"m1","data":{"role":"user","content":"Hello"},"metadata":{},"createdAt":"...","source":{"type":"user"}}
{"id":"m2","data":{"role":"assistant","content":"Hi!"},"metadata":{},"createdAt":"...","source":{"type":"assistant","stepId":"s1"}}
```

규칙:

1. Turn 종료 시점에는 모든 Turn 미들웨어 종료 후 최종 계산된 `BaseMessages + SUM(Events)`를 새 base로 기록해야 한다(MUST).
2. `base.jsonl`의 내용은 다음 Turn 시작 시 로드되는 현재 확정 메시지 목록이어야 한다(MUST).
3. Turn 종료 시 기존 base에 delta append가 가능하면 전체 rewrite 대신 delta append를 우선 사용해야 한다(SHOULD). Mutation(replace/remove/truncate)이 발생한 경우에만 rewrite해야 한다(SHOULD).

##### 10.4.2.2 Message Event Log (`events.jsonl`)

Runtime은 Turn 중 발생하는 MessageEvent를 `events.jsonl`에 append-only로 기록해야 한다(MUST).

레코드 형식:
```jsonl
{"type":"append","message":{"id":"m3","data":{"role":"user","content":"Fix the bug"},"metadata":{},"createdAt":"...","source":{"type":"user"}}}
{"type":"replace","targetId":"m1","message":{"id":"m1-v2","data":{"role":"user","content":"Updated"},"metadata":{},"createdAt":"...","source":{"type":"extension","extensionName":"compaction"}}}
```

규칙:

1. Runtime은 이벤트 append 순서를 `SUM(Events)`의 적용 순서로 사용해야 한다(MUST).
2. `events.jsonl`은 Turn 최종 base 반영이 성공한 뒤에만 비울 수 있다(MUST).
3. Runtime 재시작 시 `events.jsonl`이 비어 있지 않으면 마지막 base와 합성하여 복원해야 한다(MUST).
4. Turn 경계는 `turnId`로 구분되며, 서로 다른 Turn의 이벤트를 혼합 적용해서는 안 된다(MUST NOT).

##### 10.4.2.3 Turn 종료 시 폴드-커밋

규칙:

1. Turn이 정상 종료되면 `events.jsonl`의 이벤트를 `base.jsonl`에 폴딩(fold)해야 한다(MUST).
2. 폴딩 완료 후 `events.jsonl`을 클리어해야 한다(MUST).
3. 폴딩 중 오류가 발생하면 복원을 위해 해당 Turn의 `events.jsonl`을 유지해야 한다(SHOULD).

#### 10.4.3 extensions/ 디렉터리

규칙:

1. 각 Extension의 상태는 `extensions/<ext-name>.json` 파일에 JSON 형식으로 저장되어야 한다(MUST).
2. Extension 상태의 읽기/쓰기는 `ExtensionApi.state.get()`/`ExtensionApi.state.set()`을 통해 수행되어야 한다(MUST).
3. Extension 상태 파일은 인스턴스 `delete` 시 함께 제거되어야 한다(MUST).

### 10.5 packages/ 디렉터리

규칙:

1. `gdn package install`로 설치된 패키지는 `~/.goondan/packages/` 하위에 저장되어야 한다(MUST).
2. 패키지 디렉터리 이름은 `<packageName>@<version>` 형식을 따라야 한다(SHOULD).
3. 패키지 내 리소스는 `goondan.yaml`에서 참조할 수 있어야 한다(MUST).

### 10.6 보안 및 데이터 보존

규칙:

1. access token, refresh token, client secret 등 비밀값은 평문 저장이 금지된다(MUST). at-rest encryption을 적용해야 한다(MUST).
2. 로그/메트릭/컨텍스트 블록에 비밀값을 마스킹 없이 기록해서는 안 된다(MUST).
3. 감사 추적을 위해 인스턴스 라이프사이클 이벤트(delete 등)를 로그에 남겨야 한다(SHOULD).
4. Tool/Extension은 System Root의 비밀값 저장소 파일을 직접 읽거나 수정해서는 안 된다(MUST).

### 10.7 프로세스별 로깅

v2에서는 별도의 이벤트 로그/메트릭 로그 파일을 제거하고, 각 프로세스의 stdout/stderr를 활용한다.

규칙:

1. Orchestrator, AgentProcess, ConnectorProcess는 각각 stdout/stderr로 구조화된 로그를 출력해야 한다(SHOULD).
2. Orchestrator는 자식 프로세스의 stdout/stderr을 수집하여 통합 로그 출력을 제공할 수 있어야 한다(MAY).
3. 로그에는 프로세스 식별 정보(agentName, instanceKey 등)와 `traceId`를 포함해야 한다(SHOULD).
