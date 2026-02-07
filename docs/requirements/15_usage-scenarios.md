## 15. 예상 사용 시나리오

### 15.1 Slack thread 기반 장기 작업

사용자가 Slack thread에서 Swarm을 호출하면 Connection 규칙이 thread 식별자를 `instanceKey`로 계산해 동일 스레드를 동일 인스턴스로 라우팅한다. Agent는 같은 스레드에 진행 업데이트와 결과를 전송한다.

### 15.2 OAuth 승인 후 비동기 재개

Tool이 `authorization_required`를 받으면 에이전트가 승인 링크를 사용자에게 안내한다. 승인 완료 후 Runtime은 `auth.granted` 이벤트를 enqueue해 동일 인스턴스 작업을 재개한다.

### 15.3 Changeset 충돌 복구

동시에 열린 두 changeset이 순차 커밋되다가 후행 커밋에서 Git 충돌이 발생한다. Runtime은 `status="conflict"`와 충돌 파일 목록을 반환하고, 에이전트는 새 changeset에서 충돌을 해소해 재커밋한다.

### 15.4 ToolSearch 기반 도구 노출 최적화

Agent가 ToolSearch로 필요한 도구를 탐색한 뒤 다음 Step에서 Catalog를 조정해 과도한 도구 노출을 줄인다.

### 15.5 인스턴스 pause/resume 운영

운영자가 장기 실행 인스턴스를 pause하면 새 Turn 실행이 멈춘다. 이후 resume 시 큐 적재 이벤트를 FIFO 순서로 재개해 일관성을 유지한다.

### 15.6 Turn 중 장애 발생 후 메시지 복원

Turn 실행 중 프로세스가 비정상 종료되어도, Runtime은 마지막 `base.jsonl`과 잔존 `events.jsonl`을 다시 읽어 `NextMessages = BaseMessages + SUM(Events)`를 재계산한다. 이후 `turn.post` 재진입 또는 정책 기반 복구 절차를 수행해 메시지 상태를 일관되게 마무리한다.
