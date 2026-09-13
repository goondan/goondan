# Goondan 아키텍처

Goondan은 구성, 실행기와 호스트의 책임을 분리합니다.

```text
goondan.yaml
     │
     ▼
구성 로더 ── 합성 · 에이전트 상속 · 제거 · flow 해석
     │
     ▼
코어 런타임 ── 값 훅 · 모델/도구 반복 · 대화 저장 · operation
     │
     ├── TypeScript: @goondan/core / Node 호스트
     └── Python: goondan / Python 호스트
```

## 구성 계층

`goondan.yaml`은 에이전트와 에이전트 사이의 연결을 정의합니다. `extends`와 `resources`는 파일 단위 합성을, `agents.<name>.inherit`는 에이전트 단위 재사용을 담당합니다. `flow`는 진입점과 직렬 또는 조건부 연결을 정의합니다.

YAML은 호스트 코드의 이름만 참조합니다. 언어별 호스트가 모델, 도구, 함수, 확장, 저장소와 관측 포트를 등록합니다.

## 실행 계층

각 턴은 `input`, `conversation`, `modelInput`, `modelResult`, `toolCall`, `toolResult`, `output` 값을 통과합니다. 훅은 구성 순서에 따라 값을 변환합니다. 모델이 요청한 도구 결과는 호출과 연결하여 저장하고, 모든 호출을 처리한 뒤 다음 모델 단계 또는 예약된 실행 완료로 진행합니다.

런타임은 대화 메시지와 턴 상태를 저장소에 기록합니다. 명시적인 `maxSteps`가 있는 실행에만 단계 상한을 적용합니다.

## 지연 작업

승인 대기 작업은 독립된 operation으로 저장됩니다. 요청 턴에는 `pending` 결과를 연결하고, 결정과 실행은 `operationStore`의 원자적 상태 전이를 따릅니다. 완료 입력은 안정적인 전달 식별자로 원래 에이전트에 정확히 한 번 반영됩니다.

## 구현 경계

`packages/core`는 TypeScript 공개 타입과 실행 의미를 함께 소유합니다. `python/goondan`은 같은 의미를 Python으로 구현합니다. `packages/cli`는 Node 터미널 호스트를 제공합니다. 공통 직렬화 형식과 실행 사례는 `spec`과 `fixtures/conformance`가 소유합니다.

호스트 프로세스, 바인딩 모듈과 번들 자산의 관계는 [호스트와 코드 로딩](specs/host.md)을 따릅니다.
