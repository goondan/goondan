# file-system Tool

파일 시스템 읽기/쓰기/목록/존재 확인 도구.

## exports

- `fs.read`: 파일 읽기 (경로, 인코딩 파라미터)
- `fs.write`: 파일 쓰기 (경로, 내용, 모드: overwrite/append)
- `fs.list`: 디렉토리 목록 조회 (경로, 재귀 옵션)
- `fs.exists`: 파일/디렉토리 존재 확인

## 구현 상세

- Node.js `fs/promises` API 사용
- `fs.read`: 최대 1MB까지 읽기, 초과 시 truncation
- `fs.write`: 디렉토리 자동 생성 (`mkdir -p` 동작), overwrite/append 모드 지원
- `fs.list`: `readdir` + `withFileTypes`로 파일/디렉토리 구분, 재귀 조회 지원
- `fs.exists`: `access()` + `stat()`으로 존재 여부 및 타입(file/directory/symlink) 확인

## 작성 규칙

- `as` 타입 단언 금지
- `@goondan/core`에서 `ToolHandler`, `ToolContext`, `JsonValue`, `JsonObject` import
- `handlers` 객체를 export
