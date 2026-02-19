# docs/wiki

`docs/wiki`는 Goondan 사용자 관점 문서를 Diataxis 체계로 제공하는 영역이다.

## 존재 이유

- 스펙 중심 정보에 접근하기 어려운 사용자에게 학습/실행/참조 경로를 제공한다.
- 온보딩부터 운영까지의 사용자 여정을 문서로 연결한다.

## 구조적 결정

1. 위키는 Diataxis(`tutorials`, `how-to`, `explanation`, `reference`) 경계를 유지한다.
이유: 학습 목적과 문제 해결 목적을 혼합하지 않기 위해.
2. 문서는 EN/KO 쌍을 기본 단위로 관리한다.
이유: 다국어 사용자 경험과 변경 동기화를 동시에 보장하기 위해.
3. 위키는 스펙 복제가 아니라 요약+참조 전략을 사용한다.
이유: SSOT를 유지하고 문서 간 드리프트를 줄이기 위해.

## 불변 규칙

- 새 문서 추가/이동 시 EN/KO 쌍과 인덱스(README)를 함께 갱신한다.
- 스펙에 없는 기능을 위키에서 발명하지 않는다.
- YAML/CLI 예시는 최신 스펙과 일치해야 한다.

## 참조

- `GUIDE.md`
- `docs/architecture.md`
- `docs/specs/AGENTS.md`
- `docs/specs/resources.md`
