# src/utils

공통 유틸리티 모음입니다.

## 주요 파일
- fs.ts: 파일/JSONL/YAML IO
- merge.ts: Config 병합 규칙 구현
- ids.ts: ID 생성
- json.ts: 깊은 복제
- encryption.ts: AES-256-GCM 암호화/복호화 및 키 파싱
- state-paths.ts: Goondan state root/경로 템플릿/워크스페이스 ID 유틸
- jsonl-segments.ts: JSONL 세그먼트 파일(1000줄) 로테이션/로딩 유틸

## 참고 사항
- merge.js는 배열을 덮어쓰는 병합 규칙을 따릅니다.
- deepMerge는 JsonValue 기반으로 동작하며 selector overrides 병합에 사용됩니다.
