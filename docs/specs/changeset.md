# Edit & Restart 스펙 v2.0

> 상세 내용: `docs/specs/runtime.md` §Edit & Restart

v2에서는 Changeset/SwarmBundleRef 시스템이 **Edit & Restart** 모델로 대체되었습니다.

상세 스펙은 `runtime.md` §8 (Edit & Restart 섹션)을 참조하세요.

## 제거된 개념

- SwarmBundleRef (불변 스냅샷 식별자)
- ChangesetPolicy (허용 파일, 권한)
- Safe Point (turn.start, step.config)
- 충돌 감지, 원자적 커밋
- 자기 수정(self-evolving) 에이전트 패턴 (외부에서 파일 수정 + restart로 대체)
