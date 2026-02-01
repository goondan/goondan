# packages/core/src/bundles

Bundle(확장 묶음) 로딩/등록 로직이 위치합니다.

## 주요 파일
- loader.ts: Bundle manifest 로딩 및 리소스 경로 해석
- registry.ts: bundles.json 등록/조회

## 참고 사항
- Bundle resource는 ConfigRegistry에 합쳐져 런타임에서 사용됩니다.
- bundles.json은 enable/disable 상태를 포함합니다.
- fingerprint는 번들 무결성 확인용이며 CLI verify/refresh로 갱신됩니다.
