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
      run.ts          # gdn run 명령어 구현 (Swarm 실행, 대화형 모드)
      validate.ts     # gdn validate 명령어 구현 (Bundle 검증)
      package/        # gdn package 명령어 그룹 (AGENTS.md 참조)
        index.ts      # 패키지 명령어 그룹 등록
        install.ts    # gdn package install
        add.ts        # gdn package add
        remove.ts     # gdn package remove
        update.ts     # gdn package update
        list.ts       # gdn package list
        publish.ts    # gdn package publish
        login.ts      # gdn package login
        logout.ts     # gdn package logout
        pack.ts       # gdn package pack
        info.ts       # gdn package info
        cache.ts      # gdn package cache (info, clean)
      instance/       # gdn instance 명령어 그룹 (AGENTS.md 참조)
        index.ts      # 인스턴스 명령어 그룹 등록
        list.ts       # gdn instance list
        inspect.ts    # gdn instance inspect
        delete.ts     # gdn instance delete
        resume.ts     # gdn instance resume
      logs.ts         # gdn logs - 로그 조회 (JSONL 파싱, 필터링, 실시간 스트리밍)
      config.ts       # gdn config get/set/list/delete/path (설정 관리)
      completion.ts   # gdn completion - 쉘 자동완성 (bash/zsh/fish/powershell)
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
