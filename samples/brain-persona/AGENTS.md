# samples/brain-persona

이 샘플은 "하나의 인격체(Brain Persona)를 다중 전문 에이전트가 협업해 구현"하는 레퍼런스다.

## 구성 원칙

1. 모든 외부 입력은 `coordinator`로 진입한다.
2. `coordinator`는 사용자 의도를 과도하게 재해석하지 않고, 필요 시 하위 에이전트 인스턴스를 spawn/라우팅한다.
3. 최종 사용자 출력은 Connector가 아니라 Tool(`channel-dispatch`)로 전달한다.
4. 하위 에이전트는 작업 중간 상태를 `coordinator`에게 보고하며, 외부 채널에는 직접 응답하지 않는다.

## 파일 가이드

- `goondan.yaml`: 샘플 리소스 정의
- `.env.example`: 실행에 필요한 환경변수 템플릿
- `prompts/*`: coordinator/전문 에이전트 시스템 프롬프트
- `connectors/slack-webhook.mjs`: Slack webhook 입력 수신 커넥터
- `tools/channel-dispatch.mjs`: Telegram/Slack 출력 전달 Tool

## 수정 시 체크

1. 채널 라우팅 키(`chat_id`, `channel_id`, `thread_ts`)를 깨지지 않게 유지한다.
2. outbound는 반드시 Tool(`channel-dispatch__send`) 호출로만 처리되도록 유지한다.
3. `coordinator.spec.requiredTools`가 채널 전달 Tool을 강제하도록 유지한다.
4. Telegram/Slack Connection의 `ingress.rules[].route.instanceKey`를 동일하게 유지해 채널 간 기억을 공유한다.
5. `coordinator`는 위임 실행 시 `agents__send`를 기본으로 사용하도록 프롬프트를 유지한다.
6. 프롬프트가 "단일 자아 톤"을 유지하도록 coordinator/하위 에이전트를 함께 점검한다.
