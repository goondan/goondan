# @goondan/cli

`packages/cli`는 Goondan CLI(`gdn`) 구현 패키지입니다.

## 책임 범위

- 명령 파싱/라우팅 (`init`, `run`, `restart`, `validate`, `instance`, `logs`, `package`, `doctor`)
- `init` 시 4종 템플릿(default, multi-agent, package, minimal) 기반 프로젝트 스캐폴딩 + git 초기화
- `run` 시 detached runtime runner 기동 + startup handshake(ready/start_error)로 초기화 실패를 즉시 노출
- runtime runner가 BundleLoader 기반으로 선택된 Swarm의 Connection/ingress를 해석하고 Connector entry 실행, ConnectorEvent 라우팅, Agent LLM 실행(Anthropic), Tool 실행, Telegram 응답 전송을 처리
- `run`에서 `--instance-key` 미지정 시 Project Root + Package 이름 기반 human-readable 해시 키를 사용하고, 동일 키 active runtime이 있으면 재사용(resume)한다
- `run` 시 프로세스 stdout/stderr를 `~/.goondan/runtime/logs/<instanceKey>/` 파일로 기록
- `instance list` 시 현재 레이아웃(`workspaces/*` + `runtime/active.json`)을 병합하고 legacy `instances/*`는 기본 조회에서 제외
- `instance delete` 시 active runtime(`runtime/active.json`) + 다중 레이아웃 인스턴스 경로(`workspaces/*/instances/*`, `instances/*/*`)를 함께 정리
- `instance` (bare) 시 인터랙티브 TUI 모드 — non-TTY/`--json` 환경에서는 `instance list`로 자동 폴백
- active pid 종료 전 `runtime-runner + instance-key` 일치 여부를 검증해 오탐 종료를 방지
- `logs` 명령으로 인스턴스/프로세스별 로그 파일 tail 조회 지원
- CLI 빌드 시 `dist/bin.js` 실행 권한 유지(`chmod +x`)
- 출력 포맷(구조화 오류, suggestion/helpUrl 포함)
- 런타임/레지스트리/검증 계층과의 연동 인터페이스
- `package publish` 시 `pnpm pack` 기반 tarball 생성 및 레지스트리 publish payload 구성
- `package install` 시 tarball 다운로드/무결성 검증/압축 해제 및 lockfile 갱신
- CLI 단위 테스트(vitest)

## 파서 아키텍처 (Optique 기반)

- **`@optique/core`** + **`@optique/run`** 패키지 사용 (type-safe combinatorial CLI parser)
- `src/parser.ts`: Optique 파서 정의 + 타입 추론 (`gdnParser`, `GdnArgs`, `GdnCommand`)
  - 11개 action discriminated union: `init`, `run`, `restart`, `validate`, `instance.list`, `instance.delete`, `package.add`, `package.install`, `package.publish`, `doctor`, `logs`
  - `parseArgv(argv)`: 테스트용 래퍼 (no process.exit, `Result<GdnArgs>` 반환)
  - `formatParseError(result)`: 파싱 에러 메시지 변환
- `src/bin.ts`: `run()` (from `@optique/run`) 사용 — `--help`, `--version`, completion, 에러 포맷 자동 처리
  - bare `instance` 감지 → `run()` 호출 전에 인터랙티브 모드로 분기 (Optique `or()`는 zero-consumed 브랜치 불허)
- `src/router.ts`: `executeCli(argv, deps)` — `parseArgv()` + `switch(cmd.action)` exhaustive dispatch
  - 파싱 실패 시 bare `instance` 감지 → `handleInstanceInteractive()` 폴백
- `src/commands/*.ts`: 각 핸들러가 typed args 객체 직접 접근 (수동 추출 함수 불필요)

### 인터랙티브 모드 (`instance.interactive`)

- `src/commands/instance-interactive.ts`: ANSI escape + raw stdin 기반 TUI 핸들러
- **TerminalIO 래퍼 패턴**: `CliDependencies.terminal` — stdin/stdout를 직접 노출하지 않고 고수준 인터페이스로 래핑
  - `setRawMode`, `onData`, `offData`, `resume`, `pause`, `write` 메서드
  - `stdinIsTTY`, `stdoutIsTTY`, `columns` 읽기 전용 속성
- Non-TTY/`--json` 환경에서는 `handleInstanceList()`로 자동 위임 (graceful degradation)
- 인스턴스 0개 → 메시지 출력 후 즉시 종료 (TUI 진입 안 함)
- 전체 삭제 → "모든 인스턴스가 삭제되었습니다." 출력 후 자동 종료
- 키 매핑: ↑↓(이동), Del(삭제), Enter(나가기 항목), q/Esc/Ctrl+C(종료)
- 테스트: `test/helpers.ts`의 `createMockTerminal()`, `simulateKey()` 유틸리티 사용

### Optique 제약 사항

- `or()` 내에서 `constant()`만으로는 폴백 브랜치를 만들 수 없음 — `or()`는 `consumed.length > 0`인 성공만 인정
- 따라서 bare `instance`는 파싱 레벨이 아닌 라우터/bin 레벨에서 감지하여 처리

### 삭제된 파일
- `src/help.ts`: Optique `run()`이 help 자동 생성
- `src/options.ts`: Optique 타입 추론으로 옵션 추출 함수 불필요
- `src/commands/context.ts`: `CommandContext`/`CommandHandler` 타입 불필요

## 구현 규칙

1. CLI 파싱은 `@optique/core` + `@optique/run` 기반으로 구현합니다.
2. 명령 입출력은 테스트 가능하도록 의존성 주입 구조(`CliDependencies`)를 유지합니다.
3. 오류는 가능한 한 구조화(`code`, `message`, `suggestion`, `helpUrl`)하여 출력합니다.
4. 백그라운드 프로세스 시작 실패(즉시 종료/타임아웃)는 성공으로 처리하지 않고 `CONFIG_ERROR`로 표면화합니다.
5. 타입 단언(`as`, `as unknown as`) 없이 타입 가드와 명시 타입으로 구현합니다.
6. `docs/specs/cli.md`, `docs/specs/bundle_package.md`, `docs/specs/help.md` 변경 시 구현 영향도를 즉시 반영합니다.
7. 터미널 I/O는 `TerminalIO` 인터페이스를 통해 의존성 주입하여 테스트 가능하게 유지합니다.
