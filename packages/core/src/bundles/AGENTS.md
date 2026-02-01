# packages/core/src/bundles

Bundle(확장 묶음) 로딩/등록 로직이 위치합니다.

## 주요 파일
- loader.ts: Bundle manifest 로딩 및 리소스 경로 해석
- registry.ts: bundles.json 등록/조회
- npm.ts: npm 레지스트리 번들 설치
- git.ts: Git 번들 다운로드/캐시/해석

## 참고 사항
- Bundle resource는 spec.include로 지정된 YAML에서 로드되어 ConfigRegistry에 합쳐집니다.
- spec.dependencies는 Git Bundle을 재귀적으로 해석합니다.
- spec.entry는 Bundle Root 기준으로 해석되며 절대 경로로 확장됩니다.
- bundles.json은 enable/disable 상태를 포함합니다.
- fingerprint는 번들 무결성 확인용이며 CLI verify/refresh로 갱신됩니다.
