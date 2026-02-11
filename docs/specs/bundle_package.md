# Goondan Package 스펙 (v2.0)

> **현재 규범 요약:**
> - `apiVersion`: `goondan.ai/v1`
> - 시스템 루트: `~/.goondan/packages/` (패키지 저장 경로 명확화)
> - Package spec: `version`, `description`, `dependencies` (name+version 객체 배열), `registry`
> - 8종 Kind 지원
> - Tool/Extension/Connector 실행 환경: Bun
> - 레지스트리 설정 소스/우선순위 및 `gdn package` 도움말 매트릭스는 `docs/specs/help.md` 기준으로 통합

---

## 1. 개요

### 1.1 배경과 설계 철학

Package는 Goondan 생태계에서 **재사용 가능한 배포 단위**를 정의한다. npm 패키지 시스템에서 영감을 받아, 에이전트 스웜을 구성하는 리소스(YAML), 프롬프트 파일, 도구/확장/커넥터 스크립트, 스킬 번들을 하나의 단위로 묶어 배포하고 의존성으로 참조할 수 있게 한다.

Package 시스템의 핵심 목표:

- **재사용성**: 범용 도구(bash, file-system)나 커넥터(telegram, slack)를 패키지로 게시하고, 프로젝트에서 의존성으로 사용한다.
- **재현 가능한 빌드**: lockfile을 통해 의존성 해석 결과를 고정하고, 동일한 입력에서 동일한 리소스 집합을 보장한다.
- **점진적 채택**: Package 문서 없이 `goondan.yaml`만으로도 동작하므로, 단순 프로젝트부터 복잡한 다중 패키지 프로젝트까지 유연하게 대응한다.

### 1.2 Package가 포함하는 아티팩트

Package는 다음 아티팩트를 포함할 수 있다:

- 리소스 YAML (Model, Agent, Swarm, Tool, Extension, Connector, Connection)
- 프롬프트 파일
- 도구/확장/커넥터 스크립트
- 스킬 번들

Package 매니페스트는 패키지 메타데이터, 의존성, 배포 대상 리소스 목록을 정의해야 한다 (MUST).

---

## 2. 핵심 규칙

본 섹션은 패키징 시스템에서 구현자가 반드시 준수해야 하는 규범적 규칙을 요약한다.

### 2.1 구성 파일 로딩

1. 구현은 구성 파일을 폴더/파일 단위로 분할 관리할 수 있어야 한다 (MUST).
2. 로더는 단일 파일, 디렉터리, 다중 YAML 문서(`---`)를 처리해야 한다 (MUST).
3. 로딩 결과는 결정론적이어야 하며, 동일 입력에서 동일 리소스 집합을 생성해야 한다 (MUST).
4. 모든 리소스의 `apiVersion`은 `goondan.ai/v1`이어야 한다 (MUST).

### 2.2 의존성

1. 의존성 그래프는 순환 참조 없이 DAG를 구성해야 한다 (MUST).
2. 버전 제약(semver range) 해석 결과는 lockfile 생성 시 고정되어야 한다 (MUST).
3. 동일 패키지의 상이한 버전 요구가 충돌하면 설치를 중단하고 충돌 보고를 반환해야 한다 (MUST).
4. 충돌 자동 우회(임의 최신 버전 선택)는 기본 동작이 되어서는 안 된다 (MUST NOT).

### 2.3 values 병합 우선순위

values 병합 우선순위는 다음 순서를 따라야 한다 (MUST). 후순위가 선순위를 덮어쓴다:

1. **패키지 기본값**: Package 내부에 정의된 기본 values
2. **상위 패키지 override**: 상위(의존하는) Package에서 지정한 override
3. **사용자 override**: 프로젝트 로컬(Package Root)에서 지정한 override

추가 규칙:
- 객체는 재귀 병합(deep merge)한다 (SHOULD).
- 배열은 기본 교체(replace) 정책을 사용한다 (SHOULD).
- 민감값은 values에 직접 입력하지 않고 ValueSource/SecretRef를 사용해야 한다 (SHOULD).

### 2.4 레지스트리/캐시

1. 패키지 레지스트리에서 아티팩트 메타데이터와 tarball 다운로드를 지원해야 한다 (MUST).
2. 다운로드 아티팩트는 digest 검증을 수행해야 한다 (MUST).
3. 로컬 캐시는 `~/.goondan/` 하위에 저장하고, 동일 digest 재다운로드를 회피해야 한다 (SHOULD).
4. 인증이 필요한 레지스트리는 토큰 기반 접근을 지원해야 한다 (SHOULD).

### 2.5 보안 및 검증

1. 패키지 설치 시 schema 검증을 수행하고 실패 시 로드를 중단해야 한다 (MUST).
2. 패키지가 허용되지 않은 경로(예: `../`)를 참조하면 거부해야 한다 (MUST).
3. Runtime 실행 전에 패키지 의존성 검증 결과를 사용자에게 명확한 오류 코드와 함께 제공해야 한다 (MUST).

### 2.6 게시와 접근 제어

1. 게시 전 `goondan.yaml`의 Package 문서 스키마 검증과 리소스 구성 검증(`gdn validate`)을 통과해야 한다 (MUST).
2. 게시 시 tarball 생성과 SHA512 integrity hash 계산을 수행해야 한다 (MUST).
3. 패키지는 공개(public) 또는 제한(restricted) 접근 수준을 가져야 한다 (MUST).
4. 제한 패키지의 게시/설치는 인증된 요청만 허용해야 한다 (MUST).
5. 게시된 패키지 버전의 비게시(unpublish)를 지원해야 한다 (MUST).
6. 폐기(deprecate) 표시 모드를 지원해야 하며, 이 모드에서는 다운로드를 허용하되 경고를 제공해야 한다 (SHOULD).
7. 다른 패키지가 의존하는 버전의 비게시 시 경고를 제공해야 한다 (SHOULD).
8. dist-tag(latest, beta 등) 지정을 지원해야 한다 (SHOULD).
9. `--dry-run` 모드로 게시 전 검증만 수행할 수 있어야 한다 (SHOULD).

### 2.7 레지스트리 인증

1. 레지스트리는 Bearer Token 기반 인증을 지원해야 한다 (MUST).
2. 인증 토큰은 `~/.goondan/config.json` 또는 환경 변수(`GOONDAN_REGISTRY_TOKEN`)로 제공할 수 있어야 한다 (MUST).
3. scope별 레지스트리 분리 구성을 지원해야 한다 (SHOULD).
4. 인증 토큰은 설정 파일에 평문 저장하지 않는 것을 권장한다 (SHOULD).

### 2.8 Lockfile

1. 설치 결과를 재현하기 위해 lockfile을 생성해야 한다 (MUST).
2. lockfile에는 해석된 버전, 소스(ref/digest), 의존성 트리를 포함해야 한다 (MUST).
3. CI/배포 환경은 lockfile 기반 설치 모드를 제공해야 한다 (SHOULD).

---

## 3. 핵심 개념

### 3.1 Package = 프로젝트 루트

Package는 goondan 프로젝트의 **루트 개념**이다.

- **모든 리소스**(Model, Agent, Swarm, Tool, Extension, Connector, Connection)는 Package에 속한다
- Package 문서가 없는 `goondan.yaml`도 유효하다 -- 단순한 리소스 번들로 동작
- Package 문서가 있으면 의존성 해석, 배포, 버전 관리가 가능해진다

### 3.2 goondan.yaml 통합 구조

`goondan.yaml`은 **다중 YAML 문서**로 구성된다. 첫 번째 문서가 `kind: Package`이면 Package 메타데이터로 해석하고, 이후 문서들은 리소스로 해석한다.

```yaml
# goondan.yaml -- Package가 첫 번째 문서 (선택)
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "1.0.0"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
# 이하 리소스 정의
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
```

---

## 4. 용어

| 용어 | 정의 |
|------|------|
| **Package** | goondan 프로젝트의 최상위 리소스. 메타데이터, 의존성, 배포 정보를 포함 |
| **Package Root** | `goondan.yaml`이 위치한 폴더 |
| **Package Ref** | Package를 가리키는 식별자 (예: `@goondan/base`, `@goondan/base@1.2.0`) |
| **Dependency** | 다른 Package를 참조하는 의존성 목록 |
| **Registry** | Package를 호스팅하는 서버 (예: `https://registry.goondan.ai`) |
| **System Root** | `~/.goondan/` -- 시스템 전역 설정, 패키지 캐시, 워크스페이스 저장 |

---

## 5. Package 스키마

### 5.1 TypeScript 인터페이스

```typescript
/**
 * Package 리소스 스펙
 */
interface PackageSpec {
  /** 패키지 버전 (semver) */
  version?: string;
  /** 패키지 설명 */
  description?: string;
  /** 접근 수준 */
  access?: 'public' | 'restricted';
  /** 의존하는 Package 목록 */
  dependencies?: PackageDependency[];
  /** 레지스트리 설정 */
  registry?: PackageRegistry;
}

interface PackageDependency {
  /** 패키지 이름 (예: "@goondan/base") */
  name: string;
  /** 버전 범위 (semver range, 예: "^1.0.0") */
  version: string;
}

interface PackageRegistry {
  /** 레지스트리 URL */
  url: string;
}

type PackageResource = Resource<PackageSpec>;
```

### 5.2 전체 스키마 YAML

```yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: <string>          # MUST -- 패키지 식별명
spec:
  version: <semver>        # MUST for publish -- semver 형식
  description: <string>    # MAY -- 패키지 설명
  access: public           # MAY -- 'public' | 'restricted', 기본값 'public'
  dependencies:            # MAY -- PackageDependency 목록
    - name: "@goondan/base"
      version: "^1.0.0"
    - name: "@myorg/toolkit"
      version: "^2.0.0"
  registry:                # MAY -- 레지스트리 설정
    url: "https://registry.goondan.ai"
```

### 5.3 필드 규칙

| 필드 | 필수 | 설명 |
|------|------|------|
| `metadata.name` | MUST | Package의 식별명. scope 포함 가능 (예: `@goondan/base`) |
| `spec.version` | MUST (publish 시) | semver 형식. 로컬 개발에서는 생략 가능 |
| `spec.description` | MAY | 패키지 설명 |
| `spec.access` | MAY | `'public'` (기본) 또는 `'restricted'` |
| `spec.dependencies` | MAY | PackageDependency 배열. 없으면 의존성 없음 |
| `spec.dependencies[].name` | MUST | 패키지 이름 |
| `spec.dependencies[].version` | MUST | semver 범위 |
| `spec.registry.url` | MAY | 레지스트리 URL |

### 5.4 Package 문서 위치 규칙

1. Package 문서는 `goondan.yaml`의 **첫 번째 YAML 문서**에만 위치할 수 있다(MUST).
2. 두 번째 이후 문서에 `kind: Package`가 있으면 검증 오류이다(MUST).
3. 첫 번째 문서가 `kind: Package`가 아니면 Package 없는 단순 리소스 번들로 취급한다(MUST).
4. 하나의 `goondan.yaml`에는 최대 하나의 Package 문서만 존재할 수 있다(MUST).

### 5.5 Package 문서 없는 번들

Package 문서 없이 리소스만 있는 `goondan.yaml`은 그대로 동작한다(MUST).

```yaml
# Package 없는 goondan.yaml
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
```

이 경우:
- 의존성 해석 없음
- `gdn package *` 명령어 사용 불가
- `gdn run` / `gdn validate`는 정상 동작

---

## 6. Package Ref 형식

기본 형식(권장):
```
<scope>/<name>@<version?>
```

- `<scope>`: 네임스페이스/조직 (예: `@goondan`, `@myorg`)
- `<name>`: 패키지 이름 (예: `base`, `slack-toolkit`)
- `@<version>`: 선택. semver 버전 또는 태그 (예: `@1.2.0`, `@latest`, `@beta`)

예시:
```
@goondan/base
@goondan/base@1.0.0
@goondan/base@latest
@myorg/custom-tools@2.1.0-beta.1
```

규칙:
1. `@version`이 없으면 `@latest`로 취급한다(SHOULD).
2. Package Ref는 **레지스트리에서 fetch 가능한 식별자**로 해석되어야 한다(MUST).
3. scope는 `@`로 시작하며, scope 없이 `name@version` 형태도 허용된다(MAY).

---

## 7. 의존성 해석 규칙

### 7.1 DAG 구성

1. 의존성 그래프는 순환 참조 없이 DAG를 구성해야 한다(MUST).
2. 순환 참조가 감지되면 설치를 거부해야 한다(MUST).

### 7.2 버전 충돌 해결

1. 동일 패키지의 상이한 버전 요구가 충돌하면 **설치를 중단하고 충돌 보고를 반환**해야 한다(MUST).
2. 충돌 자동 우회(임의 최신 버전 선택)는 **기본 동작이 되어서는 안 된다**(MUST NOT).
3. 버전 제약(semver range) 해석 결과는 lockfile 생성 시 고정되어야 한다(MUST).

충돌 보고 예시:
```
ERROR: Version conflict for @goondan/core-utils
  - @goondan/base@1.0.0 requires @goondan/core-utils@^0.5.0
  - @myorg/toolkit@2.0.0 requires @goondan/core-utils@^1.0.0
Resolution: Manually align version ranges or use explicit overrides.
```

### 7.3 values 병합 우선순위

`values` 병합 우선순위의 규범 기준은 `2.3 values 병합 우선순위`를 단일 기준으로 따른다(MUST).
본 절은 의존성 해석 문맥에서 해당 규칙이 동일하게 적용됨을 명시하기 위한 참조 절이다.

---

## 8. 패키지 레지스트리

### 8.1 레지스트리 개요

Goondan 패키지 레지스트리는 Package의 메타데이터와 tarball을 호스팅하는 HTTP 서버이다.

기본 레지스트리:
```
https://registry.goondan.ai
```

사용자는 `~/.goondan/config.json` 또는 환경 변수로 커스텀 레지스트리를 지정할 수 있다(MAY).
설정 소스와 우선순위는 `docs/specs/help.md` 4절을 따른다.

### 8.2 레지스트리 API

#### 8.2.1 패키지 메타데이터 조회

```
GET /<scope>/<name>
```

응답 예시:
```json
{
  "name": "@goondan/base",
  "description": "Goondan 기본 Tool/Extension 번들",
  "access": "public",
  "versions": {
    "1.0.0": {
      "version": "1.0.0",
      "dependencies": {
        "@goondan/core-utils": "^0.5.0"
      },
      "deprecated": "",
      "dist": {
        "tarball": "https://registry.goondan.ai/@goondan/base/-/base-1.0.0.tgz",
        "shasum": "abc123...",
        "integrity": "sha512-..."
      }
    }
  },
  "dist-tags": {
    "latest": "1.0.0"
  }
}
```

#### 8.2.2 특정 버전 조회

```
GET /<scope>/<name>/<version>
```

#### 8.2.3 Tarball 다운로드

```
GET /<scope>/<name>/-/<name>-<version>.tgz
```

Tarball은 Package Root 전체를 포함하는 gzip 압축 tar 아카이브이다.

#### 8.2.4 패키지 게시(Publish)

```
PUT /<scope>/<name>
Content-Type: application/json

{
  "name": "@goondan/base",
  "version": "1.0.0",
  "dist": { ... },
  "_attachments": { ... }
}
```

인증 필수(MUST).

#### 8.2.5 패키지 비게시(Unpublish)

```
DELETE /<scope>/<name>/<version>
```

인증 필수(MUST). 전체 패키지를 비게시하려면 버전을 생략한다:

```
DELETE /<scope>/<name>
```

#### 8.2.6 패키지 폐기(Deprecate)

```
PUT /<scope>/<name>/<version>/deprecate
Content-Type: application/json

{
  "message": "Use v2.0.0 instead"
}
```

인증 필수(MUST). 빈 `message`(`""`)를 전달하면 폐기 표시를 해제한다.

### 8.3 인증

레지스트리는 Bearer Token 기반 인증을 지원해야 한다(MUST).

```
Authorization: Bearer <token>
```

인증 토큰은 `~/.goondan/config.json` 또는 환경 변수(`GOONDAN_REGISTRY_TOKEN`)로 제공할 수 있어야 한다(MUST).
인증 소스의 단일 기준은 `docs/specs/help.md` 4절이다.

**보안 권장사항**:
- 인증 토큰은 설정 파일에 평문으로 직접 저장하지 않는 것을 권장한다(SHOULD).
- 환경 변수 참조 패턴(`${GOONDAN_REGISTRY_TOKEN}`)을 사용하는 것을 권장한다(SHOULD).

```json
{
  "registries": {
    "https://registry.goondan.ai": {
      "token": "${GOONDAN_REGISTRY_TOKEN}"
    }
  }
}
```

---

## 9. 다운로드 및 캐시 규칙

### 9.1 시스템 루트

패키지 저장 경로는 `~/.goondan/packages/`이다.

```
~/.goondan/
├── config.json                    # CLI 설정
├── packages/                      # 설치된 패키지
│   └── <scope>/<name>/<version>/  # 패키지별 디렉터리
└── workspaces/                    # 인스턴스 상태
```

### 9.2 다운로드 규칙

1. Package를 해석할 때, **Package Root 전체 디렉터리 트리를 다운로드**한다(MUST).
2. 다운로드 경로는 충돌을 방지하기 위해 **scope/name/version**을 포함해야 한다(SHOULD).
3. 무결성 검증을 위해 **integrity hash(sha512)**를 확인해야 한다(MUST).
4. 동일 digest 재다운로드를 회피해야 한다(SHOULD).

---

## 10. 구성 병합/로드 순서

1. `goondan.yaml`을 파싱할 때, 첫 번째 문서가 `kind: Package`이면 Package 메타데이터로 추출하고 나머지를 리소스로 처리한다(MUST).
2. Package의 `spec.dependencies`를 **재귀적으로 해석**한다(MUST).
3. 로드 순서는 **의존성 -> 현재 Package 인라인 리소스** 순으로 처리한다(SHOULD).
4. 인라인 리소스(goondan.yaml 내부)는 의존성 리소스 이후에 로드된다(SHOULD).
5. 동일 Kind/name이 중복될 경우, **후순위 로드가 덮어쓴다**(정책 선택 가능). 덮어쓰기 허용 여부는 런타임 정책에 따른다(MAY).

### 10.1 이름 충돌과 참조 방식

- 이름이 유일하면 단순 참조:
```yaml
ref: "Tool/bash"
ref: "Extension/skills"
```

- 이름이 충돌하면 `package`을 지정:
```yaml
tools:
  - ref: "Tool/bash"
  - kind: Tool
    name: bash
    package: "@goondan/base"
```

규칙:
1. `package`을 지정하면 해당 Package 안에서만 리소스를 탐색한다(MUST).
2. `package`이 없으면 모든 로드된 리소스 네임스페이스에서 **유일 매칭**을 요구한다(MUST).

---

## 11. Lockfile (goondan.lock.yaml)

### 11.1 개요

`goondan.lock.yaml`은 의존성 해석 결과를 고정하여 **재현 가능한 빌드**를 보장한다.

### 11.2 Lockfile 형식

```yaml
# goondan.lock.yaml
lockfileVersion: 1
packages:
  "@goondan/base@1.0.0":
    version: "1.0.0"
    resolved: "https://registry.goondan.ai/@goondan/base/-/base-1.0.0.tgz"
    integrity: "sha512-AAAA..."
    dependencies:
      "@goondan/core-utils": "0.5.2"
  "@goondan/core-utils@0.5.2":
    version: "0.5.2"
    resolved: "https://registry.goondan.ai/@goondan/core-utils/-/core-utils-0.5.2.tgz"
    integrity: "sha512-BBBB..."
```

### 11.3 Lockfile 규칙

1. Package 다운로드 후 **integrity hash(sha512)**를 검증한다(MUST).
2. `goondan.lock.yaml`은 Package Ref와 정확한 버전/integrity 정보를 저장해 **재현 가능한 로딩**을 보장한다(SHOULD).
3. `--frozen-lockfile` 옵션으로 설치 시, lockfile과 불일치하면 설치를 거부해야 한다(MUST).
4. CI/배포 환경은 lockfile 기반 설치 모드(`--frozen-lockfile`)를 제공해야 한다(SHOULD).

---

## 12. 보안 및 검증

패키지 설치 및 로드 시 다음 보안 규칙을 적용해야 한다.

### 12.1 Schema 검증

1. `goondan.yaml`의 Package 문서 및 리소스 YAML의 **schema 검증을 수행**하고, 실패 시 로드를 중단해야 한다(MUST).
2. 알 수 없는 `kind` 또는 필수 필드 누락은 오류로 처리한다(MUST).
3. 스키마에 정의된 Kind만 로드할 수 있어야 한다(MUST).

### 12.2 경로 탐색 방지

1. 리소스의 `spec.entry` 등에서 **상위 디렉터리 참조(`../`)를 포함하는 경로는 거부**해야 한다(MUST).
2. 절대 경로 참조도 거부해야 한다(MUST). 모든 경로는 Package Root 기준 상대 경로여야 한다.

### 12.3 의존성 검증 오류 코드

1. Runtime 실행 전에 패키지 의존성 검증 결과를 사용자에게 **명확한 오류 코드와 함께 제공**해야 한다(MUST).
2. 오류 코드 예시:
   - `PKG_NOT_FOUND`: 레지스트리에서 패키지를 찾을 수 없음
   - `PKG_VERSION_CONFLICT`: 의존성 버전 충돌
   - `PKG_INTEGRITY_FAIL`: integrity hash 불일치
   - `PKG_SCHEMA_INVALID`: schema 검증 실패
   - `PKG_PATH_TRAVERSAL`: 허용되지 않은 경로 참조
   - `PKG_CIRCULAR_DEP`: 순환 참조 감지
   - `PKG_AUTH_REQUIRED`: 인증이 필요한 restricted 패키지

---

## 13. CLI 명령어

### 13.1 개요

Goondan CLI(`gdn`)는 Package를 관리하기 위한 `package` 하위 명령어를 제공한다.
명령어 매트릭스의 단일 기준은 `docs/specs/help.md` 5절이다.
이 절은 Package 도메인 관점의 동작 의미(의존성 변경, 설치, 게시)만 기술한다.

### 13.2 의존성 추가

```bash
gdn package add @goondan/base
gdn package add @goondan/base@1.2.0
```

**동작:**
1. 레지스트리에서 패키지 메타데이터를 조회한다
2. `goondan.yaml`의 Package 문서 `spec.dependencies`에 추가한다
3. `gdn package install`을 실행한다

> 만약 `goondan.yaml`에 Package 문서가 없으면 자동 생성한다(SHOULD).

### 13.3 의존성 설치

```bash
# goondan.yaml의 spec.dependencies 설치
gdn package install

# lockfile 기준으로 설치 (CI 환경용)
gdn package install --frozen-lockfile
```

**동작:**
1. `goondan.yaml`에서 Package 문서의 `spec.dependencies`를 읽는다
2. 각 패키지에 대해 레지스트리에서 메타데이터를 조회한다
3. 버전 해석(semver 범위 -> 정확한 버전)을 수행한다
4. 의존성 트리를 구성하고 충돌을 감지한다
5. tarball을 다운로드하고 integrity를 검증한다
6. `~/.goondan/packages/<scope>/<name>/<version>/`에 압축 해제한다
7. `goondan.lock.yaml`을 생성/업데이트한다

### 13.4 패키지 발행

```bash
gdn package publish
gdn package publish --tag beta
gdn package publish --access restricted
gdn package publish --dry-run
```

**발행 절차:**
1. `goondan.yaml`에서 Package 문서 검증
2. `spec.version` 존재 확인 (필수)
3. 구성 검증 (`gdn validate`)
4. tarball 생성
5. integrity hash(sha512) 계산
6. 레지스트리에 업로드

### 13.5 패키지 비게시/폐기

CLI는 `unpublish`/`deprecate` 서브커맨드를 지원하지 않는다.
비게시/폐기는 레지스트리 관리 UI 또는 레지스트리 API(`8.2.5`, `8.2.6`)로 수행한다.

### 13.6 명령어 요약

명령어 표는 `docs/specs/help.md` 5절을 단일 기준으로 따른다(MUST).
CLI 인터페이스 상세(옵션/출력 형식)는 `docs/specs/cli.md`를 참조한다.

---

## 14. 상세 예시

### 14.1 라이브러리 패키지 (@goondan/base)

배포용 패키지 -- 다른 프로젝트에서 의존성으로 사용 가능.

```yaml
# goondan.yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: "@goondan/base"
spec:
  version: "1.0.0"
  description: "Goondan 기본 Tool, Extension, Connector 번들"
  registry:
    url: "https://registry.goondan.ai"
```

디렉터리 구조:
```
@goondan/base/
├── goondan.yaml          # Package 매니페스트 + 리소스 정의
├── goondan.lock.yaml     # 의존성 lockfile
├── tools/
│   ├── bash/
│   │   ├── tool.yaml     # Tool 리소스 YAML
│   │   └── index.ts      # 핸들러 구현
│   └── file-system/
│       ├── tool.yaml
│       └── index.ts
├── extensions/
│   ├── logging/
│   │   ├── extension.yaml
│   │   └── index.ts
│   └── compaction/
│       ├── extension.yaml
│       └── index.ts
└── connectors/
    ├── telegram/
    │   ├── connector.yaml
    │   └── index.ts
    └── cli/
        ├── connector.yaml
        └── index.ts
```

### 14.2 애플리케이션 프로젝트 (consumer)

의존성을 소비하고 자체 리소스를 정의하는 프로젝트.

```yaml
# goondan.yaml
apiVersion: goondan.ai/v1
kind: Package
metadata:
  name: my-coding-swarm
spec:
  version: "0.0.1"
  dependencies:
    - name: "@goondan/base"
      version: "^1.0.0"
---
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: coder
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompts:
    systemPrompt: |
      You are a coding assistant.
  tools:
    - ref: "Tool/bash"
    - ref: "Tool/file-system"
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/coder"
  agents:
    - ref: "Agent/coder"
---
apiVersion: goondan.ai/v1
kind: Connection
metadata:
  name: cli
spec:
  connectorRef:
    kind: Connector
    name: cli
    package: "@goondan/base"
  ingress:
    rules:
      - route: {}
```

### 14.3 Package 없는 단순 프로젝트

의존성 없이 모든 리소스를 인라인으로 정의하는 가장 단순한 형태.

```yaml
# goondan.yaml -- kind: Package 없음
apiVersion: goondan.ai/v1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  model: claude-sonnet-4-20250514
  apiKey:
    valueFrom:
      env: ANTHROPIC_API_KEY
---
apiVersion: goondan.ai/v1
kind: Agent
metadata:
  name: chatbot
spec:
  modelConfig:
    modelRef: "Model/claude"
  prompts:
    systemPrompt: "You are a helpful chatbot."
---
apiVersion: goondan.ai/v1
kind: Swarm
metadata:
  name: default
spec:
  entryAgent: "Agent/chatbot"
  agents:
    - ref: "Agent/chatbot"
```

### 14.4 동작 요약

1. `goondan.yaml`을 파싱한다
2. 첫 번째 문서가 `kind: Package`이면 Package 메타데이터를 추출한다
3. `spec.dependencies`가 있으면 각 패키지를 레지스트리에서 해석한다
4. 의존성 Package의 리소스를 Config에 병합한다
5. 현재 `goondan.yaml`의 인라인 리소스를 Config에 병합한다
6. 스크립트(`index.ts`)는 리소스 YAML에서의 상대 경로 기준으로 `entry`를 resolve한다

---

## 15. 레지스트리 설정

레지스트리 설정 소스/우선순위/설정 형식의 단일 기준은 `docs/specs/help.md` 4절이다.
이 문서는 Package 라이프사이클 의미론(의존성 해석, 다운로드, 게시, lockfile)만 다루며,
레지스트리 설정 세부(JSON 필드, 우선순위 표)는 재정의하지 않는다(SHOULD).

---

## 관련 문서

- `/docs/specs/resources.md` - Config Plane 리소스 정의 스펙
- `/docs/specs/bundle.md` - Bundle YAML 스펙
- `/GUIDE.md` - 개발자 가이드
