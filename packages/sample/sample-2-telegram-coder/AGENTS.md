# Sample 2: Telegram Coder Agent

텔레그램 봇 기반 코딩 에이전트 샘플입니다.

## 디렉터리 구조

```
sample-2-telegram-coder/
├── src/
│   ├── connectors/telegram/   # Telegram 봇 커넥터
│   └── tools/
│       ├── code/              # 코딩 도구 (read, write, execute, search, analyze)
│       └── git/               # Git 도구 (status, diff, log, commit, branch)
├── prompts/
│   └── coder.system.md        # 시스템 프롬프트
├── goondan.yaml               # 메인 구성 (Model, Agent, Swarm, Connector)
├── bundle.yaml                # 번들 매니페스트
└── package.json
```

## 핵심 파일

### src/connectors/telegram/index.ts
- `createTelegramConnector`: Telegram Bot API 연동 커넥터
- Long Polling 및 Webhook 지원
- `handleEvent`: 수신 메시지를 Runtime으로 라우팅
- `send`: 응답 메시지를 텔레그램으로 송신

### src/tools/code/index.ts
- `code.read`: 파일 읽기 (줄 번호 포함, 범위 지정 가능)
- `code.write`: 파일 생성/수정 (디렉터리 자동 생성)
- `code.execute`: 코드 실행 (JS, TS, Python, Bash 지원)
- `code.search`: grep 기반 코드 검색
- `code.analyze`: 코드 구조/의존성 분석

### src/tools/git/index.ts
- `git.status`: 브랜치, 스테이지, 수정, 미추적 파일 상태
- `git.diff`: 변경 사항 (staged 옵션, 파일별 상세)
- `git.log`: 커밋 로그 (oneline, 브랜치 필터)
- `git.commit`: 파일 스테이징 + 커밋 생성
- `git.branch`: 브랜치 목록/생성/체크아웃/삭제

### goondan.yaml
- Model: anthropic claude-sonnet-4-5
- Agent: coder (code + git 도구, compaction 확장)
- Swarm: default (maxStepsPerTurn: 16)
- Connector: telegram (Long Polling 기본)

## 작업 시 참고사항

1. **Telegram 커넥터 수정 시**
   - Bot API 호환성 유지
   - Long Polling과 Webhook 모드 모두 테스트
   - 메시지 포맷팅(Markdown) 처리 확인

2. **코드 도구 수정 시**
   - 경로 보안 검증(validatePath) 유지
   - 작업 디렉터리(GOONDAN_WORK_DIR) 기준 동작
   - 실행 타임아웃 및 버퍼 제한 확인

3. **Git 도구 수정 시**
   - 작업 디렉터리에서 git 명령 실행
   - 에러 메시지의 사용자 친화성
   - 커밋 메시지 이스케이프 처리

4. **프롬프트 수정 시**
   - 도구 사용 가이드라인 포함
   - 보안 제한사항 명시
   - 응답 형식 가이드 유지

## 빌드 및 테스트

```bash
# 빌드
pnpm build

# 타입 체크
pnpm typecheck

# 실행 (TELEGRAM_BOT_TOKEN 필요)
pnpm run
```
