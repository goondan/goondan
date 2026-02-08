# Sample 6: CLI Chatbot (초보자 첫 경험용)

Goondan의 가장 단순한 샘플입니다. 하나의 Agent와 CLI Connector만으로 구성된 채팅봇입니다.

## 디렉토리 구조

```
sample-6-cli-chatbot/
├── goondan.yaml      # Package + Bundle 정의 (@goondan/base 의존성, Model + Agent + Swarm + Connection)
├── prompts/
│   └── system.md     # 시스템 프롬프트
├── package.json      # npm 패키지 설정
├── README.md         # 사용법 안내
└── AGENTS.md         # 이 파일
```

## 리소스 정의

### Model
- `default-model`: Anthropic Claude Sonnet 4.5

### Agent
- `assistant`: 단일 AI 어시스턴트 (도구 없음)

### Swarm
- `default`: assistant 에이전트 1개로 구성

### Connection
- `cli-to-default`: `@goondan/base`의 `Connector/cli`를 `default` Swarm에 바인딩 (`swarmRef` 명시)

## 특징

- **최소 구성**: 로컬 4개 리소스(Model/Agent/Swarm/Connection) + base 패키지 Connector 참조
- **도구 없음**: LLM 대화만으로 동작하여 이해하기 쉬움
- **초보자 친화**: Goondan을 처음 접하는 개발자가 시스템 구조를 빠르게 파악할 수 있음

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/connector.md` - Connector 시스템 스펙
