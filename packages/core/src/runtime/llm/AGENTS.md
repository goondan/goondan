# packages/core/src/runtime/llm

LLM 어댑터 구현이 위치합니다. (AI SDK v6 등)

## 참고 사항
- ai-sdk 어댑터는 provider/modelName 문자열 대신 `@ai-sdk/*` provider 패키지로 모델을 생성합니다.
- tool 이름은 provider 제약에 맞게 sanitize하며, 호출 결과는 원래 이름으로 복원합니다.
- 기본 LLM timeout은 60초이며 `model.spec.options.timeout(또는 timeoutMs)`/`modelConfig.params.timeout`/`GOONDAN_LLM_TIMEOUT_MS`로 override 가능합니다.
- LLM 호출은 `blocks`의 messages를 우선 사용하며, AI SDK 타입을 직접 활용합니다. 타입 단언은 금지합니다.
