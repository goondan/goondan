# Sample 5: Package Consumer

Bundle Package 의존성 시스템을 시연하는 샘플입니다. `sample-1-coding-swarm` 패키지를 의존성으로 참조합니다.

## 디렉토리 구조

```
sample-5-package-consumer/
├── package.yaml          # Bundle Package 매니페스트 (의존성 선언)
├── goondan.yaml          # Bundle 정의 (커스텀 Agent, Swarm, Connector)
├── prompts/
│   └── custom.system.md  # 커스텀 어시스턴트 프롬프트
├── package.json          # npm 패키지 설정
├── README.md
└── AGENTS.md             # 이 파일
```

## 핵심 개념

### 패키지 의존성 (package.yaml)
```yaml
spec:
  dependencies:
    - "file:../sample-1-coding-swarm"
```

### 패키지 리소스 참조 (goondan.yaml)
```yaml
# 의존 패키지의 Model 참조
modelRef: { kind: Model, name: default-model }

# 의존 패키지의 Tool 참조
tools:
  - { kind: Tool, name: file-toolkit }

# 의존 패키지의 Agent 참조
agents:
  - { kind: Agent, name: planner }
  - { kind: Agent, name: coder }
```

## 리소스 정의

### 로컬 리소스
- `assistant` (Agent): 커스텀 프롬프트를 사용하는 새 에이전트
- `custom-swarm` (Swarm): 로컬+패키지 에이전트 조합
- `cli` (Connector): CLI 인터페이스

### 패키지에서 가져온 리소스
- `default-model` (Model): Claude Sonnet 4.5
- `file-toolkit` (Tool): 파일 도구
- `planner`, `coder` (Agent): 코딩 스웜 에이전트

## 참조 스펙
- `/docs/specs/bundle_package.md` - Bundle Package 스펙
- `/packages/core/src/bundle/package/` - Package 시스템 구현

## 수정 시 주의사항
1. package.yaml의 dependencies 경로가 올바른지 확인
2. 참조하는 리소스 이름이 패키지에 존재하는지 확인
3. 이름 충돌 시 `package` 필드로 명시적 참조
