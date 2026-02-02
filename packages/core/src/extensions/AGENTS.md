# src/extensions

Extension 로더와 확장 등록 로직이 위치합니다.

## 주요 파일
- loader.ts: Extension entry 로드 및 register(api) 호출

## 참고 사항
- Extension은 register(api)를 반드시 제공해야 합니다.
- apiFactory는 runtime 파이프라인/이벤트/LiveConfig 접근을 제공합니다.
- Extension 로더는 타입 가드로 spec.entry/register 존재를 검증합니다.
