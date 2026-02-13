# Workspace 디렉터리

이 디렉터리는 Goondan Runtime의 워크스페이스 및 스토리지 계층을 구현합니다.

## 아키텍처 개요

Workspace는 **2-root** 구조를 구현합니다:
- **Project Root**: 사용자 프로젝트 정의 (`goondan.yaml` + 코드)
- **System Root** (`~/.goondan/`): 실행 상태, 패키지, CLI 설정

### 핵심 설계 원칙

1. **정의와 상태의 물리적 분리**: Git 버전 관리와 실행 상태를 분리
2. **결정론적 매핑**: Project Root + Package 이름 → workspaceId
3. **이벤트 소싱**: `base.jsonl` + `events.jsonl` 기반 메시지 상태 관리
4. **Delta Append 우선**: Turn 종료 시 mutation 없으면 delta append 사용

## 파일 역할

### `paths.ts`

**WorkspacePaths 클래스**: 모든 경로 해석의 단일 진입점

**핵심 메서드:**
- `resolveGoondanHome()`: CLI 옵션 > 환경변수 > 기본값 순서
- `generateWorkspaceId()`: 스펙(workspace.md §3.2) 정확히 준수하는 토큰 기반 ID 생성
  - Format: `<folderToken>__<packageToken>`
  - 예: `Users_alice_projects_my-agent__goondan_sample-10`
- `normalizeWorkspaceToken()`: 경로/패키지명을 워크스페이스 토큰으로 정규화

**중요 규칙:**
- workspaceId는 **사람이 식별 가능**(SHOULD)해야 하며 결정론적이어야 함(MUST)
- 120자 초과 시 해시 suffix로 truncate
- 타입 단언 금지 - 모든 경로 조합은 명시적 타입

### `storage.ts`

**FileWorkspaceStorage 클래스**: 파일 기반 영속화 구현

**핵심 메서드:**
- `initializeSystemRoot()`: System Root 디렉터리 구조 초기화
- `initializeInstanceState()`: 인스턴스별 상태 디렉터리 초기화
- `loadConversation()`: base + events 합성하여 메시지 복원
- `appendMessageEvent()`: Turn 중 이벤트를 `events.jsonl`에 append
- `foldEventsToBase()`: Turn 종료 시 events → base 폴딩
- `writeBaseMessages()`: **Delta append 우선** 로직 구현
  - 모든 이벤트가 `append` 타입이면 delta append
  - mutation(replace/remove/truncate) 발생 시에만 full rewrite

**메시지 상태 규칙 (workspace.md §2.4, §7.3):**
1. `base.jsonl`: 확정된 Message 목록 (Turn 시작 시 로드)
2. `events.jsonl`: Turn 중 누적되는 MessageEvent (append-only)
3. Turn 종료 시: `NextMessages = BaseMessages + SUM(Events)` → 새 base로 폴딩
4. `events.jsonl`은 base 반영 성공 후에만 비움(MUST)
5. Delta append: 성능 최적화를 위해 append-only 이벤트만 있을 때 사용(SHOULD)

**직렬화/역직렬화:**
- `serializeMessage()` / `deserializeMessage()`: Message ↔ JSON
- `serializeMessageEvent()` / `deserializeMessageEvent()`: MessageEvent ↔ JSON
- `serializeMessageSource()` / `deserializeMessageSource()`: MessageSource 변환
- 타입 가드를 사용하여 타입 안전성 보장

**Extension 상태:**
- `readExtensionState()` / `writeExtensionState()`: Extension별 JSON 상태 관리
- 변경 감지: 직렬화 결과 비교하여 불필요한 쓰기 방지(SHOULD)

### `instance-manager.ts`

**FileInstanceManager 클래스**: 인스턴스 목록/삭제 연산

**핵심 메서드:**
- `list()`: `instances/` 디렉터리를 스캔하여 metadata.json 기반 목록 반환
- `delete()`: 인스턴스 디렉터리 전체 제거 (메시지 + Extension 상태 포함)

**규칙:**
- 인스턴스 삭제 시 `messages/`, `extensions/` 모두 제거(MUST)
- metadata.json이 손상된 인스턴스는 목록에서 제외
- 존재하지 않는 인스턴스 삭제는 에러 없이 무시

## 스펙 문서 참조

이 디렉터리의 모든 구현은 다음 스펙 문서를 따릅니다:

- **`docs/specs/workspace.md`**: 저장소 경로/레이아웃/파일 포맷의 단일 기준
- **`docs/specs/runtime.md`**: 메시지 상태 실행 규칙 (이벤트 적용 순서, 폴딩 시점)

### 핵심 규칙 요약 (workspace.md §2)

**MUST 요구사항:**
1. 2-root 물리적 분리 (Project Root ≠ System Root)
2. `base.jsonl` + `events.jsonl` 분리 기록
3. workspaceId는 Project Root + Package 기반 결정론적 생성
4. Turn 경계는 `turnId`로 구분 (혼합 적용 금지)
5. Extension state는 `extensions/<ext-name>.json`에 JSON 저장
6. 비밀값 평문 저장 금지, at-rest encryption 적용

**SHOULD 권장사항:**
1. Delta append 우선, mutation 시에만 rewrite
2. goondanHome 기본값은 `~/.goondan/`
3. setState() 호출 시 변경 감지하여 불필요한 쓰기 방지

## 작업 시 주의사항

1. **타입 단언 금지**: `as`, `as unknown as` 사용 금지. 타입 가드(`isJsonObject`, `isInstanceMetadata` 등) 사용.
2. **스펙 준수**: 모든 경로 생성/파일 포맷은 `workspace.md`를 단일 기준으로 참조.
3. **Delta Append**: `writeBaseMessages()`는 항상 mutation 여부를 확인하여 최적화.
4. **안전한 파일 쓰기**: 중요 파일은 `.tmp` 생성 후 rename으로 원자성 보장.
5. **파일 수정 후 AGENTS.md 갱신**: 이 파일과 상위 디렉터리 AGENTS.md를 최신 상태로 유지.

## 테스트 전략

1. **workspaceId 결정론성**: 동일 입력 → 동일 ID 생성 확인
2. **Delta append 조건**: append-only 이벤트 시 delta append, mutation 시 rewrite 검증
3. **복원 시나리오**: `base + events` 재생으로 정확한 상태 복원 확인
4. **경로 안전성**: 특수문자/긴 경로/패키지명 정규화 테스트

## 관련 패키지

- `../conversation/state.ts`: ConversationState 구현 (메시지 이벤트 적용)
- `../types.ts`: 공통 타입 정의 (Message, MessageEvent, JsonValue)
- `../../cli/src/commands/instance-*.ts`: CLI 명령어에서 사용
