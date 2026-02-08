# Sample 1: Coding Swarm (Bundle Package)

코딩 에이전트 스웜 패키지입니다. Planner, Coder, Reviewer 세 에이전트가 협력하여 코딩 작업을 수행합니다.

> **Bundle Package**: 이 샘플은 Goondan Bundle Package로 배포 가능합니다. 다른 프로젝트에서 의존성으로 사용할 수 있습니다.

## 디렉토리 구조

```
sample-1-coding-swarm/
├── package.yaml          # Bundle Package 매니페스트 (Kind: Package)
├── goondan.yaml          # 직접 실행용 Bundle 정의 (개발/테스트용)
├── prompts/              # 소스 프롬프트
│   ├── planner.system.md
│   ├── coder.system.md
│   └── reviewer.system.md
├── tools/                # 소스 코드
│   ├── file/index.ts
│   └── delegate/index.ts
├── dist/                 # 배포 산출물 (package.yaml.spec.dist)
│   ├── model.yaml
│   ├── swarm.yaml
│   ├── tools/
│   │   ├── file/
│   │   │   ├── tool.yaml
│   │   │   └── index.ts
│   │   └── delegate/
│   │       ├── tool.yaml
│   │       └── index.ts
│   ├── agents/
│   │   ├── planner.yaml
│   │   ├── coder.yaml
│   │   └── reviewer.yaml
│   └── prompts/
│       ├── planner.system.md
│       ├── coder.system.md
│       └── reviewer.system.md
├── package.json          # npm 패키지 설정
├── tsconfig.json         # TypeScript 설정
├── README.md
└── AGENTS.md             # 이 파일
```

## Package 구성

### package.yaml
Bundle Package 매니페스트로, 다음을 정의합니다:
- `metadata.name`: 패키지 이름 (coding-swarm)
- `metadata.version`: 패키지 버전 (1.0.0)
- `spec.dependencies`: 의존하는 다른 패키지 (`@goondan/base` 포함)
- `spec.resources`: export할 리소스 YAML 목록
- `spec.dist`: tarball에 포함될 폴더

### 사용 방법
```yaml
# 다른 프로젝트의 package.yaml에서 참조
spec:
  dependencies:
    - "file:../sample-1-coding-swarm"  # 로컬 참조
    - "@goondan-samples/coding-swarm@1.0.0"  # 레지스트리 참조
```

## 리소스 정의

### Model
- `default-model`: Claude Sonnet 4.5 모델

### Tool
- `file-toolkit`: 파일 읽기/쓰기/목록 도구
  - `file.read`: 파일 내용 읽기
  - `file.write`: 파일 생성/수정
  - `file.list`: 디렉토리 목록 조회
- `delegate-tool`: 에이전트 간 작업 위임 도구
  - `agent.delegate`: 다른 에이전트에게 작업 위임

### Agent
- `planner`: 작업 계획 및 조율 (진입점)
- `coder`: 코드 작성 및 수정
- `reviewer`: 코드 리뷰 및 품질 검증

### Swarm
- `coding-swarm`: 세 에이전트로 구성된 스웜

### Connector
- `Connection`은 `@goondan/base`의 `Connector/cli`를 참조

## 참조 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/docs/specs/resources.md` - 리소스 정의 스펙
- `/docs/specs/tool.md` - Tool 시스템 스펙

## 수정 시 주의사항
1. goondan.yaml 수정 시 스펙 문서 준수 여부 확인
2. 시스템 프롬프트 수정 시 에이전트 역할 일관성 유지
3. Tool 추가 시 exports 정의와 실제 구현 일치 확인
