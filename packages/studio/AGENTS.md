# packages/studio

`@goondan/studio`는 `gdn studio`가 제공하는 런타임 관측 UI를 구현하는 패키지다.

## 존재 이유

- 운영 중 인스턴스의 흐름/로그/관계를 시각적으로 진단할 수 있게 한다.
- CLI와 런타임이 생산한 관측 데이터를 사용자 친화적으로 해석한다.

## 구조적 결정

1. Studio는 독립 빌드 산출물을 CLI에 임베드해 배포한다.
이유: 별도 정적 자산 서버 의존 없이 단일 실행 경로를 유지하기 위해.
2. Studio는 런타임 제어가 아닌 관측(read-only) 책임에 집중한다.
이유: 운영 인터페이스와 실행 제어의 결합도를 낮추기 위해.
3. 시각화 의미론은 RuntimeEvent/메시지 메타데이터 규약을 그대로 따른다.
이유: UI 해석과 실제 런타임 동작 간 괴리를 줄이기 위해.

## 불변 규칙

- Studio API 스키마는 CLI가 제공하는 응답 계약과 동기화한다.
- inbound 메타데이터 기반 발신자 복원 규칙을 깨지 않는다.
- npm 공개 배포 대상 정책(`publishConfig.access = "public"`)을 유지한다.

## 참조

- `docs/specs/cli.md`
- `docs/specs/runtime.md`
- `docs/specs/workspace.md`
- `STUDIO_PLAN.md`
