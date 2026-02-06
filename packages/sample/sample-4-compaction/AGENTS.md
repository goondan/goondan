# Compaction Extension Sample

## 개요

이 샘플은 Goondan Extension 시스템을 활용한 LLM 대화 Compaction(압축) 기능의 레퍼런스 구현입니다.

## 디렉토리 구조

```
sample-4-compaction/
├── goondan.yaml                    # Bundle 정의 (Swarm, Agent, Extension)
├── prompts/
│   └── default.system.md           # 시스템 프롬프트
├── extensions/
│   └── compaction/
│       ├── index.ts                # Extension 엔트리포인트 (register 함수)
│       ├── types.ts                # 타입 정의
│       └── strategies/             # 압축 전략 구현
│           ├── index.ts            # 전략 레지스트리
│           ├── token.ts            # 토큰 기반 전략
│           ├── turn.ts             # 턴 기반 전략
│           └── sliding.ts          # 슬라이딩 윈도우 전략
├── __tests__/                      # 테스트
│   ├── strategies.test.ts          # 전략 단위 테스트
│   └── extension.test.ts           # Extension 통합 테스트
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

## 핵심 구현 포인트

### Extension 등록 패턴

`extensions/compaction/index.ts`의 `register(api)` 함수가 Extension 엔트리포인트입니다.

```typescript
export async function register(
  api: ExtensionApi<CompactionState, CompactionConfig>
): Promise<void> {
  // 1. 상태 초기화
  const state = api.extState();

  // 2. 파이프라인 등록
  api.pipelines.mutate('turn.pre', async (ctx) => { ... });

  // 3. Tool 등록
  api.tools.register({ name: 'compaction.getStatus', ... });

  // 4. 이벤트 발행
  api.events.emit('extension.initialized', { ... });
}
```

### 파이프라인 사용

- `turn.pre`: Turn 시작 전에 메시지 압축 수행
- `step.blocks`: LLM 호출 전에 압축 상태 블록 추가

### 전략 패턴

`CompactionStrategyHandler` 인터페이스를 구현하는 세 가지 전략:

1. **token**: 토큰 수 기반 압축
2. **turn**: 대화 턴 수 기반 압축
3. **sliding**: 슬라이딩 윈도우 방식 압축

## Bundle 리소스 정의 (goondan.yaml)

- **Model** (`gpt-4o`): OpenAI gpt-4o 모델
- **Extension** (`compaction`): Token 기반 대화 압축 확장
- **Agent** (`main-agent`): compaction extension을 사용하는 데모 에이전트
- **Swarm** (`compaction-demo`): 단일 에이전트 스웜
- **Connector** (`cli`): CLI 인터페이스

## 참조 문서

- `/docs/specs/extension.md` - Extension 시스템 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/packages/core/src/extension/` - Core Extension 구현

## 수정 시 주의사항

1. Extension 스펙 변경 시 `/docs/specs/extension.md` 확인
2. 파이프라인 포인트 추가 시 Core 타입과 일치 확인
3. 테스트 추가/수정 시 모든 전략에 대해 테스트 수행
4. 타입 단언(`as`) 사용 금지, 타입 가드로 해결
5. goondan.yaml 수정 시 `/docs/specs/bundle.md` 스펙 준수:
   - `Model.spec.name` (model이 아님), `Model.spec.options` (parameters가 아님)
   - `Agent.spec.prompts.systemRef` (prompt.system이 아님)
   - 반드시 CLI Connector 포함
