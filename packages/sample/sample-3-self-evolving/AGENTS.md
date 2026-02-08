# Self-Evolving Agent Sample

> @see /docs/specs/changeset.md

이 폴더는 Changeset 기능을 활용한 자기 수정 에이전트 샘플입니다.

## 파일 구조

```
sample-3-self-evolving/
├── AGENTS.md              # 이 파일
├── goondan.yaml           # Swarm/Agent/Tool 구성
├── prompts/
│   └── evolving.system.md # 자기 수정 가능한 시스템 프롬프트
├── tools/
│   └── self-modify/
│       └── index.ts       # 자기 수정 도구 핸들러
├── package.json           # 패키지 설정
├── tsconfig.json          # TypeScript 설정
└── README.md              # 사용자 문서
```

## 핵심 개념

### Changeset 정책

이 샘플에서 Changeset 정책은 다음과 같이 설정됩니다:

1. **Swarm 레벨**: `prompts/**`, `resources/**` 허용 (최대 범위)
2. **Agent 레벨**: 동일 (추가 제약 없음)
3. **결과**: 에이전트는 프롬프트와 리소스만 수정 가능

### 자기 수정 도구

- `self.read-prompt`: 현재 프롬프트 읽기
- `self.update-prompt`: Changeset 통해 프롬프트 수정
- `self.view-changes`: Git 로그로 변경 이력 조회

## 구현 규칙

1. **SwarmBundleApi 사용**: Tool에서 `ctx.swarmBundle`을 통해 Changeset 작업
2. **정책 준수**: 허용되지 않은 파일 수정 시 `rejected` 상태 반환
3. **다음 Step 반영**: 변경 사항은 현재 Step에서 적용되지 않음
4. **에러 처리**: 모든 단계에서 실패 시 적절한 에러 정보 반환

## 수정 시 주의사항

1. goondan.yaml의 Changeset 정책 수정 시 보안 영향 검토
2. tools/self-modify/index.ts 수정 시 타입 안전성 확인
3. 새 파일 패턴 추가 시 Swarm/Agent 양쪽 정책 업데이트
4. Tool의 `entry` 경로는 실제 소스 파일 확장자(.ts)를 사용 (빌드 산출물 .js가 아님)
5. CLI Connector는 `../../base/src/connectors/cli/index.ts`를 참조하므로 경로 정합성을 유지할 것
