# Package Commands

이 디렉터리는 `gdn package` 명령어 그룹의 하위 명령어들을 구현한다.

## 파일 목록

| 파일 | 명령어 | 설명 |
|------|--------|------|
| `index.ts` | `gdn package` | 패키지 명령어 그룹 (하위 명령어 등록) |
| `install.ts` | `gdn package install` | package.yaml 기반 의존성 설치 |
| `add.ts` | `gdn package add <ref>` | 새 의존성 추가 |
| `remove.ts` | `gdn package remove <ref>` | 의존성 제거 |
| `update.ts` | `gdn package update [ref]` | 의존성 업데이트 |
| `list.ts` | `gdn package list` | 설치된 패키지 목록 |
| `publish.ts` | `gdn package publish` | 패키지 레지스트리에 발행 |
| `login.ts` | `gdn package login` | 레지스트리 인증 |
| `logout.ts` | `gdn package logout` | 레지스트리 인증 해제 |
| `pack.ts` | `gdn package pack` | 로컬 tarball 생성 |
| `info.ts` | `gdn package info <ref>` | 패키지 정보 조회 |
| `cache.ts` | `gdn package cache` | 캐시 관리 (info, clean) |

## 구현 상태

현재 모든 명령어는 **stub 구현**으로, 실제 레지스트리 통신 없이 기본 동작을 시뮬레이션한다.

### 구현된 기능
- package.yaml 읽기/쓰기
- packages.lock.yaml 읽기/쓰기
- 로컬 파일 시스템 조작
- 진행률 표시 (ora spinner)
- 컬러 출력 (chalk)

### 미구현 기능 (TODO)
- 실제 레지스트리 HTTP 통신
- tarball 생성/압축 해제
- integrity hash 검증
- semver 범위 해석
- 의존성 트리 해석

## 관련 스펙

- `/docs/specs/cli.md` - Section 6 (gdn package)
- `/docs/specs/bundle_package.md` - Bundle Package 스펙

## 코드 패턴

### 명령어 생성 패턴

```typescript
export function createXxxCommand(): Command {
  const command = new Command("xxx")
    .description("...")
    .argument("[arg]", "...")
    .option("--flag", "...", defaultValue)
    .action(async (arg, options) => {
      await executeXxx(arg, options);
    });

  return command;
}
```

### 옵션 인터페이스

각 명령어는 타입 안전한 옵션 인터페이스를 정의한다:

```typescript
export interface XxxOptions {
  flag: boolean;
  value?: string;
}
```

### 에러 처리

- `ora` spinner로 진행 상태 표시
- 에러 시 `spinner.fail()` 후 `logError()` 호출
- `process.exitCode` 설정 (throw 대신)

## 작업 시 주의사항

1. 모든 import에 `.js` 확장자 필수 (ESM)
2. 타입 단언(`as`) 금지 - 타입 가드 사용
3. `--json` 옵션 지원 고려
4. `--quiet` 모드에서 대화형 프롬프트 비활성화
5. 새 명령어 추가 시 `docs/specs/cli.md` 업데이트 필요
