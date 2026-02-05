# types/

Goondan Config Plane 리소스 정의 타입들을 관리하는 폴더입니다.

## 스펙 문서

이 폴더의 모든 타입은 `/docs/specs/resources.md`를 기반으로 구현되었습니다.

## 파일 구조

```
types/
├── json.ts           # JSON 기본 타입 (JsonPrimitive, JsonValue, JsonObject, JsonArray)
├── json-schema.ts    # JSON Schema 타입 (Tool의 parameters 정의용)
├── resource.ts       # Resource, ResourceMetadata, KnownKind
├── object-ref.ts     # ObjectRef, ObjectRefLike (리소스 참조 문법)
├── selector.ts       # Selector, SelectorWithOverrides, RefOrSelector
├── value-source.ts   # ValueSource, ValueFrom, SecretRef (외부 값 주입)
├── utils.ts          # 유틸리티 함수 (타입 가드, deepMerge, resolveValueSource)
├── specs/            # Kind별 Spec 인터페이스
│   ├── model.ts
│   ├── tool.ts
│   ├── extension.ts
│   ├── agent.ts
│   ├── swarm.ts
│   ├── connector.ts
│   ├── oauth-app.ts
│   ├── resource-type.ts
│   ├── extension-handler.ts
│   └── index.ts      # specs re-export
└── index.ts          # 전체 re-export
```

## 의존성

- 이 폴더는 다른 모듈에 의존하지 않습니다 (최하위 레이어)
- 다른 모든 모듈은 이 폴더의 타입을 사용할 수 있습니다

## 개발 규칙

1. **타입 단언 금지**: `as` 타입 단언을 사용하지 않습니다. 대신 타입 가드 함수를 사용합니다.
2. **스펙 준수**: `/docs/specs/resources.md`의 MUST/SHOULD/MAY 규칙을 엄격히 준수합니다.
3. **TDD**: 테스트를 먼저 작성하고, 테스트를 통과하는 코드를 구현합니다.

## 주요 유틸리티 함수

### 타입 가드
- `isResource(value)`: Resource 타입 여부 확인
- `isResourceOfKind(value, kind)`: 특정 Kind의 Resource 여부 확인
- `isObjectRef(value)`: ObjectRef 타입 여부 확인
- `isSelectorWithOverrides(value)`: SelectorWithOverrides 타입 여부 확인

### 변환/해석 함수
- `normalizeObjectRef(ref)`: "Kind/name" 문자열을 ObjectRef로 정규화
- `deepMerge(base, override)`: 객체 깊은 병합 (Selector+Overrides 적용용)
- `resolveValueSource(source, ctx)`: ValueSource 값 해석 (환경 변수, Secret 참조)

## 테스트

```bash
pnpm --filter @goondan/core test
```

테스트 파일 위치: `__tests__/types/`
