# @goondan-samples/coding-swarm

Goondan Bundle Package로 배포되는 코딩 에이전트 스웜입니다.

> **패키지로 사용**: 다른 프로젝트에서 이 패키지를 의존성으로 추가하여 사용할 수 있습니다.

## 설치

```bash
# pnpm
pnpm add @goondan-samples/coding-swarm

# npm
npm install @goondan-samples/coding-swarm

# yarn
yarn add @goondan-samples/coding-swarm
```

## 패키지 구조

```
@goondan-samples/coding-swarm/
├── goondan.yaml              # Package 매니페스트 + 리소스 정의
├── dist/                 # 배포되는 리소스
│   ├── model.yaml        # 기본 모델 정의
│   ├── swarm.yaml        # 스웜 정의
│   ├── tools/
│   │   ├── file/         # 파일 도구
│   │   │   ├── tool.yaml
│   │   │   └── index.js
│   │   └── delegate/     # 위임 도구
│   │       ├── tool.yaml
│   │       └── index.js
│   ├── agents/
│   │   ├── planner.yaml
│   │   ├── coder.yaml
│   │   └── reviewer.yaml
│   └── prompts/
│       ├── planner.system.md
│       ├── coder.system.md
│       └── reviewer.system.md
├── tools/                # 소스 코드
│   ├── file/index.ts
│   └── delegate/index.ts
├── prompts/              # 소스 프롬프트
└── package.json
```

## 에이전트 구성

### 1. Planner Agent (진입점)
- **역할**: 작업 계획 수립 및 조율
- **책임**:
  - 사용자 요청 분석
  - 작업 분해 및 계획 수립
  - Coder/Reviewer에게 작업 위임
  - 전체 진행 상황 관리

### 2. Coder Agent
- **역할**: 실제 코드 작성 및 수정
- **책임**:
  - 요청된 기능 구현
  - 코드 작성/수정
  - 버그 수정

### 3. Reviewer Agent
- **역할**: 코드 리뷰 및 품질 검증
- **책임**:
  - 코드 리뷰
  - 버그/문제점 식별
  - 개선 사항 제안

## 작업 흐름

```
User Request
    │
    ▼
┌─────────────┐
│   Planner   │ ◄── 진입점
└─────────────┘
    │
    ├──────────────────┐
    ▼                  ▼
┌─────────┐      ┌──────────┐
│  Coder  │ ◄──► │ Reviewer │
└─────────┘      └──────────┘
    │                  │
    └──────────────────┘
            │
            ▼
      Final Response
```

1. 사용자 요청이 Planner에게 전달됨
2. Planner가 작업을 분석하고 계획 수립
3. Planner가 Coder에게 코드 작성 요청
4. Coder가 코드를 작성하고 완료 보고
5. Planner가 Reviewer에게 리뷰 요청
6. Reviewer가 리뷰 결과 반환
7. 필요시 Coder에게 수정 요청 (반복)
8. 최종 결과를 사용자에게 보고

## 사용 가능한 도구

### file.read
파일 내용을 읽습니다.
```json
{
  "path": "src/index.ts"
}
```

### file.write
파일을 생성하거나 수정합니다.
```json
{
  "path": "src/utils.ts",
  "content": "export function hello() { ... }"
}
```

### file.list
디렉토리 내용을 조회합니다.
```json
{
  "path": "src",
  "recursive": true
}
```

### agent.delegate
다른 에이전트에게 작업을 위임합니다.
```json
{
  "agentName": "coder",
  "task": "utils.ts 파일에 formatDate 함수 구현",
  "context": "Date 객체를 'YYYY-MM-DD' 형식으로 변환"
}
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

## 예시 요청

```
"간단한 할일 관리 CLI 앱을 TypeScript로 만들어줘.
- 할일 추가/삭제/목록 기능
- JSON 파일로 저장
- 명령줄 인터페이스"
```

이 요청을 받으면:
1. Planner가 작업을 분해 (타입 정의, 저장 로직, CLI 인터페이스 등)
2. Coder가 각 부분을 구현
3. Reviewer가 코드 품질 검증
4. 필요시 수정 후 최종 결과 반환

## 리소스 정의 요약

| Kind | Name | 설명 |
|------|------|------|
| Model | default-model | Claude Sonnet 4.5 |
| Tool | file-toolkit | 파일 읽기/쓰기/목록 |
| Tool | delegate-tool | 에이전트 위임 |
| Agent | planner | 작업 계획/조율 |
| Agent | coder | 코드 작성 |
| Agent | reviewer | 코드 리뷰 |
| Swarm | coding-swarm | 에이전트 집합 |
| Connector | cli | CLI 인터페이스 |
