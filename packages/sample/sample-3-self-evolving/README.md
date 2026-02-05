# Self-Evolving Agent Sample

이 샘플은 Goondan의 **Changeset 기능**을 활용하여 자신의 프롬프트와 설정을 수정할 수 있는 에이전트를 구현합니다.

## 개념

Self-Evolving Agent는 다음과 같은 핵심 개념을 보여줍니다:

1. **Changeset 기반 자기 수정**: 에이전트가 Git worktree를 통해 안전하게 자신의 설정을 수정
2. **정책 기반 제한**: `prompts/**`와 `resources/**`만 수정 가능 (코드 수정 불가)
3. **다음 Step 반영**: 변경 사항은 즉시 적용되지 않고 다음 Step부터 적용
4. **변경 이력 추적**: Git을 통한 모든 변경 이력 관리

## 구조

```
sample-3-self-evolving/
├── goondan.yaml              # Swarm 구성 (Changeset 정책 포함)
├── prompts/
│   └── evolving.system.md    # 자기 수정 가능한 시스템 프롬프트
├── tools/
│   └── self-modify/
│       └── index.ts          # 자기 수정 도구 구현
├── package.json
├── tsconfig.json
└── README.md
```

## Changeset 정책

### Swarm 레벨 정책 (최대 허용 범위)

```yaml
policy:
  changesets:
    enabled: true
    applyAt:
      - step.config
    allowed:
      files:
        - "prompts/**"
        - "resources/**"
    emitRevisionChangedEvent: true
```

### Agent 레벨 정책 (추가 제약)

```yaml
changesets:
  allowed:
    files:
      - "prompts/**"
      - "resources/**"
```

## 도구

### self.readPrompt

현재 시스템 프롬프트를 읽습니다.

**Parameters:**
- `promptPath` (optional): 읽을 프롬프트 파일 경로 (기본: `prompts/evolving.system.md`)

**Returns:**
```json
{
  "success": true,
  "path": "prompts/evolving.system.md",
  "content": "...",
  "size": 1234,
  "modifiedAt": "2026-02-05T10:30:00.000Z"
}
```

### self.updatePrompt

시스템 프롬프트를 수정합니다. Changeset을 통해 안전하게 변경을 관리합니다.

**Parameters:**
- `newContent` (required): 새로운 프롬프트 내용
- `promptPath` (optional): 수정할 프롬프트 파일 경로 (기본: `prompts/evolving.system.md`)
- `reason` (optional): 변경 이유 (커밋 메시지에 포함)

**Returns (성공):**
```json
{
  "success": true,
  "changesetId": "cs-1234567890-abcd1234",
  "baseRef": "git:abc123...",
  "newRef": "git:def456...",
  "promptPath": "prompts/evolving.system.md",
  "summary": {
    "filesChanged": ["prompts/evolving.system.md"],
    "filesAdded": [],
    "filesDeleted": []
  },
  "message": "Prompt updated successfully. Changes will take effect in the next Step."
}
```

**Returns (정책 위반):**
```json
{
  "success": false,
  "error": "ChangesetPolicy에 의해 허용되지 않은 파일이 변경되었습니다.",
  "code": "POLICY_VIOLATION",
  "violatedFiles": ["goondan.yaml"],
  "stage": "policyValidation",
  "changesetId": "cs-1234567890-abcd1234"
}
```

### self.viewChanges

프롬프트 변경 이력을 조회합니다.

**Parameters:**
- `maxCount` (optional): 조회할 최대 변경 수 (기본: 10)
- `promptPath` (optional): 특정 파일의 변경만 조회

**Returns:**
```json
{
  "success": true,
  "activeRef": "git:abc123...",
  "totalCount": 3,
  "changes": [
    {
      "commitSha": "abc123...",
      "subject": "Update prompt: prompts/evolving.system.md",
      "date": "2026-02-05 10:30:00 +0900",
      "author": "Agent"
    }
  ]
}
```

## 사용 예시

### 대화 예시

```
User: 너의 현재 시스템 프롬프트를 보여줘.

Agent: [self.readPrompt 호출]
현재 시스템 프롬프트입니다:
# Self-Evolving Agent
You are a self-evolving AI agent...

User: 한국어로 응답하도록 프롬프트를 수정해줘.

Agent: [self.updatePrompt 호출]
프롬프트를 수정했습니다. 변경 이유: "사용자 요청에 따라 한국어 응답 지침 추가"

변경 사항:
- 파일: prompts/evolving.system.md
- 새 버전: git:def456...

이 변경은 다음 대화 턴부터 적용됩니다.

User: 변경 이력을 보여줘.

Agent: [self.viewChanges 호출]
최근 변경 이력입니다:
1. def456... - Update prompt: prompts/evolving.system.md (방금)
2. abc123... - Initial creation (1시간 전)
```

## Changeset 워크플로우

```
Step N:
  1. LLM이 self.updatePrompt 호출
  2. swarmBundle.openChangeset() - Git worktree 생성
  3. worktree에서 프롬프트 파일 수정
  4. swarmBundle.commitChangeset() - Git commit 생성
  5. Step N은 기존 프롬프트로 계속 실행

Step N+1:
  1. step.config에서 새 SwarmBundleRef 활성화
  2. 새 프롬프트 로드
  3. 수정된 프롬프트로 실행
```

## 보안 고려사항

1. **코드 수정 불가**: `tools/**`, `goondan.yaml` 등 코드 파일은 정책에 의해 보호됨
2. **정책 검증**: 모든 변경은 Swarm/Agent 정책을 통과해야 함
3. **Git 기반 추적**: 모든 변경은 Git 커밋으로 기록됨
4. **단일 작성자**: SwarmBundleManager만 변경 권한 보유

## 빌드

```bash
pnpm install
pnpm build
```

## 관련 문서

- [Changeset 스펙](/docs/specs/changeset.md)
- [Tool 시스템 스펙](/docs/specs/tool.md)
- [Bundle YAML 스펙](/docs/specs/bundle.md)
