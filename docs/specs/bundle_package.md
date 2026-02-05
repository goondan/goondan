# Goondan Bundle Package 요구사항 (Registry 기반)

본 문서는 Goondan 생태계에서 **Bundle Package를 패키지 레지스트리 기반으로 식별/다운로드/의존성 해석**하기 위한 요구사항을 정의한다.
핵심 목적은 Bundle Package 자체(스크립트, YAML 정의, 비-Node 런타임 코드 등)를 **그대로 배포/사용**하는 것이다.

Bundle Package는 **배포/패키징 단위**이며, **Bundle 자체는 YAML+코드 폴더 트리**를 의미한다.

---

## 1. 목표

1. Bundle Package는 **실행 가능한 리소스 묶음**(Tool/Extension/Connector 정의 + 스크립트 파일)을 의미한다.
2. npm은 **선택적 호스팅/메타데이터**로만 사용 가능하며, **필수 의존성 관리 도구가 아니다**.
3. Bundle Package는 **패키지 레지스트리 경로**로 식별되고, **bundle.yaml이 있는 폴더 전체가 다운로드**되어야 한다.
4. `spec.include`는 **최종 Config를 구성할 YAML 목록**을 정의하며, **다운로드 범위를 제한하지 않는다**.

---

## 2. 용어

- **Bundle Package Root**: `bundle.yaml`이 위치한 폴더
- **Bundle Package Ref**: Bundle Package를 가리키는 식별자(예: `@goondan/base`, `@goondan/base@1.2.0`)
- **Include List**: 최종 Config로 **로딩할 YAML 파일 경로 목록**
- **Dependency**: 다른 Bundle Package를 참조하는 Bundle Package Ref 목록
- **Registry**: Bundle Package를 호스팅하는 서버(예: `https://registry.goondan.io`)

---

## 3. Bundle Package Ref 형식

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
2. Bundle Package Ref는 **레지스트리에서 fetch 가능한 식별자**로 해석되어야 한다(MUST).
3. scope는 `@`로 시작하며, scope 없이 `name@version` 형태도 허용된다(MAY).

---

## 4. 패키지 레지스트리

### 4.1 레지스트리 개요

Goondan 패키지 레지스트리는 Bundle Package의 메타데이터와 tarball을 호스팅하는 HTTP 서버이다.

기본 레지스트리:
```
https://registry.goondan.io
```

사용자는 `.goondanrc` 또는 환경 변수로 커스텀 레지스트리를 지정할 수 있다(MAY).

### 4.2 레지스트리 API

#### 4.2.1 패키지 메타데이터 조회

```
GET /<scope>/<name>
```

응답 예시:
```json
{
  "name": "@goondan/base",
  "description": "Goondan 기본 Tool/Extension 번들",
  "versions": {
    "1.0.0": {
      "version": "1.0.0",
      "dependencies": {},
      "dist": {
        "tarball": "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz",
        "shasum": "abc123...",
        "integrity": "sha512-..."
      }
    },
    "1.1.0": { ... }
  },
  "dist-tags": {
    "latest": "1.1.0",
    "beta": "2.0.0-beta.1"
  }
}
```

#### 4.2.2 특정 버전 조회

```
GET /<scope>/<name>/<version>
```

응답 예시:
```json
{
  "name": "@goondan/base",
  "version": "1.0.0",
  "dependencies": {
    "@goondan/core-utils": "^0.5.0"
  },
  "dist": {
    "tarball": "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz",
    "shasum": "abc123def456...",
    "integrity": "sha512-AAAA..."
  },
  "bundle": {
    "include": [
      "dist/tools/fileRead/tool.yaml",
      "dist/extensions/skills/extension.yaml"
    ],
    "runtime": "node"
  }
}
```

#### 4.2.3 Tarball 다운로드

```
GET /<scope>/<name>/-/<name>-<version>.tgz
```

Tarball은 Bundle Package Root 전체를 포함하는 gzip 압축 tar 아카이브이다.

### 4.3 인증

프라이빗 레지스트리의 경우 Bearer 토큰 인증을 지원한다(MAY).

```
Authorization: Bearer <token>
```

토큰은 `.goondanrc` 또는 환경 변수 `GOONDAN_REGISTRY_TOKEN`으로 설정할 수 있다.

---

## 5. 다운로드 및 캐시 규칙

1. Bundle Package를 해석할 때, **Bundle Package Root 전체 디렉터리 트리를 다운로드**한다(MUST).
2. `spec.include`는 **다운로드 범위를 제한하지 않는다**(MUST).
3. 다운로드 경로는 충돌을 방지하기 위해 **scope/name/version**을 포함해야 한다(SHOULD).
4. 무결성 검증을 위해 **integrity hash(sha512)**를 확인해야 한다(MUST).


---

## 6. package.yaml 스키마 (Bundle Package 매니페스트)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: base
  version: "1.0.0"
spec:
  dependencies:
    - "@goondan/core-utils@^0.5.0"
    - "@myorg/slack-toolkit@1.2.0"
  resources:
    - tools/fileRead/tool.yaml
    - extensions/skills/extension.yaml
  dist:
    - dist/
```

필수 규칙:
1. `kind: Package`은 필수이다(MUST).
2. `metadata.name`은 Bundle Package의 식별명으로 사용된다(MUST).
3. `metadata.version`은 semver 형식이어야 한다(MUST).
4. `spec.dependencies`는 Bundle Package Ref 목록이다(MAY).
5. `spec.resources`는 **패키지로써 export 될 YAML 목록**이다(SHOULD).
6. `spec.dist`는 패키지로써 tarball로 export 될 폴더이며, 빌드 된 소스코드, yaml 등을 모두 포함해야 한다.

---

## 7. resources 규칙 (핵심)

1. `spec.resources`에 명시된 YAML만 **최종 Config에 병합**된다(MUST).
2. `spec.resources`에 포함되지 않은 파일도 **spec.dist 에 정의 된 폴더 안에 있는 한 다운로드**된다(MUST).
3. `spec.resources` 경로는 **spec.dist 기준 상대 경로**로 해석한다(MUST).
4. `spec.resources`가 없으면 이는 export 되는 패키지가 아니라 최종적으로 consume만 하는 번들이다. (MUST).

---

## 8. 리소스 YAML 규칙

Tool/Extension/Connector 등 리소스 정의 파일은 기존 Config 스펙과 동일하게 해석한다.
단, `spec.entry` 경로는 **spec.dist 기준 상대 경로**로 해석한다(MUST).

예시 (Tool):
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: fileRead
spec:
  runtime: node
  entry: "./tools/fileRead/index.js"
  exports:
    - name: read
      description: "파일을 읽습니다"
      parameters:
        type: object
        properties:
          path:
            type: string
        required: ["path"]
```

예시 (Extension):
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
```

비-Node 런타임 예시:
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: pySum
spec:
  runtime: python
  entry: "./tools/py/sum.py"
  exports:
    - name: sum
      description: "두 수를 더합니다"
      parameters:
        type: object
        properties:
          a: { type: number }
          b: { type: number }
        required: ["a","b"]
```

---

## 9. 구성 병합/로드 순서

1. Bundle Package를 로드하면 `spec.dependencies`를 **재귀적으로 해석**한다(MUST).
2. 로드 순서는 **의존성 → 현재 Bundle Package** 순으로 처리한다(SHOULD).
3. 하나의 Bundle Package 안에서는 `spec.resources`에 나열된 **순서대로 리소스를 로드**한다(SHOULD).
4. 동일 Kind/name이 중복될 경우, **후순위 로드가 덮어쓴다**(정책 선택 가능). 덮어쓰기 허용 여부는 런타임 정책에 따른다(MAY).

---

## 10. 이름 충돌과 참조 방식

- 이름이 유일하면 단순 참조:
```
Tool/fileRead
Extension/skills
```

- 이름이 충돌하면 `package`을 지정:
```yaml
extensions:
  - extensionRef: Extension/skills
  - package: "@goondan/base@1.0.0"
    extensionRef: Extension/skills
```

```yaml
tools:
  - toolRef: Tool/fileRead
```

규칙:
1. `package`을 지정하면 해당 Bundle Package 안에서만 리소스를 탐색한다(MUST).
2. `package`이 없으면 모든 로드된 리소스 네임스페이스에서 **유일 매칭**을 요구한다(MUST).

---

## 11. 무결성 및 재현성

1. Bundle Package 다운로드 후 **integrity hash(sha512)**를 검증한다(MUST).
2. `packages.lock.yaml`은 Bundle Package Ref와 정확한 버전/integrity 정보를 저장해 **재현 가능한 로딩**을 보장한다(SHOULD).

### 11.1 Lockfile 형식

```yaml
# packages.lock.yaml
lockfileVersion: 1
packages:
  "@goondan/base@1.0.0":
    version: "1.0.0"
    resolved: "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz"
    integrity: "sha512-AAAA..."
    dependencies:
      "@goondan/core-utils": "0.5.2"
  "@goondan/core-utils@0.5.2":
    version: "0.5.2"
    resolved: "https://registry.goondan.io/@goondan/core-utils/-/core-utils-0.5.2.tgz"
    integrity: "sha512-BBBB..."
```

---

## 12. 상세 예시

### 12.1 Bundle Package 구조
```
@goondan/base (v1.0.0)

/
  packages.yaml
  dist/
    tools/
      fileRead/
        tool.yaml
        index.js
    extensions/
      skills/
        extension.yaml
        index.js
#  tools/
#    fileRead/
#      tool.yaml
#      index.ts
#  tsconfig.json
#  package.json
#  패키지에 배포 되는 건 dist 폴더이고, 나머지는 패키지 개발을 할 때 사용 됨
```

### 12.2 package.yaml
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: base
  version: "1.0.0"
spec:
  dependencies:
    - "@goondan/core-utils@^0.5.0"
  resources:
    - tools/fileRead/tool.yaml
    - extensions/skills/extension.yaml
```

### 12.3 tool.yaml / extension.yaml
```yaml
# dist/tools/fileRead/tool.yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: fileRead
spec:
  runtime: node
  entry: "./tools/fileRead/index.js"
  exports:
    - name: read
      description: "파일을 읽습니다"
      parameters:
        type: object
        properties:
          path: { type: string }
        required: ["path"]
```

```yaml
# dist/extensions/skills/extension.yaml
apiVersion: agents.example.io/v1alpha1
kind: Extension
metadata:
  name: skills
spec:
  runtime: node
  entry: "./extensions/skills/index.js"
```


### 12.4 Agent에서 Bundle Package 사용
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: default
spec:
  extensions:
    - extensionRef: Extension/skills
    - package: "@goondan/base@1.0.0" # 충돌이 있을 경우 명시
      extensionRef: Extension/skills
  tools:
    - toolRef: Tool/fileRead
    - toolRef: Tool/pySum
```

### 12.5 동작 요약
1. `@goondan/base@1.0.0`을 레지스트리에서 가져온다.
2. tarball을 다운로드하고 integrity를 검증한다.
3. 로컬 캐시에 압축을 해제한다.
4. `packages.yaml`을 읽고 `include` 목록에 있는 YAML만 Config에 병합한다.
5. 스크립트(`index.js`, `sum.py`)는 리소스 yaml 파일에서의 상대 경로 기준으로 `entry`를 resolve한다.

---

## 13. CLI 명령어

### 13.1 개요

Goondan CLI(`gdn`)는 Bundle Package를 관리하기 위한 `package` 하위 명령어를 제공한다.

### 13.2 의존성 설치

```bash
# package.yaml에 정의된 모든 의존성 설치
gdn package install

# lockfile 기준으로 설치 (CI 환경용)
gdn package install --frozen-lockfile
```

**동작:**
1. `package.yaml`의 `spec.dependencies`를 읽는다.
2. 각 Bundle Package Ref에 대해 레지스트리에서 메타데이터를 조회한다.
3. 버전 해석(semver 범위 → 정확한 버전)을 수행한다.
4. 의존성 트리를 구성하고 충돌을 해결한다.
5. tarball을 다운로드하고 integrity를 검증한다.
6. `<goondanHome>/bundles/<scope>/<name>/<version>/`에 압축 해제한다.
7. `packages.lock.yaml`을 생성/업데이트한다.

### 13.3 의존성 추가

```bash
# 패키지 추가 (최신 버전)
gdn package add @goondan/base

# 특정 버전 추가
gdn package add @goondan/base@1.2.0

# 정확한 버전 고정
gdn package add @goondan/base@1.2.0 --exact

# semver 범위로 추가 (기본)
gdn package add @goondan/base@^1.0.0
```

**동작:**
1. 레지스트리에서 패키지 메타데이터를 조회한다.
2. `package.yaml`의 `spec.dependencies`에 추가한다.
3. `gdn package install`을 실행한다.

### 13.4 의존성 제거

```bash
gdn package remove @goondan/base
```

**동작:**
1. `package.yaml`에서 해당 의존성을 제거한다.
2. 더 이상 필요하지 않은 패키지를 정리한다.
3. `packages.lock.yaml`을 업데이트한다.

### 13.5 의존성 업데이트

```bash
# 모든 패키지 업데이트 (semver 범위 내)
gdn package update

# 특정 패키지 업데이트
gdn package update @goondan/base

# 최신 버전으로 업데이트 (semver 무시)
gdn package update --latest
```

### 13.6 설치된 패키지 목록

```bash
# 직접 의존성만
gdn package list

# 의존성 트리
gdn package list --depth 1

# 모든 의존성
gdn package list --all
```

**출력 예시:**
```
@goondan/base@1.0.0
├── @goondan/core-utils@0.5.2
└── @goondan/common@1.0.0
@goondan/slack-toolkit@2.1.0
└── @goondan/base@1.0.0 (deduped)
```

### 13.7 패키지 발행

```bash
# 패키지 발행
gdn package publish

# 베타 태그로 발행
gdn package publish --tag beta

# 비공개 패키지로 발행
gdn package publish --access restricted

# 시뮬레이션 (실제 발행 안 함)
gdn package publish --dry-run
```

**발행 절차:**
1. `package.yaml` 검증
2. `spec.dist` 디렉터리 존재 확인
3. `spec.resources`에 명시된 파일 존재 확인
4. 구성 검증 (`gdn validate`)
5. tarball 생성 (`spec.dist` 디렉터리 기준)
6. integrity hash(sha512) 계산
7. 레지스트리에 업로드

### 13.8 레지스트리 로그인/로그아웃

```bash
# 로그인
gdn package login
gdn package login --registry https://my-registry.example.com
gdn package login --scope @myorg

# 로그아웃
gdn package logout
gdn package logout --registry https://my-registry.example.com
```

### 13.9 패키지 정보 조회

```bash
gdn package info @goondan/base
gdn package info @goondan/base@1.0.0
```

**출력 예시:**
```
@goondan/base@1.0.0

Description: Goondan 기본 Tool/Extension 번들
Published:   2026-01-15T10:30:00Z

dist-tags:
  latest: 1.0.0
  beta:   2.0.0-beta.1

versions:
  1.0.0, 0.9.0, 0.8.0

dependencies:
  @goondan/core-utils: ^0.5.0

resources:
  - tools/fileRead/tool.yaml
  - extensions/skills/extension.yaml

tarball: https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz
integrity: sha512-AAAA...
```

### 13.10 로컬 tarball 생성

```bash
# tarball 생성
gdn package pack

# 출력 경로 지정
gdn package pack --out ./dist
```

**출력:**
```
Created: @goondan-base-1.0.0.tgz (12.5 KB)
```

### 13.11 캐시 관리

```bash
# 캐시 정보
gdn package cache info

# 캐시 정리
gdn package cache clean

# 특정 패키지 캐시 삭제
gdn package cache clean @goondan/base
```

**캐시 위치:** `<goondanHome>/bundles/`

### 13.12 명령어 요약

| 명령어 | 설명 |
|--------|------|
| `gdn package install` | 의존성 설치 |
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package remove <ref>` | 의존성 제거 |
| `gdn package update [ref]` | 의존성 업데이트 |
| `gdn package list` | 설치된 패키지 목록 |
| `gdn package publish` | 패키지 발행 |
| `gdn package login` | 레지스트리 로그인 |
| `gdn package logout` | 레지스트리 로그아웃 |
| `gdn package info <ref>` | 패키지 정보 조회 |
| `gdn package pack` | 로컬 tarball 생성 |
| `gdn package cache` | 캐시 관리 |

자세한 CLI 스펙은 `docs/specs/cli.md`를 참조한다

---

## 14. 레지스트리 설정

### 14.1 .goondanrc
```yaml
registry: "https://registry.goondan.io"
# 프라이빗 레지스트리
# registry: "https://my-private-registry.example.com"
# token: "${GOONDAN_REGISTRY_TOKEN}"
```

### 14.2 환경 변수
```bash
GOONDAN_REGISTRY=https://registry.goondan.io
GOONDAN_REGISTRY_TOKEN=your-auth-token
```

### 14.3 스코프별 레지스트리
```yaml
# .goondanrc
registry: "https://registry.goondan.io"
scopedRegistries:
  "@myorg": "https://my-org-registry.example.com"
```
