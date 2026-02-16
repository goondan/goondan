# brain-persona

단일 인격체처럼 보이지만, 내부적으로는 전문 에이전트(`coordinator`, `researcher`, `builder`, `reviewer`)가 협업하는 샘플입니다.

## 핵심 동작

- 모든 입력은 `coordinator`로 들어옵니다.
- `coordinator`는 필요 시 `agents__spawn`으로 **이미 정의된 Agent 리소스** 인스턴스를 준비해 위임합니다.
- `coordinator`는 위임 실행 시 `agents__send`를 기본으로 사용합니다 (`agents__request`는 짧은 즉시응답 질의에만 제한 사용).
- 하위 에이전트는 `agents__send`/`agents__request`를 통해 중간 보고/결과를 보냅니다.
- `Extension/context-injector`가 turn 시작 시 runtime catalog 힌트(`runtime_catalog` 블록)를 시스템 메시지로 주입합니다.
- 필요 시 `agents__catalog` 호출로 현재 Swarm에서 호출 가능한 에이전트 목록(`callableAgents`)을 복원합니다.
- 외부 채널 출력은 Connector가 아니라 Tool(`channel-dispatch__send`)로 수행합니다.
- `coordinator.spec.requiredTools=["channel-dispatch__send"]`로, `maxStepsPerTurn` 범위 내에서 최종 응답 전 해당 Tool 호출이 강제됩니다.
- 런타임은 채널별 outbound를 직접 처리하지 않으며, 응답 전달은 Tool 호출 결과로만 수행됩니다.
- `Connection.ingress.rules[].route.instanceKey="brain-persona-shared"`를 텔레그램/슬랙에 동일하게 설정해 채널 간 대화 기억을 공유합니다.

## 입력 채널

- Telegram: `@goondan/base`의 `telegram-polling` Connector 사용
- Slack: 로컬 `connectors/slack-webhook.mjs` (webhook 서버)

## 필수 환경변수

```bash
ANTHROPIC_API_KEY=...
TELEGRAM_BOT_TOKEN=...
## 선택: channel-dispatch에서 별도 토큰을 쓰고 싶다면
BRAIN_TELEGRAM_BOT_TOKEN=...
SLACK_BOT_TOKEN=...              # Slack 출력용
BRAIN_SLACK_BOT_TOKEN=...        # 선택(미설정 시 SLACK_BOT_TOKEN 사용)
# 선택: Slack 서명 검증을 켜려면
SLACK_SIGNING_SECRET=...
```

`.env.example`을 기반으로 세팅:

```bash
cp .env.example .env
# 값 채우기
```

## 실행

```bash
cd samples/brain-persona
gdn package install
gdn run --swarm brain --watch
```

## Slack Webhook

- 기본 포트: `8787` (`Connection/slack-to-brain`의 `SLACK_WEBHOOK_PORT`)
- Slack Events Request URL 예시:
  - `https://<your-domain>:8787/`
- `url_verification` challenge를 처리합니다.
- `SLACK_SIGNING_SECRET`이 설정된 경우 서명 검증을 수행합니다.

## 프롬프트 전제

- `coordinator`는 내부 멀티 에이전트 구조를 사용자에게 노출하지 않습니다.
- 입력에는 `[goondan_context]` JSON 블록이 포함될 수 있으며, 이 값으로 채널 라우팅 정보를 복원합니다.
- `context-injector` Extension이 turn마다 `[runtime_catalog]` 힌트를 주입할 수 있으며, coordinator는 이를 위임 판단에 활용합니다.
