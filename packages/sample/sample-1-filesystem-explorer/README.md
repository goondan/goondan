# Sample 1: CLI 파일시스템 탐색 에이전트

터미널에서 자연어로 파일시스템을 탐색할 수 있는 CLI 에이전트입니다.

## 개요

이 샘플은 Goondan의 가장 기본적인 사용 패턴을 보여줍니다:

- **CLI Connector**: 터미널 입출력을 처리하는 커넥터
- **Custom Tool**: 파일시스템 탐색을 위한 도구 개발
- **Base Bundle 활용**: file.read, compaction 등 기본 제공 기능 사용

## 실행 방법

### 1. 의존성 설치

```bash
cd packages/sample/sample-1-filesystem-explorer
pnpm install
```

### 2. 빌드

```bash
pnpm build
```

### 3. 실행

```bash
# API 키 설정
export ANTHROPIC_API_KEY="sk-ant-..."

# 에이전트 실행
pnpm run
```

### 4. 대화 시작

```
> 현재 디렉터리의 파일 목록을 보여줘
[에이전트가 fs.list 도구를 사용하여 응답]

> src 폴더의 트리 구조를 보여줘
[에이전트가 fs.tree 도구를 사용하여 응답]

> *.ts 파일을 찾아줘
[에이전트가 fs.search 도구를 사용하여 응답]

> package.json 파일 내용을 보여줘
[에이전트가 file.read 도구를 사용하여 응답]

> :exit
[종료]
```

## 제공되는 도구

### 이 샘플에서 제공

| 도구 | 설명 |
|------|------|
| `fs.list` | 디렉터리 내용 목록 조회 |
| `fs.stat` | 파일/디렉터리 상세 정보 |
| `fs.tree` | 트리 구조 시각화 |
| `fs.search` | 파일명 패턴 검색 |

### Base 번들에서 사용

| 도구 | 설명 |
|------|------|
| `file.read` | 파일 내용 읽기 |
| `toolSearch.find` | 동적 도구 검색 |

## 프로젝트 구조

```
sample-1-filesystem-explorer/
├── bundle.yaml           # 번들 매니페스트
├── goondan.yaml          # Goondan 설정 (Agent, Swarm, Connector)
├── package.json          # NPM 패키지 설정
├── tsconfig.json         # TypeScript 설정
├── prompts/
│   └── explorer.system.md    # 시스템 프롬프트
├── src/
│   └── tools/
│       └── filesystem/
│           ├── index.ts      # 도구 핸들러 구현
│           └── tool.yaml     # 도구 정의
└── dist/                     # 빌드 산출물
```

## 학습 포인트

### 1. Tool 개발 패턴

```typescript
// src/tools/filesystem/index.ts
export const handlers: Record<string, ToolHandler> = {
  'fs.list': async (_ctx, input) => {
    // 입력 처리
    const payload = input as Partial<FsListInput>;

    // 비즈니스 로직
    const entries = await fs.readdir(dirPath);

    // 결과 반환 (JsonObject)
    return { path: dirPath, items: [...] };
  },
};
```

### 2. Tool YAML 정의

```yaml
# tool.yaml
exports:
  - name: fs.list
    description: "디렉터리 목록 조회"
    parameters:
      type: object
      properties:
        path:
          type: string
          description: "경로"
```

### 3. Agent 구성

```yaml
# goondan.yaml
kind: Agent
spec:
  modelConfig:
    modelRef: { kind: Model, name: default-model }
  prompts:
    systemRef: "./prompts/explorer.system.md"
  tools:
    - { kind: Tool, name: filesystem }  # 직접 개발한 도구
    - { kind: Tool, name: fileRead }    # base 번들 도구
```

### 4. Connector를 통한 I/O

```yaml
kind: Connector
spec:
  type: cli                     # CLI 타입
  ingress:
    - route:
        swarmRef: { kind: Swarm, name: default }
        inputFrom: "$.text"     # 입력 경로
```

## 확장 아이디어

- **파일 쓰기**: `fs.write` 도구 추가
- **Git 통합**: `git.status`, `git.log` 도구 추가
- **파일 비교**: `fs.diff` 도구 추가
- **북마크**: 자주 가는 경로 기억 기능

## 관련 문서

- [Goondan Guide](../../../GUIDE.md) - 전체 가이드
- [Tool 개발](../../../GUIDE.md#5-tool-개발) - 도구 개발 상세
- [Config 작성법](../../../GUIDE.md#4-config-작성법) - 설정 파일 작성
