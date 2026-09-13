# Goondan 작업 지침

Goondan은 YAML로 에이전트 구성과 연결을 표현하고 TypeScript와 Python 호스트에서 같은 실행 의미를 제공하는 런타임입니다.

## 작업 순서

1. 루트와 작업할 하위 폴더의 `AGENTS.md`를 읽습니다.
2. 실행 계약이 바뀌면 `docs/specs/core-runtime.md`를 먼저 갱신합니다.
3. TypeScript와 Python 구현, 스키마와 conformance fixture를 같은 계약에 맞춥니다.
4. 사용자 동작이 바뀌면 `GUIDE.md`, `docs/overview.md`, `docs/architecture.md`를 함께 갱신합니다.
5. `pnpm build`, `pnpm test`, `pnpm typecheck`로 검증합니다.

## 구조

- `packages/core`: TypeScript 코어 런타임과 공개 타입
- `python/goondan`: Python 코어 런타임
- `packages/cli`: Node CLI와 대화형 호스트
- `spec`: 언어 중립 구성 스키마
- `fixtures/conformance`: 언어 간 공통 실행 사례
- `samples`: 실행 가능한 예시와 실험 자료

## 불변 규칙

- YAML은 데이터 구성으로 유지하며 호스트 구현을 이름으로 참조합니다.
- TypeScript와 Python은 각 언어의 호스트 프로세스에서 직접 실행합니다.
- 구성의 객체는 재귀 병합하고 배열은 뒤의 값으로 전체 교체합니다.
- 대화 수명과 operation 수명을 분리하며 `operationStore`를 작업 상태의 정본으로 사용합니다.
- 타입 단언보다 정확한 타입과 타입 가드를 사용합니다.
- 실험 `results` 원본은 재현과 비교를 위한 역사적 증거로 보존합니다.

상세 실행 계약은 `docs/specs/core-runtime.md`, 터미널 호스트 계약은 `docs/specs/chat-runtime.md`를 따릅니다.
