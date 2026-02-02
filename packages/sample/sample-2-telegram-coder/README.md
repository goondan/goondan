# Sample 2: Telegram Coder Agent

텔레그램 봇을 통해 코딩 작업을 수행하는 AI 에이전트 샘플입니다.

## 개요

이 샘플은 다음을 보여줍니다:

- **Telegram Connector**: 텔레그램 봇 API와 연동하는 커넥터 구현
- **코딩 도구**: 파일 읽기/쓰기, 코드 실행, 검색, 분석 도구
- **Git 도구**: 버전 관리를 위한 Git 명령 도구
- **실용적 에이전트**: 실제 개발 작업을 수행할 수 있는 에이전트 구성

## 사전 요구사항

1. **Telegram Bot Token**
   - [@BotFather](https://t.me/botfather)에서 봇을 생성하고 토큰을 발급받습니다
   - 환경변수로 설정: `export TELEGRAM_BOT_TOKEN="your-token"`

2. **LLM API Key**
   - Anthropic API Key: `export ANTHROPIC_API_KEY="your-key"`

## 설치 및 실행

```bash
# 의존성 설치 (루트에서)
pnpm install

# 빌드
pnpm build

# 실행
pnpm run
```

## 프로젝트 구조

```
sample-2-telegram-coder/
├── src/
│   ├── connectors/
│   │   └── telegram/
│   │       ├── index.ts       # Telegram 커넥터 구현
│   │       └── connector.yaml # 커넥터 정의
│   └── tools/
│       ├── code/
│       │   ├── index.ts       # 코딩 도구 구현
│       │   └── tool.yaml      # 도구 정의
│       └── git/
│           ├── index.ts       # Git 도구 구현
│           └── tool.yaml      # 도구 정의
├── prompts/
│   └── coder.system.md        # 시스템 프롬프트
├── goondan.yaml               # 메인 구성
├── bundle.yaml                # 번들 매니페스트
└── package.json
```

## 제공되는 도구

### 코드 도구 (code.*)

| 도구 | 설명 |
|------|------|
| `code.read` | 파일 읽기 (줄 번호 포함) |
| `code.write` | 파일 생성/수정 |
| `code.execute` | 코드 실행 (JS, TS, Python, Bash) |
| `code.search` | 코드 패턴 검색 |
| `code.analyze` | 코드 구조/의존성 분석 |

### Git 도구 (git.*)

| 도구 | 설명 |
|------|------|
| `git.status` | 저장소 상태 확인 |
| `git.diff` | 변경 사항 확인 |
| `git.log` | 커밋 로그 조회 |
| `git.commit` | 커밋 생성 |
| `git.branch` | 브랜치 관리 |

## 사용 예시

텔레그램 봇에게 메시지를 보내세요:

```
/code src/utils/helper.ts 파일을 만들어줘. 문자열 유틸리티 함수들을 포함해야 해.
```

```
현재 디렉터리의 구조를 분석해줘
```

```
git 상태를 확인하고 변경 사항을 커밋해줘
```

## Telegram Connector 상세

### 연결 방식

1. **Long Polling (기본)**: 서버 없이 봇 토큰만으로 동작
2. **Webhook**: 프로덕션 환경에서 권장 (HTTPS 필요)

### 메시지 라우팅

```yaml
ingress:
  # 명령어 기반 라우팅
  - match:
      command: "/code"
    route:
      swarmRef: { kind: Swarm, name: default }

  # 기본 라우팅 (모든 메시지)
  - route:
      swarmRef: { kind: Swarm, name: default }
```

## 보안 고려사항

- `code.execute`는 샌드박스 환경에서 실행됩니다
- 작업 디렉터리(`GOONDAN_WORK_DIR`) 외부 파일 접근이 제한됩니다
- 민감한 정보(API 키 등)는 환경변수로 관리하세요

## 확장 포인트

1. **도구 추가**: `src/tools/`에 새 도구 디렉터리 생성
2. **프롬프트 수정**: `prompts/coder.system.md` 편집
3. **Extension 추가**: `goondan.yaml`의 `extensions` 섹션에 추가

## 문제 해결

### 봇이 응답하지 않음
- `TELEGRAM_BOT_TOKEN` 환경변수 확인
- 봇이 그룹에서 사용되는 경우 Privacy Mode 확인

### 코드 실행 실패
- `GOONDAN_WORK_DIR` 환경변수로 작업 디렉터리 지정
- 실행 권한 및 런타임(node, python3) 설치 확인
