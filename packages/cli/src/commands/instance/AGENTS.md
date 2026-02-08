# Instance Commands

이 디렉터리는 `gdn instance` 명령어 그룹의 하위 명령어들을 구현한다.

## 파일 목록

| 파일 | 명령어 | 설명 |
|------|--------|------|
| `index.ts` | `gdn instance` | 인스턴스 명령어 그룹 (하위 명령어 등록, utils re-export) |
| `utils.ts` | - | 공유 유틸리티 (type guards, path/JSONL/formatting 함수) |
| `list.ts` | `gdn instance list` | 인스턴스 목록 조회 (`--json`, `--status` 필터 지원) |
| `inspect.ts` | `gdn instance inspect <id>` | 인스턴스 상세 정보 조회 (`--json` 출력 지원) |
| `pause.ts` | `gdn instance pause <id>` | 인스턴스 일시 중지 (`--force` 즉시 중지) |
| `resume.ts` | `gdn instance resume <id>` | 저장된 인스턴스 재개 (stub) |
| `terminate.ts` | `gdn instance terminate <id>` | 인스턴스 종료 (`--force`, `--reason`) |
| `delete.ts` | `gdn instance delete <id>` | 인스턴스 상태 삭제 |

## 구현 상태

### 구현된 기능
- 인스턴스 목록 조회 (`list`)
  - `~/.goondan/instances/<workspaceId>/` 디렉터리 스캔
  - Swarm 이름으로 필터링 (`--swarm`)
  - 출력 개수 제한 (`--limit`)
  - 전체 워크스페이스 조회 (`--all`)
  - JSON 출력 (`--json`)
- 인스턴스 상세 정보 조회 (`inspect`)
  - 에이전트별 Turn/Message 카운트
  - 마지막 활성 시간
  - Active SwarmBundleRef 표시
  - JSON 출력 (`--json`)
- 인스턴스 삭제 (`delete`)
  - 확인 프롬프트 (--force로 스킵 가능)
  - 디렉터리 재귀 삭제
  - 빈 워크스페이스 디렉터리 정리
- **인스턴스 상태 저장** (`gdn run` 연동)
  - `gdn run` 실행 시 WorkspaceManager를 통해 이벤트 로그 자동 생성
  - Swarm lifecycle 이벤트: swarm.created, agent.created, swarm.started, swarm.stopped
  - Agent turn 이벤트: turn.started, turn.completed, turn.error
  - 커넥터 모드(Telegram 등)에서도 이벤트 로깅 지원

- 인스턴스 일시 중지 (`pause`)
  - `--force` 옵션으로 진행 중 Turn 즉시 중지
  - 확인 후 paused 상태로 전환
- 인스턴스 종료 (`terminate`)
  - 확인 프롬프트 (`--force`로 스킵 가능)
  - `--reason` 옵션으로 종료 사유 기록
  - terminated 상태로 전환
- 인스턴스 목록 상태 필터 (`list --status`)
  - `running`, `paused`, `terminated` 상태 필터링

### 미구현 기능 (TODO)
- `pause` 명령어의 실제 런타임 신호 전달
- `terminate` 명령어의 실제 런타임 중지 로직
- `resume` 명령어의 실제 인스턴스 재개 기능
  - SwarmBundle 로딩
  - 상태 복원
  - 런타임 재시작

## 아키텍처: 공유 유틸리티 (utils.ts)

`utils.ts`는 4개 하위 명령어에서 중복되던 함수를 통합한 모듈이다.

### Core 모듈 재활용
- `resolveGoondanHome` → `getGoondanHomeSync` / `getGoondanHome`
- `generateWorkspaceId` → re-export

### Type Guards
- `isSwarmEventRecord(value)` → `SwarmEventRecord` 타입 가드
- `isAgentEventRecord(value)` → `AgentEventRecord` 타입 가드

### 유틸리티 함수
- `findInstancePath(root, id)` → 인스턴스 디렉터리 검색 (현재 workspace 우선)
- `readJsonlFile<T>(path, guard)` → JSONL 파싱 + 타입 가드 필터링
- `countJsonlLines(path)` → JSONL 라인 수 카운트
- `formatDate(date)` → `YYYY-MM-DD HH:mm:ss` 포맷
- `formatStatus(status)` → chalk 색상 적용
- `determineInstanceStatus(event)` → 마지막 이벤트 기반 상태 판단
- `countTurns(instancePath)` → agent events에서 turn.completed 카운트
- `getInstanceInfo(path, id, wsId)` → 인스턴스 요약 정보
- `getInstanceBasicInfo(path)` → 기본 정보 (swarmName, instanceKey, agentCount)

## 관련 스펙

- `/docs/specs/cli.md` - Section 7 (gdn instance)
- `/docs/specs/workspace.md` - Instance State Root 레이아웃

## 인스턴스 상태 경로

인스턴스 상태는 다음 경로에 저장된다:

```
~/.goondan/instances/<workspaceId>/<instanceId>/
├── metadata.json              # 인스턴스 상태 메타데이터
├── swarm/
│   └── events/
│       └── events.jsonl       # Swarm 이벤트 로그
├── agents/
│   └── <agentName>/
│       ├── messages/
│       │   ├── base.jsonl     # Message base 스냅샷 로그
│       │   └── events.jsonl   # Turn 메시지 이벤트 로그
│       └── events/
│           └── events.jsonl   # Agent 이벤트 로그
├── extensions/                # Extension 상태 영속화
│   ├── _shared.json           # instance.shared 공유 상태
│   └── <extensionName>/
│       └── state.json         # Extension별 격리 상태
└── metrics/
    └── turns.jsonl            # Turn/Step 메트릭 로그
```

## 데이터 플로우

```
gdn run → WorkspaceManager.create()
        → initializeInstanceState(instanceId, [agents])
        → SwarmEventLogger.log(swarm.created / agent.created / swarm.started)
        → 각 Turn 실행:
            → AgentEventLogger.log(turn.started)
            → TurnRunner.run()
            → AgentEventLogger.log(turn.completed / turn.error)
        → SwarmEventLogger.log(swarm.stopped)

gdn instance list → readJsonlFile(swarmEventsPath, isSwarmEventRecord)
gdn instance inspect → readJsonlFile + getAgentInfo
gdn instance delete → deleteDirectory(instancePath)
```

## 작업 시 주의사항

1. 모든 import에 `.js` 확장자 필수 (ESM)
2. 타입 단언(`as`) 금지 - `isObjectWithKey` 등 타입 가드 사용
3. 대화형 프롬프트는 `--quiet` 모드에서 비활성화 고려
4. 에러 처리 시 `process.exitCode` 설정 (throw 대신)
5. 새 명령어 추가 시 `docs/specs/cli.md` 업데이트 필요
6. Core의 workspace 함수를 가급적 재활용할 것 (중복 구현 금지)
