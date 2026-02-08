# Sample 7: Multi-Model (여러 모델 조합)

Anthropic과 OpenAI 모델을 조합하여 작업 성격에 따라 최적의 에이전트에게 위임하는 샘플입니다.

## 디렉토리 구조

```
sample-7-multi-model/
├── package.yaml             # Bundle Package 정의 (@goondan/base 의존성)
├── goondan.yaml             # Bundle 정의 (2 Model + Tool + 3 Agent + Swarm + Connection)
├── prompts/
│   ├── router.system.md     # 라우터 에이전트 프롬프트
│   ├── creative-writer.system.md  # 창작 에이전트 프롬프트
│   └── analyst.system.md    # 분석 에이전트 프롬프트
├── tools/
│   └── delegate/
│       └── index.ts         # 위임 도구 핸들러
├── package.json             # npm 패키지 설정
├── tsconfig.json            # TypeScript 설정
├── README.md                # 사용법 안내
└── AGENTS.md                # 이 파일
```

## 리소스 정의

### Model
- `anthropic-model`: Anthropic Claude Sonnet 4.5 (라우터, 분석에 사용)
- `openai-model`: OpenAI GPT-4o (창작에 사용)

### Tool
- `delegate-tool`: 에이전트 간 작업 위임 도구
  - `agent.delegate`: 다른 에이전트에게 작업 위임

### Agent
- `router`: 요청 분석 후 적절한 에이전트에게 위임 (진입점, Anthropic)
- `creative-writer`: 창작/글쓰기 전문 (OpenAI, temperature: 0.9)
- `analyst`: 분석/추론 전문 (Anthropic, temperature: 0.2)

### Swarm
- `multi-model-swarm`: 3개 에이전트로 구성

### Connection
- `cli-to-multi-model-swarm`: `@goondan/base`의 `Connector/cli`를 스웜에 바인딩

## 핵심 개념

- **멀티 모델**: 각 에이전트가 서로 다른 LLM 모델을 사용
- **라우팅**: Router Agent가 작업 성격을 파악하여 위임
- **특화 에이전트**: 각 에이전트가 고유한 temperature와 프롬프트로 특화

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/tool.md` - Tool 시스템 스펙
