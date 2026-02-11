## 15. 예상 사용 시나리오

### 15.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면 Connection 규칙이 thread 식별자를 `instanceKey`로 계산해 동일 스레드를 동일 인스턴스로 라우팅한다. Connector는 별도 Bun 프로세스로 Slack 이벤트를 수신하고, ConnectorEvent를 Orchestrator에 IPC로 전달한다. Orchestrator는 해당 instanceKey의 AgentProcess로 라우팅하며, AgentProcess가 없으면 자동 스폰한다. Agent는 같은 스레드에 진행 업데이트와 결과를 전송한다.

### 15.2 Edit & Restart 시나리오

운영자 또는 개발자가 에이전트 동작을 변경하고자 할 때:

1. `goondan.yaml` 또는 개별 리소스 파일을 수정한다.
2. Orchestrator가 설정 변경을 감지하거나(`--watch` 모드), 운영자가 `gdn restart` 명령을 실행한다.
3. Orchestrator가 영향받는 AgentProcess를 kill하고, 새 설정으로 re-spawn한다.
4. 기본적으로 기존 대화 히스토리(`base.jsonl`)가 유지되어 대화 연속성이 보장된다.
5. `--fresh` 옵션을 사용하면 대화 히스토리를 초기화하고 새로 시작할 수 있다.

Orchestrator는 어떤 리소스가 변경되었는지 파악하여, 영향받는 AgentProcess만 선택적으로 재시작해야 한다(MUST). 변경되지 않은 AgentProcess와 ConnectorProcess는 계속 실행 상태를 유지해야 한다(MUST).

### 15.3 Watch 모드 시나리오

개발 중 빠른 반복을 위해 watch 모드를 사용한다:

1. `gdn run --watch`로 Orchestrator를 기동한다.
2. 개발자가 Tool 구현 파일, Extension 파일, 또는 `goondan.yaml`을 편집한다.
3. Orchestrator가 파일 변경을 감지하고, 영향받는 리소스를 판별한다.
4. 해당 리소스를 사용하는 AgentProcess를 자동으로 kill -> re-spawn한다.
5. 새 AgentProcess는 업데이트된 코드/설정으로 기동되며, 기존 대화 히스토리를 이어받는다.

규칙:

1. Watch 모드는 `goondan.yaml` 및 리소스 `spec.entry`에 선언된 파일을 감시해야 한다(MUST).
2. 파일 변경 후 재시작까지의 지연은 최소화해야 한다(SHOULD).
3. 빈번한 변경에 대해 debounce를 적용하는 것을 권장한다(SHOULD).

### 15.4 ToolSearch 기반 도구 노출 최적화

Agent가 ToolSearch 메타 도구로 필요한 도구를 탐색한 뒤, Extension이 다음 Step의 `toolCatalog`를 조정해 과도한 도구 노출을 줄인다. Step 미들웨어의 `ctx.toolCatalog` 조작을 통해 LLM에 노출되는 도구 수를 동적으로 제어한다.

### 15.5 AgentProcess 재시작 시나리오

운영자가 실행 중인 특정 Agent를 재시작하고자 할 때:

1. `gdn restart --agent coder` 명령을 실행한다.
2. 명령이 실행 중인 Orchestrator에 IPC/신호를 전송한다.
3. Orchestrator가 해당 Agent의 모든 인스턴스 프로세스를 kill한다.
4. 현재 Turn이 진행 중이면, Turn의 events.jsonl이 남아 있을 수 있다.
5. Orchestrator가 새 설정으로 AgentProcess를 re-spawn한다.
6. 새 프로세스는 `base.jsonl` + 잔존 `events.jsonl`에서 메시지 상태를 복원한다.

`gdn restart --fresh`를 사용하면 모든 AgentProcess의 대화 히스토리를 초기화하고 재시작한다.

### 15.6 AgentProcess 크래시 후 복원

AgentProcess가 비정상 종료되었을 때:

1. Orchestrator가 자식 프로세스의 exit 이벤트를 감지한다.
2. Orchestrator가 즉시 해당 Agent의 새 프로세스를 자동 re-spawn한다.
3. 새 AgentProcess는 마지막 `base.jsonl`과 잔존 `events.jsonl`을 읽어 `NextMessages = BaseMessages + SUM(Events)`를 재계산한다.
4. 복원된 메시지 상태로 새로운 이벤트 처리를 재개한다.

규칙:

1. Orchestrator는 AgentProcess exit를 감지하고 자동 재스폰해야 한다(MUST).
2. 재스폰된 프로세스는 `base.jsonl` + `events.jsonl`에서 메시지 상태를 복원해야 한다(MUST).
3. 반복 크래시(crash loop)를 감지하고 재시작 간격을 점진적으로 늘리는 것을 권장한다(SHOULD).
4. 크래시 원인을 로그에 기록하여 디버깅을 돕는 것을 권장한다(SHOULD).
