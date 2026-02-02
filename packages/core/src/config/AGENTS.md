# src/config

Config Plane 로딩 및 리소스 레지스트리를 담당합니다.

## 주요 파일
- loader.ts: YAML 다중 문서 로더
- registry.ts: kind/name 기반 리소스 저장소
- ref.ts: ObjectRef 정규화/해석
- selectors.ts: selector+overrides 해석
- validator.ts: Config 스펙 검증

## 참고 사항
- Config 스키마 검증은 최소한의 필수 필드만 확인합니다.
- selector 확장은 registry와 merge 규칙을 사용합니다.
- resolveSelectorList는 selector를 Resource/ObjectRefLike로 해석하며 overrides는 deepMerge(JsonValue)로 병합합니다.
