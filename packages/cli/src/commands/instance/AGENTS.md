# Instance Commands

이 디렉터리는 `gdn instance` 명령어 그룹의 하위 명령어들을 구현한다.

## 파일 목록

| 파일 | 명령어 | 설명 |
|------|--------|------|
| `index.ts` | `gdn instance` | 인스턴스 명령어 그룹 (하위 명령어 등록) |
| `list.ts` | `gdn instance list` | 인스턴스 목록 조회 |
| `inspect.ts` | `gdn instance inspect <id>` | 인스턴스 상세 정보 조회 |
| `delete.ts` | `gdn instance delete <id>` | 인스턴스 상태 삭제 |
| `resume.ts` | `gdn instance resume <id>` | 저장된 인스턴스 재개 (stub) |

## 구현 상태

### 구현된 기능
- 인스턴스 목록 조회 (`list`)
  - `~/.goondan/instances/<workspaceId>/` 디렉터리 스캔
  - Swarm 이름으로 필터링 (`--swarm`)
  - 출력 개수 제한 (`--limit`)
  - 전체 워크스페이스 조회 (`--all`)
- 인스턴스 상세 정보 조회 (`inspect`)
  - 에이전트별 Turn/Message 카운트
  - 마지막 활성 시간
  - Active SwarmBundleRef 표시
- 인스턴스 삭제 (`delete`)
  - 확인 프롬프트 (--force로 스킵 가능)
  - 디렉터리 재귀 삭제
  - 빈 워크스페이스 디렉터리 정리

### 미구현 기능 (TODO)
- `resume` 명령어의 실제 인스턴스 재개 기능
  - SwarmBundle 로딩
  - 상태 복원
  - 런타임 재시작

## 관련 스펙

- `/docs/specs/cli.md` - Section 7 (gdn instance)
- `/docs/specs/workspace.md` - Instance State Root 레이아웃

## 인스턴스 상태 경로

인스턴스 상태는 다음 경로에 저장된다:

```
~/.goondan/instances/<workspaceId>/<instanceId>/
├── swarm/
│   └── events/
│       └── events.jsonl     # Swarm 이벤트 로그
└── agents/
    └── <agentName>/
        ├── messages/
        │   └── llm.jsonl    # LLM 메시지 로그
        └── events/
            └── events.jsonl # Agent 이벤트 로그
```

## 코드 패턴

### workspaceId 생성

```typescript
function generateWorkspaceId(swarmBundleRoot: string): string {
  const normalized = path.resolve(swarmBundleRoot);
  const hash = crypto.createHash("sha256").update(normalized).digest("hex");
  return hash.slice(0, 12);
}
```

### goondanHome 경로 결정

우선순위:
1. 설정 파일의 `stateRoot`
2. 환경 변수 `GOONDAN_STATE_ROOT`
3. 기본값 `~/.goondan`

## 작업 시 주의사항

1. 모든 import에 `.js` 확장자 필수 (ESM)
2. 타입 단언(`as`) 금지 - 타입 가드 사용
3. 대화형 프롬프트는 `--quiet` 모드에서 비활성화 고려
4. 에러 처리 시 `process.exitCode` 설정 (throw 대신)
5. 새 명령어 추가 시 `docs/specs/cli.md` 업데이트 필요
