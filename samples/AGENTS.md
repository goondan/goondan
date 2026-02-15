# samples

`samples`는 실제 실행 가능한 Goondan 예제 번들을 모아두는 루트입니다.

## 목적

- 특정 패턴(멀티 에이전트 협업, 외부 채널 연동, self-evolving 등)을 바로 실행/검증 가능한 형태로 제공한다.
- 스펙 변경 시 “사용자 관점 동작”을 검증하는 레퍼런스 시나리오를 유지한다.

## 작성 규칙

1. 각 샘플은 독립 폴더(`samples/<name>`)를 사용한다.
2. 각 샘플 폴더에는 최소한 `goondan.yaml`, `README.md`, `prompts/`를 둔다.
3. 로컬 코드(`tools/`, `connectors/`, `extensions/`)를 추가했다면, README에 실행 전제(필수 env/토큰/포트)를 명시한다.
4. 샘플이 코어 동작 가정(예: 자동 응답 비활성, 특정 Tool 계약)을 가진다면 해당 가정을 README에 명확히 적는다.
5. 샘플 추가/수정 시 루트 `AGENTS.md`와 `GUIDE.md`의 샘플 목록 동기화를 검토한다.
