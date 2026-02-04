# src/live-config

Live Config 오버레이 및 patch log/status/cursor 관리 로직이 위치합니다.

## 주요 파일
- manager.ts: LiveConfigManager (proposal 수용/적용)
- store.ts: patch log/status/cursor 파일 IO

## 참고 사항
- patches.jsonl/patch-status.jsonl/cursor.yaml은 LiveConfigManager 단일 작성자 원칙을 지킵니다.
- 적용은 step.config Safe Point에서만 이루어집니다.
- LiveConfig lock 파일은 stale(pid 없음)일 경우 자동으로 정리합니다.
- LiveConfig 관련 파일은 Runtime이 결정한 Instance State Root 아래에만 저장합니다(설정 파일에서 state 경로를 오버라이드하지 않습니다).
