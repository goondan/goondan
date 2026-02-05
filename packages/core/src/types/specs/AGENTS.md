# specs/

각 리소스 Kind별 Spec 인터페이스를 정의하는 폴더입니다.

## 스펙 문서

각 파일은 `/docs/specs/resources.md`의 해당 섹션을 기반으로 구현되었습니다:

| 파일 | 스펙 문서 섹션 |
|------|---------------|
| `model.ts` | 6.1 Model |
| `tool.ts` | 6.2 Tool |
| `extension.ts` | 6.3 Extension |
| `agent.ts` | 6.4 Agent |
| `swarm.ts` | 6.5 Swarm |
| `connector.ts` | 6.6 Connector |
| `oauth-app.ts` | 6.7 OAuthApp |
| `resource-type.ts` | 6.8 ResourceType |
| `extension-handler.ts` | 6.9 ExtensionHandler |

## 공통 패턴

각 파일은 다음 패턴을 따릅니다:

```typescript
// 1. Spec 인터페이스 정의
export interface FooSpec {
  // ...
}

// 2. 관련 서브 타입 정의
export interface FooSubType {
  // ...
}

// 3. Resource 타입 별칭
export type FooResource = Resource<FooSpec>;
```

## 의존성

- `../resource.ts`: Resource, ResourceMetadata
- `../object-ref.ts`: ObjectRef, ObjectRefLike
- `../selector.ts`: RefOrSelector
- `../value-source.ts`: ValueSource
- `../json-schema.ts`: JsonSchema

## 테스트

테스트 파일 위치: `__tests__/types/specs/`
