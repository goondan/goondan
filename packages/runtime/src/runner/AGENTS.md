# packages/runtime/src/runner

`runner` 디렉토리는 Goondan 런타임의 실행 엔트리(`runtime-runner`)와 connector child 실행 경로를 담당한다.

## 책임 범위

- `runtime-runner.ts`: Orchestrator 상주 실행 루프
  - Bundle 로딩, Connection/ingress 해석, connector child 프로세스 기동
  - Agent turn/step/toolCall 파이프라인 실행
  - AI SDK 기반 LLM 호출
  - Tool error를 LLM 교정에 유리한 형태(code/suggestion/helpUrl 포함 텍스트)로 tool-result에 반영
  - `step.started` RuntimeEvent에 LLM 입력 메시지 요약(`llmInputMessages`)을 포함해 Studio Logs 관측에 활용
  - inbound 메시지의 발신자 컨텍스트를 `message.metadata.__goondanInbound`로 영속화해 후속 관측(Studio)에서 구조적으로 복원 가능하게 유지
  - watch/tool 재시작 신호 시 Connector 종료 후 replacement runner 기동(포트 충돌 방지)
- `runtime-runner-connector-child.ts`: Connector entry 실행 전용 child 프로세스
- `runtime-routing.ts`: inbound context 포맷/라우팅 유틸
- `turn-policy.ts`: maxSteps 등 turn 정책 응답 유틸
- `runtime-restart-signal.ts`: Tool 출력의 재기동 신호 해석 유틸
- `runtime-runner-protocol.ts`: runner ready/start_error IPC 프로토콜 타입/가드
- `index.ts`: runner 경로 해석/프로토콜 export

## 구현 규칙

1. provider-specific 메시지 정규화(예: 특정 provider 전용 block 변환/삭제)는 넣지 않는다.
2. 메시지 트리밍/윈도우/요약 정책은 runner 코어에서 수행하지 않는다.
3. 메시지 정책은 Extension(`@goondan/base`의 `message-window`, `message-compaction`)에서만 수행한다.
4. 비밀이 아닌 설정은 환경변수보다 `goondan.yaml` 리소스 설정을 우선한다.
5. 타입 단언(`as`, `as unknown as`) 없이 타입 가드로 처리한다.
