# @goondan/models

[Goondan](https://github.com/goondan/goondan) 런타임의 공식 모델 어댑터입니다. Anthropic Messages API와 OpenAI Chat Completions API 호환 엔드포인트를 지원합니다.

여기서 "공식"은 동작이 [`spec/model-adapters.md`](https://github.com/goondan/goondan/blob/main/spec/model-adapters.md)에 규범으로 정해져 있다는 뜻입니다. 요청 헤더와 본문, 시스템 블록과 캐시, 메시지 배치, 스트림 조립, 결과, 오류 코드, 재시도가 모두 규격에 있고, 이 패키지와 Python `goondan.models`가 같은 설정과 같은 모델 입력에서 같은 요청을 만든다는 것을 공통 사례로 검증합니다.

호스트가 직접 만든 모델 구현은 이 매핑을 따르지 않아도 됩니다. 실행 규격의 모델 계약만 지키면 런타임은 구별하지 않습니다.

## 설치

```bash
npm install @goondan/models
```

`@goondan/core`는 peer 의존이므로 함께 설치되어 있어야 합니다.

## 사용

```ts
import {createGoondan, loadConfig} from "@goondan/core";
import {createAnthropicModel, createOpenAIChatModel} from "@goondan/models";

const goondan = createGoondan(await loadConfig("."), {
  models: {
    main: createAnthropicModel({model: "claude-sonnet-5"}),
    fast: createOpenAIChatModel({model: "gpt-5", baseUrl: "http://localhost:11434/v1"}),
  },
});
```

자격 증명과 기본 URL은 설정 값이나 제공자별 환경 변수에서 읽습니다. 요청 변환만 확인하려면 `buildAnthropicRequest`와 `buildOpenAIChatRequest`를 직접 부를 수 있고, 제공자 오류는 `ModelError`와 `isModelError`로 다룹니다.

## 문서

- [모델 어댑터 규격](https://github.com/goondan/goondan/blob/main/spec/model-adapters.md)
- [저장소와 README](https://github.com/goondan/goondan#readme)

## 라이선스

Apache-2.0
