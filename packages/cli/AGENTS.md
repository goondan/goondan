# @goondan/cli

`packages/cli`는 Goondan CLI(`gdn`) 구현 패키지입니다.

## 책임 범위

- 명령 파싱/라우팅 (`init`, `run`, `restart`, `validate`, `instance`, `logs`, `package`, `doctor`, `studio`)
- `init` 시 4종 템플릿(default, multi-agent, package, minimal) 기반 프로젝트 스캐폴딩 + git 초기화 (`goondan.yaml` 첫 문서 `kind: Package` 기본 생성, `--package` 옵션 미지원)
- `run` 시 detached runtime runner 기동 + startup handshake(ready/start_error)로 초기화 실패를 즉시 노출
- `run --watch` 시 bundle/리소스 YAML 및 Tool/Connector entry 변경 감지 후 replacement orchestrator 재기동
- runtime runner는 Connection별 Connector를 별도 child process로 실행하고 IPC(event/start/shutdown)로 연동
- runtime runner 모듈 경로는 `@goondan/runtime/runner` export의 `resolveRuntimeRunnerPath()`를 사용해 패키지 매니저 레이아웃(Bun/npm/pnpm)과 무관하게 해석
- Connection `config`/`secrets`는 `value`, `valueFrom.env`, `valueFrom.secretRef(Secret/<name>)`를 해석해 Connector context로 전달
- `run` 시 프로젝트 루트 기준으로 `.env`/`.env.local`/`--env-file`을 우선순위대로 로딩하고, 기존 시스템 env 값을 우선 유지
- runtime-runner는 Tool 결과의 재시작 신호(`restartRequested`, `runtimeRestart`, `__goondanRestart`)를 감지하면 replacement orchestrator를 기동하고 active runtime pid를 갱신한 뒤 self-shutdown 한다
- runtime runner가 BundleLoader 기반으로 선택된 Swarm의 Connection/ingress를 해석하고 Connector entry 실행, ConnectorEvent 라우팅(ingress `route.instanceKey`/`route.instanceKeyProperty`/`route.instanceKeyPrefix` 기반 instanceKey 오버라이드 포함), Agent LLM 실행(Anthropic), Tool 실행, Agent별 `spec.extensions`를 instance 단위로 로드해 turn/step/toolCall middleware 체인을 실행, `ToolContext.runtime`(agents request/send/spawn/list/catalog) 연결, inbound context 블록은 최소 필드(source/event/instanceKey/properties/metadata)만 주입, `Agent.spec.requiredTools` 기반 필수 Tool 호출 강제를 처리하며 Turn 종료 시 `base.jsonl`에 CoreMessage content(assistant tool_use/user tool_result 포함)를 보존한다
- `run`은 `Swarm.spec.instanceKey ?? Swarm.metadata.name` 규칙으로 instanceKey를 결정하고 사용자 지정 `--instance-key` 옵션을 노출하지 않으며, 동일 키 active runtime이 있으면 재사용(resume)한다
- `run`/`runtime-runner`는 local `kind: Package` + `metadata.name` 문서를 필수로 요구한다
- `run` 시 프로세스 stdout/stderr를 `~/.goondan/runtime/logs/<instanceKey>/` 파일로 기록
- `instance list` 시 `runtime/active.json`의 active orchestrator + 동일 state-root의 managed runtime-runner를 함께 노출하고, Agent 대화 인스턴스(`workspaces/*/instances/*`)와 legacy `instances/*`는 표시하지 않음
- `instance restart` 시 기존 active pid 종료를 확인한 뒤 최신 runner 바이너리로 재기동하고 active pid를 교체(Connector 포트 충돌 방지)
- `instance delete` 시 active 여부와 무관하게 동일 state-root의 managed runtime-runner PID 종료 + 다중 레이아웃 인스턴스 경로(`workspaces/*/instances/*`, `instances/*/*`)를 함께 정리
- `instance` (bare) 시 인터랙티브 TUI 모드 — non-TTY/`--json` 환경에서는 `instance list`로 자동 폴백, TTY에서는 `r` 키로 선택 인스턴스 재시작 + started 시각 확인
- active pid 종료 전 `runtime-runner + instance-key` 일치 여부를 검증해 오탐 종료를 방지
- `logs` 명령으로 인스턴스/프로세스별 로그 파일 tail 조회 지원
- `studio` 명령으로 Studio 서버 실행(`--host`/`--port`/`--open`/`--no-open`) + `/api/instances`, `/api/instances/:key/visualization` 제공, 시각화 입력으로 `base.jsonl`/`events.jsonl`/`runtime-events.jsonl` 및 runtime 로그를 함께 사용하며 runtime key 선택 시 해당 workspace 하위 인스턴스를 집계하고, `message.metadata.__goondanInbound`를 복원해 agent/connector 원발신자를 flow/graph 간선으로 반영한다
- Flow 모드는 connector/agent 레인 중심으로 렌더링하며 Tool 호출(`tool.called/completed/failed`)은 별도 레인이 아니라 해당 agent 레인의 인라인 step으로 표시하고 agent 간 inbound 메시지의 왕복 간선을 표시한다
- CLI 빌드 시 `dist/bin.js` 실행 권한 유지(`chmod +x`)
- 출력 포맷(구조화 오류, suggestion/helpUrl 포함)
- `validate`는 runtime BundleLoader 기반 fail-fast 검증(참조/Kind/Package 문서 위치 포함)을 수행
- 런타임/레지스트리/검증 계층과의 연동 인터페이스
- `package publish` 시 `pnpm pack` 기반 tarball 생성 및 레지스트리 publish payload 구성
- `package install` 시 tarball 다운로드/무결성 검증/압축 해제 및 lockfile 갱신
- `package update` 시 Package 의존성의 최신 resolve 버전 갱신 및 설치/lockfile 동기화
- CLI 단위 테스트(vitest)

## 파서 아키텍처 (Optique 기반)

- **`@optique/core`** + **`@optique/run`** 패키지 사용 (type-safe combinatorial CLI parser)
- `src/parser.ts`: Optique 파서 정의 + 타입 추론 (`gdnParser`, `GdnArgs`, `GdnCommand`)
  - 14개 action discriminated union: `init`, `run`, `restart`, `validate`, `instance.list`, `instance.restart`, `instance.delete`, `package.add`, `package.install`, `package.update`, `package.publish`, `doctor`, `logs`, `studio`
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
8. npm 공개 배포를 유지하려면 `package.json`의 `publishConfig.access = "public"`을 유지합니다.
