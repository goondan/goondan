# Package Consumer Sample

Goondan Bundle Package 시스템의 패키지 의존성 기능을 시연하는 샘플입니다.

## 개요

이 샘플은 `@goondan-samples/coding-swarm` 패키지를 의존성으로 참조하여:
1. 패키지의 리소스(Tool, Agent)를 재사용
2. 커스텀 프롬프트로 새 Agent 정의
3. 패키지의 Agent와 새 Agent를 조합한 Swarm 구성

## 구조

```
sample-5-package-consumer/
├── package.yaml          # Bundle Package 매니페스트 (의존성 선언)
├── goondan.yaml          # Bundle 정의 (커스텀 Agent, Swarm, Connection)
├── prompts/
│   └── custom.system.md  # 커스텀 어시스턴트 프롬프트
├── package.json
└── README.md
```

## 의존성 참조 방식

`package.yaml`에서 로컬 패키지 참조:

```yaml
spec:
  dependencies:
    - "file:../sample-1-coding-swarm"
    - "@goondan/base"
```

지원하는 참조 형식:
- **로컬**: `file:../path/to/package`
- **Git**: `git+https://github.com/org/repo.git#v1.0.0`
- **레지스트리**: `@goondan-samples/coding-swarm@1.0.0`

## 리소스 참조

패키지에서 가져온 리소스는 직접 참조할 수 있습니다:

```yaml
# coding-swarm 패키지의 Tool 참조
tools:
  - { kind: Tool, name: file-toolkit }

# coding-swarm 패키지의 Model 참조
modelRef: { kind: Model, name: default-model }

# coding-swarm 패키지의 Agent 참조
agents:
  - { kind: Agent, name: planner }
  - { kind: Agent, name: coder }
```

## 커스터마이징

### 프롬프트 오버라이드

새로운 Agent를 정의하고 커스텀 프롬프트 사용:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: assistant
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }  # 패키지 모델 사용
  prompts:
    systemRef: "./prompts/custom.system.md"  # 로컬 프롬프트 사용
  tools:
    - { kind: Tool, name: file-toolkit }  # 패키지 도구 사용
```

### 에이전트 조합

패키지의 에이전트와 로컬 에이전트를 조합한 Swarm:

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: custom-swarm
spec:
  entrypoint: { kind: Agent, name: assistant }  # 로컬 에이전트
  agents:
    - { kind: Agent, name: assistant }  # 로컬
    - { kind: Agent, name: planner }    # 패키지
    - { kind: Agent, name: coder }      # 패키지
```

## 실행 방법

```bash
# 의존성 설치
pnpm install

# 개발 모드로 실행
pnpm dev

# 프로덕션 실행
pnpm start

# YAML 검증
pnpm validate
```

## Bundle Package 시스템 요약

### 패키지 구조
- `package.yaml`: 패키지 매니페스트 (Kind: Package)
- `spec.dependencies`: 의존하는 패키지 목록
- `spec.resources`: export할 YAML 파일 목록
- `spec.dist`: 배포할 폴더

### 의존성 해석
1. `dependencies`를 재귀적으로 해석
2. 의존성 순서대로 리소스 로드
3. 동일 Kind/name은 후순위가 덮어씀 (정책에 따라)

### 이름 충돌 해결
이름이 충돌할 경우 `package`를 지정하여 명확히 참조:

```yaml
tools:
  - toolRef: Tool/fileRead
  - package: "@goondan-samples/coding-swarm@1.0.0"
    toolRef: Tool/fileRead
```
