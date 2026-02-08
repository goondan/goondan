# @goondan/cli - CLI Package

이 패키지는 Goondan Agent Swarm Orchestrator의 공식 CLI 도구 `gdn`을 구현한다.

## 아키텍처

### 현재 구현된 파일
```
packages/cli/
  src/
    index.ts          # 퍼블릭 API 진입점 (exports: createProgram, run, VERSION, commands, types)
    bin.ts            # 실행 파일 진입점 (shebang 포함, bin.js로 빌드됨)
    cli.ts            # Commander.js 기반 메인 프로그램 설정 (전체 명령어 등록)
    types.ts          # CLI 타입 정의 (GlobalOptions, CliConfig, ExitCode)
    commands/
      index.ts        # 명령어 모듈 export
      init.ts         # gdn init 명령어 구현
      run.ts          # gdn run 명령어 구현 (Swarm 실행, Connection 감지→커넥터 디스패치, 대화형 모드 폴백, SwarmBundleRef 전환/세대 관리, 자동 의존성 설치, processConnectorTurn 커넥터 콜백 export, WorkspaceManager 기반 인스턴스 이벤트 로깅)
      validate.ts     # gdn validate 명령어 구현 (Bundle 검증)
      package/        # gdn package 명령어 그룹 (AGENTS.md 참조)
        index.ts      # 패키지 명령어 그룹 등록
        install.ts    # gdn package install (file: 프로토콜 로컬 의존성 지원)
        add.ts        # gdn package add
        remove.ts     # gdn package remove
        update.ts     # gdn package update
        list.ts       # gdn package list
        publish.ts    # gdn package publish
        unpublish.ts  # gdn package unpublish (패키지 버전 비게시)
        deprecate.ts  # gdn package deprecate (패키지 폐기 표시)
        login.ts      # gdn package login
        logout.ts     # gdn package logout
        pack.ts       # gdn package pack
        info.ts       # gdn package info
        cache.ts      # gdn package cache (info, clean)
      instance/       # gdn instance 명령어 그룹 (AGENTS.md 참조)
        index.ts      # 인스턴스 명령어 그룹 등록 (utils re-export 포함)
        utils.ts      # 공유 유틸리티 (type guards, path/JSONL/formatting, Core 재활용)
        list.ts       # gdn instance list (--json, --status 필터 지원)
        inspect.ts    # gdn instance inspect (--json 지원)
        pause.ts      # gdn instance pause (인스턴스 일시 중지)
        resume.ts     # gdn instance resume
        terminate.ts  # gdn instance terminate (인스턴스 종료)
        delete.ts     # gdn instance delete
      logs.ts         # gdn logs - 로그 조회 (JSONL 파싱, 필터링, 실시간 스트리밍)
      config.ts       # gdn config get/set/list/delete/path (설정 관리)
      completion.ts   # gdn completion - 쉘 자동완성 (bash/zsh/fish/powershell)
      doctor.ts       # gdn doctor - 환경 진단 (Node.js, pnpm, API 키, 의존성 확인)
    runtime/            # gdn run 런타임 구현체 (AGENTS.md 참조)
      index.ts          # 모든 구현체 re-export
      types.ts          # 공유 타입 (RuntimeContext에 WorkspaceManager/SwarmEventLogger/instanceId 포함, RevisionState, ProcessConnectorTurnResult)
      bundle-loader-impl.ts  # BundleLoadResult 기반 BundleLoader 구현
      llm-caller-impl.ts     # AI SDK 기반 LLM 호출 구현 (anthropic/openai/google)
      tool-executor-impl.ts  # Tool entry 모듈 동적 로드/실행 구현 (ref 세대별 격리/정리 포함)
      connector-runner.ts    # Connection 감지, ConnectorRunner 인터페이스, 공유 헬퍼
      telegram-connector.ts  # Telegram Bot API 롱 폴링 커넥터
    utils/
      logger.ts       # 로깅 유틸리티 (verbose/quiet/json/color 지원)
      config.ts       # 설정 파일 로딩 (~/.goondanrc, 환경변수 병합)
      prompt.ts       # 대화형 프롬프트 (prompts 패키지 래퍼)
```

## 핵심 원칙

1. **ESM 전용**: `"type": "module"` 사용, 모든 import에 `.js` 확장자 필수
2. **NodeNext 모듈**: TypeScript의 NodeNext 모듈 해상도 사용
3. **타입 안전성**: 타입 단언(`as`) 금지, 정확한 타입 정의 사용
4. **@goondan/core 의존**: 런타임/Bundle/Workspace 기능은 core 패키지 사용

## 의존성

- `@goondan/core`: Goondan 코어 기능 (Bundle, Runtime, Workspace 등)
- `ai`: Vercel AI SDK (LLM 호출, generateText, tool 정의)
- `@ai-sdk/anthropic`: Anthropic provider (Claude 모델)
- `@ai-sdk/openai`: OpenAI provider (GPT 모델)
- `@ai-sdk/google`: Google provider (Gemini 모델)
- `commander`: CLI 프레임워크
- `chalk`: 터미널 색상 출력
- `ora`: 스피너/로딩 표시
- `prompts`: 대화형 프롬프트
- `yaml`: YAML 파싱/직렬화

## 명령어 스펙

CLI 명령어의 상세 스펙은 `docs/specs/cli.md`를 참조할 것.

## 작업 시 주의사항

1. 새 명령어 추가 시 `docs/specs/cli.md`에 명세를 먼저 추가할 것
2. 출력 형식은 `--json` 옵션 지원을 고려하여 구조화할 것
3. 에러 처리 시 적절한 종료 코드(`ExitCode`) 사용
4. 대화형 기능은 `--quiet` 모드에서 비활성화되도록 구현
5. 파일 경로는 항상 절대 경로로 정규화하여 처리

## 테스트

- 단위 테스트: `vitest`로 각 명령어 로직 테스트
- 통합 테스트: 실제 CLI 실행 시나리오 테스트
- 테스트 파일 위치: `__tests__/` 디렉터리
