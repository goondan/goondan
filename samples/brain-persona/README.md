# brain-persona

단일 인격체처럼 보이지만, 내부적으로는 6개 전문 에이전트(`coordinator`, `worker`, `unconscious`, `observer`, `reflection`, `dream`)가 협업하는 샘플입니다.

## 에이전트 구성

| 에이전트 | 모델 | 역할 |
|----------|------|------|
| `coordinator` | fast-model (Haiku) | 반사적 뇌. 요청 난이도에 따라 즉답/대기/위임을 선택하고, worker 결과를 사용자용으로 정제해 전달 |
| `worker` | default-model (Sonnet) | 실제 작업 수행. 사용자 요청을 처리하고 결과를 coordinator에 보고 |
| `unconscious` | fast-model (Haiku) | 무의식 맥락 제공. Worker turn 시작 시 관련 기억/맥락을 자동 주입 |
| `observer` | fast-model (Haiku) | 관측자. Worker turn 완료 후 구조화 관측 이벤트(입력/도구 인자/도구 결과/출력)를 선별 기록 |
| `reflection` | default-model (Sonnet) | 성찰. observer 관측을 바탕으로 패턴 분석 및 성찰 기록 |
| `dream` | default-model (Sonnet) | 꿈(통합). 유휴 시간에 일지/관측/성찰로부터 지식 문서를 생성/갱신 |

## 핵심 동작

- 모든 입력은 `coordinator`로 들어옵니다.
- `coordinator`는 반사적으로 즉각 반응(typing, reaction)한 뒤, 요청 성격에 맞춰 `즉답/대기/선응답 후 위임` 중 하나를 선택합니다.
- 간단한 요청은 coordinator가 직접 처리하고, 복잡하거나 시간이 걸리는 요청만 worker에 위임합니다.
- `coordinator`는 위임 실행 시 `agents__send`를 기본으로 사용합니다 (`agents__request`는 짧은 즉시응답 질의에만 제한 사용).
- `worker` turn 시작 시 `worker-lifecycle` Extension이 `unconscious`에 맥락을 요청해 시스템 메시지로 주입합니다.
- `worker`의 매 step 시작 시 `date-helper` Extension이 `[current_time]` 시스템 메시지로 현재 시각을 주입합니다.
- `worker` turn 완료 후 `worker-lifecycle` Extension이 `observer`에 구조화 관측 이벤트(JSON + legacy summary)를 전송합니다 (fire-and-forget).
- `observer`는 관측 기록을 남기고, 필요 시 `reflection`에 성찰을 요청합니다.
- 유휴 시간에 `idle-monitor` Extension이 `dream` 에이전트를 트리거해 지식을 통합합니다.
- `Extension/context-injector`가 turn 시작 시 runtime catalog 힌트(`runtime_catalog` 블록)를 시스템 메시지로 주입합니다.
- `coordinator`는 장기 실행 컨텍스트 관리를 위해 `message-window` + `message-compaction` Extension을 함께 사용합니다.
- 하위 에이전트(`worker`, `unconscious`, `observer`, `reflection`, `dream`)는 `message-window` Extension으로 메시지 윈도우를 제한합니다.
- 필요 시 `agents__catalog` 호출로 현재 Swarm에서 호출 가능한 에이전트 목록(`callableAgents`)을 복원합니다.
- 최종 외부 채널 출력은 Connector가 아니라 채널별 Tool(`telegram__send` 또는 `slack__send`)로 수행합니다.
- Telegram 입력에서는 coordinator가 `telegram__send/edit/delete/react/setChatAction`을 함께 사용해 메시지 lifecycle(typing, reaction, 수정/삭제, 추가 안내 메시지)을 제어할 수 있습니다.
- Slack 입력에서는 coordinator가 `slack__send/read/edit/delete/react`를 함께 사용해 메시지 lifecycle(조회, reaction, 수정/삭제, 추가 안내 메시지)을 제어할 수 있습니다.
- 모호한 요청에서 대기가 필요하면 coordinator가 `wait__seconds`로 먼저 8~12초 정도 짧게 기다리고, 그래도 결과가 없을 때만 짧은 안내 메시지 1회를 보냅니다.
- 설정/프롬프트/툴 파일이 바뀐 turn에서는 coordinator가 `self-restart__request`를 호출해 런타임 self-restart를 요청할 수 있습니다.
- `coordinator.spec.requiredTools=["telegram__send","slack__send"]`로, `maxStepsPerTurn` 범위 내에서 둘 중 하나 이상의 성공 호출(any-of)이 강제됩니다.
- 런타임은 채널별 outbound를 직접 처리하지 않으며, 응답 전달은 Tool 호출 결과로만 수행됩니다.
- `Connection.ingress.rules[].route.instanceKey="brain-persona-shared"`를 텔레그램/슬랙에 동일하게 설정해 채널 간 대화 기억을 공유합니다.

## 입력 채널

- Telegram: `@goondan/base`의 `telegram-polling` Connector 사용
- Slack: `@goondan/base`의 `Connector/slack` 사용 (webhook 서버)

## 필수 환경변수

```bash
ANTHROPIC_API_KEY=...
TELEGRAM_BOT_TOKEN=...           # telegram-polling + telegram Tool 기본 토큰
SLACK_BOT_TOKEN=...              # Slack 출력용
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

이미 실행 중인 인스턴스를 최신 runner로 재시작:

```bash
gdn instance list
gdn instance restart <instanceKey>
```

## Slack Webhook

- 입력 커넥터: `Connection/slack-to-brain -> @goondan/base Connector/slack`
- 기본 포트: `3102` (`Connection/slack-to-brain`의 `SLACK_WEBHOOK_PORT`)
- ingress 이벤트: `app_mention`, `message_im`
- Slack Events Request URL 예시:
  - `https://<your-domain>:3102/`
- `url_verification` challenge를 처리합니다.
- `SLACK_SIGNING_SECRET`이 설정된 경우 서명 검증을 수행합니다.

## 프롬프트 전제

- `coordinator`는 내부 멀티 에이전트 구조를 사용자에게 노출하지 않습니다.
- 입력에는 `[goondan_context]` JSON 블록이 포함될 수 있으며, 이 값으로 채널 라우팅 정보를 복원합니다.
- `context-injector` Extension이 turn마다 `[runtime_catalog]` 힌트를 주입할 수 있으며, coordinator는 이를 위임 판단에 활용합니다.
- Telegram 메시지 포매팅이 필요하면 `telegram__send/edit`의 `parseMode`(`Markdown`, `MarkdownV2`, `HTML`)를 사용합니다.
- Slack 메시지 lifecycle 제어는 `slack__send/read/edit/delete/react` 호출을 사용합니다.
- coordinator의 Extension 순서는 `message-window -> message-compaction -> context-injector -> idle-monitor`입니다.
  메시지 정책 적용 후 catalog 힌트를 주입해 최신 위임 후보가 turn 직전에 반영되도록 유지합니다.
