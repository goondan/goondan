# CLI Runtime 구현

`gdn run` 명령어에서 사용하는 실제 런타임 구현체들이 위치한 디렉토리입니다.

## 아키텍처

```
runtime/
├── index.ts                 # 모든 구현체 re-export
├── bundle-loader-impl.ts    # BundleLoadResult 기반 BundleLoader 구현
├── llm-caller-impl.ts       # AI SDK 기반 LLM 호출 구현
├── tool-executor-impl.ts    # Tool entry 모듈 동적 로드/실행 구현
├── AGENTS.md                # 이 파일
└── __tests__/               # 테스트 코드
    ├── bundle-loader-impl.test.ts
    ├── llm-caller-impl.test.ts
    └── tool-executor-impl.test.ts
```

## 파일 역할

### bundle-loader-impl.ts
- `BundleLoader` 인터페이스의 CLI 전용 구현
- `BundleLoadResult`를 기반으로 `EffectiveConfigLoader`가 필요로 하는 리소스 조회/해석을 제공
- `getResource`, `getSwarmForAgent`, `resolveToolRefs`, `resolveExtensionRefs`, `loadSystemPrompt` 구현

### llm-caller-impl.ts
- `LlmCaller` 인터페이스의 AI SDK(Vercel) 기반 구현
- `ModelResource`의 `provider`에 따라 `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google` 동적 import
- Goondan `LlmMessage`/`ToolCatalogItem`을 AI SDK `CoreMessage`/`tool` 형식으로 변환
- `generateText`로 LLM 호출, 결과를 `LlmResult`로 변환

### tool-executor-impl.ts
- `ToolExecutor` 인터페이스의 구현
- `ToolSpec.entry` 경로에서 모듈 동적 import (ESM)
- export name으로 핸들러 함수를 찾아 실행 (정확한 이름 -> camelCase -> 마지막 세그먼트 -> default)
- 모듈 캐시로 중복 로드 방지
- 에러 시 `ToolResult.error`로 변환 (예외 전파 금지)

## 참고해야 할 사항

- **타입 단언 금지**: `as`, `as unknown as` 사용 불가. 타입 가드나 `isObjectWithKey` 등의 타입 안전 함수 사용
- **AI SDK 버전**: 현재 `ai@4.x` 기반. `CoreMessage` 타입의 discriminated union 구조에 맞게 메시지 변환
- **의존성**: 이 모듈은 `@goondan/core`의 runtime 모듈(`@goondan/core/runtime`)에 의존
- **스펙 문서**: `/docs/specs/runtime.md`, `/docs/specs/tool.md` 참조
