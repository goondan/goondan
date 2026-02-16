# packages/runtime

`@goondan/runtime` 패키지는 Orchestrator 상주 객체 모델, 파이프라인 실행 체인, 메시지 이벤트 소싱, Tool 실행 가드, Bundle/Resource 로딩 검증, Workspace 저장소를 담당한다.

## 책임 범위

- `src/pipeline/*`: turn/step/toolCall 미들웨어 레지스트리 및 onion 체이닝
- `src/conversation/*`: `NextMessages = BaseMessages + SUM(Events)` 기반 상태 계산
- `src/tools/*`: Tool 이름 파싱, ToolRegistry, ToolExecutor(errorMessageLimit 잘라내기, suggestion/helpUrl 추출), catalog 허용 범위 검증
- `src/types.ts`: Runtime/Tool 공통 타입 계약(AgentEvent.instanceKey, AgentToolRuntime request/send/spawn/list/catalog 등)
- `src/config/*`: Bundle/Resource 로딩, ObjectRef 파싱, 기본 검증(apiVersion/kind/ref), Kind별 최소 스키마 검증(Tool/Agent/Swarm/Extension/Connector/Connection), Package 문서 위치 규칙 검증
- `src/config/bundle-loader.ts`: 로컬 번들 + 설치된 dependency 패키지(`~/.goondan/packages`) 리소스 병합 로딩 (manifest는 `dist/goondan.yaml` 우선, 경로 기준은 Package Root)
- `src/workspace/*`: `messages/base.jsonl`, `messages/events.jsonl`, extension state 저장소, FileInstanceManager(list/delete)
- `src/orchestrator/*`: spawn/restart/reconcile/shutdown, process status, crash backoff, graceful shutdown ack 모델, desired state reconcile(누락 agent 자동 spawn/불필요 connector 정리), crashLoopBackOff 구조화 로그, AgentEventQueue(FIFO)
- `src/events/*`: Runtime 표준 이벤트 버스 인터페이스
- `test/*`: Node 환경(vitest) 테스트

## 구현 규칙

1. Bun 전용 API에 직접 결합하지 말고 인터페이스로 추상화한다.
2. 타입 단언(`as`, `as unknown as`) 없이 타입 가드로 안전성을 유지한다.
3. 공개 API는 `src/index.ts`에서만 export 한다.
4. 워크스페이스 메시지 저장은 JSONL append/fold 규칙을 준수한다.
5. `WorkspacePaths.workspaceId`는 Project Root + Package 이름을 입력으로 한 human-readable 해시 slug(예: `allied-gray-antelope-darrelle`)를 사용한다.
6. Tool 호출은 기본적으로 Step Tool Catalog에 포함된 항목만 허용한다.
