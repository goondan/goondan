# docs/requirements

Goondan 요구사항 스펙 문서 폴더입니다.

## 파일 구조

- `index.md` - 메인 스펙 요약 및 인덱스 (§0~§16)
- `05_core-concepts.md` - 핵심 개념 (§5)
- `06_config-spec.md` - Config 스펙 (§6)
- `07_config-resources.md` - Config 리소스 정의 (§7)
- `08_packaging.md` - Config 구성 단위와 패키징 (§8)
- `09_runtime-model.md` - Runtime 실행 모델 (§9)
- `10_workspace-model.md` - 워크스페이스 모델 (§10)
- `11_lifecycle-pipelines.md` - 라이프사이클 파이프라인 스펙 (§11)
- `12_tool-spec-runtime.md` - Tool 스펙(런타임 관점) (§12)
- `13_extension-interface.md` - Extension 실행 인터페이스 (§13)
- `appendix_a_diagram.md` - 실행 모델 및 훅 위치 다이어그램
- `_improve-claude.md` - 요구사항 개선 리뷰 보고서(Claude 작성)
- `_improve-codex.md` - 요구사항 개선 리뷰 보고서(Codex 작성)

## 수정 시 주의사항

1. **섹션 번호 유지**: 각 분할 파일의 섹션 번호(§)는 index.md와 일치해야 합니다.
2. **내부 참조 형식**: 분할 파일 간 참조는 `@XX_파일명.md` 형식을 사용합니다.
3. **RFC 2119 규범**: MUST/SHOULD/MAY 표현은 규범적 의미로 사용됩니다.
4. **연관 문서 동기화**: 스펙 변경 시 다음 문서들의 수정 여부를 검토합니다:
   - `/GUIDE.md` - 개발자 가이드
   - `/docs/spec_api.md` - Runtime/SDK API 스펙
   - `/docs/spec_bundle.md` - Bundle YAML 스펙
   - `/docs/spec_package.md` - Bundle Package 스펙
5. **구현 검증**: 스펙 변경 후 `packages/core` 구현이 스펙을 준수하는지 확인합니다.

## 참고

- 기존 `spec_main.md` 및 `spec_main_*.md` 파일들이 이 폴더로 이동되었습니다.
