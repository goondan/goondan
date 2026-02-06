# CLI Chatbot - Goondan 시작하기

Goondan Agent Swarm Orchestrator의 가장 단순한 샘플입니다.
CLI에서 AI와 대화할 수 있는 기본 채팅봇을 구성합니다.

## 구성

| 리소스 | 이름 | 설명 |
|--------|------|------|
| Model | `default-model` | Anthropic Claude Sonnet 4.5 |
| Agent | `assistant` | 단일 AI 어시스턴트 |
| Swarm | `default` | 기본 스웜 (agent 1개) |
| Connector | `cli` | CLI 입출력 |

## 실행

```bash
# Goondan CLI로 실행
gdn run

# 또는 npm script 사용
pnpm start
```

## 커스터마이징

### 모델 변경
`goondan.yaml`에서 Model의 `spec.provider`와 `spec.name`을 수정합니다:

```yaml
kind: Model
metadata:
  name: default-model
spec:
  provider: openai
  name: gpt-4o
```

### 시스템 프롬프트 변경
`prompts/system.md` 파일을 수정하여 에이전트의 성격과 역할을 변경합니다.

## 다음 단계

이 샘플을 이해했다면 다음 샘플들을 살펴보세요:
- **sample-7-multi-model**: 여러 모델을 조합하는 멀티 에이전트 구성
- **sample-1-coding-swarm**: Planner/Coder/Reviewer 3개 에이전트 협업
- **sample-2-telegram-coder**: Telegram 봇 연동
