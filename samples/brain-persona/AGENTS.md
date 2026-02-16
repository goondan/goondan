# samples/brain-persona

이 샘플은 "하나의 인격체(Brain Persona)를 다중 전문 에이전트가 협업해 구현"하는 레퍼런스다.

## 구성 원칙

1. 모든 외부 입력은 `coordinator`로 진입한다.
2. `coordinator`는 사용자 의도를 과도하게 재해석하지 않고, 필요 시 하위 에이전트 인스턴스를 spawn/라우팅한다.
3. 최종 사용자 출력은 Connector가 아니라 Tool(`channel-dispatch`)로 전달한다. Telegram lifecycle(typing/reaction/edit/delete/추가 안내 메시지)은 `@goondan/base` `telegram` Tool로, Slack lifecycle(read/reaction/edit/delete/추가 안내 메시지)은 `@goondan/base` `slack` Tool로 제어할 수 있다. self-evolution 적용 시 `self-restart` Tool(`self-restart__request`)로 런타임 재기동을 요청할 수 있다.
4. 하위 에이전트는 작업 중간 상태를 `coordinator`에게 보고하며, 외부 채널에는 직접 응답하지 않는다.

## 파일 가이드

- `goondan.yaml`: 샘플 리소스 정의
- `.env.example`: 실행에 필요한 환경변수 템플릿
- `prompts/*`: coordinator/전문 에이전트 시스템 프롬프트
- `extensions/*`: 샘플 전용 runtime middleware (context 주입/정책 실험)
- `connectors/slack-webhook.mjs`: Slack webhook 입력 수신 커넥터
- `tools/channel-dispatch.mjs`: Telegram/Slack 출력 전달 Tool

## 수정 시 체크

1. 채널 라우팅 키(`chat_id`, `channel_id`, `thread_ts`)를 깨지지 않게 유지한다.
2. 최종 outbound는 Tool(`channel-dispatch__send`) 호출로 유지하고, Telegram lifecycle 제어는 `telegram__send/edit/delete/react/setChatAction`, Slack lifecycle 제어는 `slack__send/read/edit/delete/react` 사용을 허용한다.
3. `coordinator.spec.requiredTools`가 채널 전달 Tool을 강제하도록 유지한다.
4. Telegram/Slack Connection의 `ingress.rules[].route.instanceKey`를 동일하게 유지해 채널 간 기억을 공유한다.
5. `coordinator`는 위임 실행 시 `agents__send`를 기본으로 사용하도록 프롬프트를 유지한다.
6. 프롬프트가 "단일 자아 톤"을 유지하도록 coordinator/하위 에이전트를 함께 점검한다.
7. `coordinator` 프롬프트는 위임 대상이 불명확할 때 `agents__catalog`를 호출해 `callableAgents`를 확인하도록 유지한다.
8. `Extension/context-injector`가 `[runtime_catalog]` 힌트를 주입하는 동작을 유지하고, coordinator 프롬프트와 충돌하지 않게 점검한다.
9. 장기 실행 안정성을 위해 `coordinator`에는 `message-window` + `message-compaction`, 하위 전문 에이전트에는 최소 `message-window`를 유지한다.
10. coordinator의 Extension 선언 순서는 `message-window -> message-compaction -> context-injector`를 유지한다.
11. coordinator의 Tool 선언에 `@goondan/base` `Tool/telegram`, `Tool/slack` 및 로컬 `Tool/self-restart`가 포함되어 채널 lifecycle 제어와 self-restart를 수행할 수 있게 유지한다.
12. self-restart가 필요한 turn에서는 `self-restart__request`를 마지막 Tool call로 1회만 호출하도록 coordinator 프롬프트를 유지한다.
