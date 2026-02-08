# Goondan Package 스펙 (v1.0)

본 문서는 Goondan 생태계에서 **Package를 정의/배포/의존성 해석**하기 위한 스펙을 정의한다.

Package는 Goondan 프로젝트의 **최상위 리소스**이다. 모든 goondan 프로젝트는 `goondan.yaml` 파일로 정의되며, Package 문서는 이 파일의 선택적 첫 번째 문서로 프로젝트의 메타데이터와 배포 구성을 선언한다.

---

## 1. 핵심 개념

### 1.1 Package = 프로젝트 루트

Package는 goondan 프로젝트의 **루트 개념**이다.

- **모든 리소스**(Swarm, Agent, Model, Tool, Extension, Connector, Connection 등)는 Package에 속한다
- Package 문서가 없는 `goondan.yaml`도 유효하다 — 단순한 리소스 번들로 동작 (하위 호환)
- Package 문서가 있으면 의존성 해석, 배포, 버전 관리가 가능해진다

### 1.2 goondan.yaml 통합 구조

`goondan.yaml`은 **다중 YAML 문서**로 구성된다. 첫 번째 문서가 `kind: Package`이면 Package 메타데이터로 해석하고, 이후 문서들은 리소스로 해석한다.

```yaml
# goondan.yaml — Package가 첫 번째 문서 (선택)
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: my-coding-swarm
  version: "1.0.0"
spec:
  dependencies:
    - "@goondan/base"
  exports:
    - tools/file/tool.yaml
    - swarm.yaml
  dist:
    - dist/
---
# 이하 리소스 정의
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
    - { kind: Agent, name: coder }
```

### 1.3 gdn-package.yaml 폐기

> **v1.0 Breaking Change**: 기존 `gdn-package.yaml` (또는 `package.yaml`) 파일은 폐기된다. Package 정보는 `goondan.yaml`의 첫 번째 문서로 통합한다.

마이그레이션:
1. `gdn-package.yaml`의 Package 문서를 `goondan.yaml` 첫 번째 문서로 이동
2. `gdn-package.yaml` 파일 삭제
3. `packages.lock.yaml` → `goondan.lock.yaml`로 이름 변경

---

## 2. 용어

| 용어 | 정의 |
|------|------|
| **Package** | goondan 프로젝트의 최상위 리소스. 메타데이터, 의존성, export 선언을 포함 |
| **Package Root** | `goondan.yaml`이 위치한 폴더 |
| **Package Ref** | Package를 가리키는 식별자 (예: `@goondan/base`, `@goondan/base@1.2.0`) |
| **Export List** | 패키지 배포 시 포함할 리소스 YAML 경로 목록 |
| **Dependency** | 다른 Package를 참조하는 Package Ref 목록 |
| **Registry** | Package를 호스팅하는 서버 (예: `https://registry.goondan.io`) |

---

## 3. Package 스키마

### 3.1 전체 스키마

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: <string>          # MUST — 패키지 식별명
  version: <semver>        # MUST for publish — semver 형식
  annotations:             # MAY
    description: <string>
spec:
  access: public           # MAY — 'public' | 'restricted', 기본값 'public'
  dependencies:            # MAY — Package Ref 목록
    - "@goondan/base"
    - "@myorg/toolkit@^2.0.0"
  exports:                 # MAY — 배포 시 포함할 리소스 YAML 경로
    - tools/bash/tool.yaml
    - connectors/telegram/connector.yaml
  dist:                    # MAY — tarball에 포함할 빌드 아티팩트 디렉터리
    - dist/
```

### 3.2 필드 규칙

| 필드 | 필수 | 설명 |
|------|------|------|
| `metadata.name` | MUST | Package의 식별명. Registry 기반 배포 시 scope 포함 가능 (예: `@goondan/base`) |
| `metadata.version` | MUST (publish 시) | semver 형식. 로컬 개발에서는 생략 가능 |
| `spec.access` | MAY | `'public'` (기본) 또는 `'restricted'` |
| `spec.dependencies` | MAY | Package Ref 문자열 배열. 없으면 의존성 없음 |
| `spec.exports` | MAY | 배포할 리소스 YAML 경로 배열. 없으면 배포 불가 (consumer-only) |
| `spec.dist` | MAY | tarball에 포함할 빌드 아티팩트 디렉터리 배열 |

### 3.3 Package 문서 위치 규칙

1. Package 문서는 `goondan.yaml`의 **첫 번째 YAML 문서**에만 위치할 수 있다(MUST).
2. 두 번째 이후 문서에 `kind: Package`가 있으면 검증 오류이다(MUST).
3. 첫 번째 문서가 `kind: Package`가 아니면 Package 없는 단순 리소스 번들로 취급한다(MUST).
4. 하나의 `goondan.yaml`에는 최대 하나의 Package 문서만 존재할 수 있다(MUST).

### 3.4 하위 호환

Package 문서 없이 리소스만 있는 `goondan.yaml`은 그대로 동작한다(MUST).

```yaml
# Package 없는 goondan.yaml — 하위 호환
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: main }
```

이 경우:
- 의존성 해석 없음
- `gdn package *` 명령어 사용 불가
- `gdn run` / `gdn validate`는 정상 동작

---

## 4. Package Ref 형식

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

## 5. Exports 규칙

`spec.exports`는 패키지 배포 시 **외부에 공개할 리소스 YAML 목록**을 정의한다.

1. `spec.exports`에 명시된 YAML만 **소비자의 Config에 병합**된다(MUST).
2. `spec.exports`에 포함되지 않은 파일도 **`spec.dist` 폴더 안에 있으면 다운로드**된다(MUST). 이는 코드 파일(`index.js`)이 YAML에서 참조될 수 있기 때문이다.
3. `spec.exports` 경로는 **`spec.dist` 기준 상대 경로**로 해석한다(MUST).
4. `spec.exports`가 없으면 이 패키지는 **리소스를 export하지 않는 consumer-only 프로젝트**이다(MUST).
5. 패키지는 **사용 가능한 모든 리소스를 export**해야 한다(SHOULD). 인증이 필요한 리소스라도 패키지에서 제외해서는 안 되며, **사용처에서 적절한 인증 리소스를 구성**해야 한다(MUST).

### Exports vs 인라인 리소스

```yaml
# goondan.yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@goondan/base"
  version: "1.0.0"
spec:
  exports:                              # 이것들만 배포됨
    - tools/bash/tool.yaml
    - connectors/telegram/connector.yaml
  dist:
    - dist/
---
# 이 인라인 리소스는 로컬에서만 사용됨 (배포 안 됨)
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: dev-test
spec:
  entrypoint: { kind: Agent, name: test-agent }
```

---

## 6. 패키지 레지스트리

### 6.1 레지스트리 개요

Goondan 패키지 레지스트리는 Package의 메타데이터와 tarball을 호스팅하는 HTTP 서버이다.

기본 레지스트리:
```
https://registry.goondan.io
```

사용자는 `.goondanrc` 또는 환경 변수로 커스텀 레지스트리를 지정할 수 있다(MAY).

### 6.2 레지스트리 API

#### 6.2.1 패키지 메타데이터 조회

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
      "dependencies": {},
      "deprecated": "",
      "dist": {
        "tarball": "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz",
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

#### 6.2.2 특정 버전 조회

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
    "exports": [
      "dist/tools/bash/tool.yaml",
      "dist/connectors/telegram/connector.yaml"
    ],
    "runtime": "node"
  }
}
```

#### 6.2.3 Tarball 다운로드

```
GET /<scope>/<name>/-/<name>-<version>.tgz
```

Tarball은 Package Root 전체를 포함하는 gzip 압축 tar 아카이브이다.

#### 6.2.4 패키지 비게시(Unpublish)

```
DELETE /<scope>/<name>/<version>
```

인증 필수(MUST). 해당 버전을 레지스트리에서 제거한다. 전체 패키지를 비게시하려면 버전을 생략한다.

```
DELETE /<scope>/<name>
```

#### 6.2.5 패키지 폐기(Deprecate)

```
PUT /<scope>/<name>/<version>/deprecate
Content-Type: application/json

{
  "message": "Use v2.0.0 instead"
}
```

인증 필수(MUST). 빈 `message`(`""`)를 전달하면 폐기 표시를 해제한다.

### 6.3 인증

레지스트리는 Bearer Token 기반 인증을 지원해야 한다(MUST).

```
Authorization: Bearer <token>
```

인증 토큰은 프로젝트 설정 파일(`.goondanrc`) 또는 환경 변수(`GOONDAN_REGISTRY_TOKEN`)로 제공할 수 있어야 한다(MUST).

**보안 권장사항**:
- 인증 토큰은 설정 파일에 평문으로 직접 저장하지 않는 것을 권장한다(SHOULD).
- 환경 변수 참조 패턴(`${GOONDAN_REGISTRY_TOKEN}`)을 사용하는 것을 권장한다(SHOULD).

```yaml
# .goondanrc - 권장: 환경 변수 참조
registries:
  "https://registry.goondan.io":
    token: "${GOONDAN_REGISTRY_TOKEN}"
```

---

## 7. 다운로드 및 캐시 규칙

1. Package를 해석할 때, **Package Root 전체 디렉터리 트리를 다운로드**한다(MUST).
2. `spec.exports`는 **다운로드 범위를 제한하지 않는다**(MUST).
3. 다운로드 경로는 충돌을 방지하기 위해 **scope/name/version**을 포함해야 한다(SHOULD).
4. 무결성 검증을 위해 **integrity hash(sha512)**를 확인해야 한다(MUST).

---

## 8. 리소스 YAML 규칙

Tool/Extension/Connector 등 리소스 정의 파일은 기존 Config 스펙과 동일하게 해석한다.
단, `spec.entry` 경로는 **`spec.dist` 기준 상대 경로**로 해석한다(MUST).

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

---

## 9. 구성 병합/로드 순서

1. `goondan.yaml`을 파싱할 때, 첫 번째 문서가 `kind: Package`이면 Package 메타데이터로 추출하고 나머지를 리소스로 처리한다(MUST).
2. Package의 `spec.dependencies`를 **재귀적으로 해석**한다(MUST).
3. 로드 순서는 **의존성 → 현재 Package 인라인 리소스** 순으로 처리한다(SHOULD).
4. 하나의 Package 안에서는 `spec.exports`에 나열된 **순서대로 리소스를 로드**한다(SHOULD).
5. 인라인 리소스(goondan.yaml 내부)는 export 리소스 이후에 로드된다(SHOULD).
6. 동일 Kind/name이 중복될 경우, **후순위 로드가 덮어쓴다**(정책 선택 가능). 덮어쓰기 허용 여부는 런타임 정책에 따른다(MAY).

### 9.1 의존성 충돌 해결 정책

1. 동일 패키지의 상이한 버전 요구가 충돌하면 **설치를 중단하고 충돌 보고를 반환**해야 한다(MUST).
2. 충돌 자동 우회(임의 최신 버전 선택)는 **기본 동작이 되어서는 안 된다**(MUST NOT).
3. 의존성 그래프는 **순환 참조 없이 DAG를 구성**해야 한다(MUST). 순환 참조가 감지되면 설치를 거부해야 한다(MUST).

충돌 보고 예시:
```
ERROR: Version conflict for @goondan/core-utils
  - @goondan/base@1.0.0 requires @goondan/core-utils@^0.5.0
  - @myorg/toolkit@2.0.0 requires @goondan/core-utils@^1.0.0
Resolution: Manually align version ranges or use explicit overrides.
```

### 9.2 values 병합 우선순위

values 병합 우선순위는 다음 순서를 따라야 한다(MUST). 후순위가 선순위를 덮어쓴다.

1. **패키지 기본값**: Package 내부에 정의된 기본 values
2. **상위 패키지 override**: 상위(의존하는) Package에서 지정한 override
3. **사용자 override**: 프로젝트 로컬(Package Root)에서 지정한 override

추가 규칙:
- 객체는 재귀 병합(deep merge)한다(SHOULD).
- 배열은 기본 교체(replace) 정책을 사용한다(SHOULD).
- 민감값은 values에 직접 입력하지 않고 ValueSource/SecretRef를 사용해야 한다(SHOULD).

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
    resolved: "https://registry.goondan.io/@goondan/base/-/base-1.0.0.tgz"
    integrity: "sha512-AAAA..."
    dependencies:
      "@goondan/core-utils": "0.5.2"
  "@goondan/core-utils@0.5.2":
    version: "0.5.2"
    resolved: "https://registry.goondan.io/@goondan/core-utils/-/core-utils-0.5.2.tgz"
    integrity: "sha512-BBBB..."
```

### 11.3 Lockfile 규칙

1. Package 다운로드 후 **integrity hash(sha512)**를 검증한다(MUST).
2. `goondan.lock.yaml`은 Package Ref와 정확한 버전/integrity 정보를 저장해 **재현 가능한 로딩**을 보장한다(SHOULD).
3. `--frozen-lockfile` 옵션으로 설치 시, lockfile과 불일치하면 설치를 거부해야 한다(MUST).

---

## 12. 보안 및 검증

패키지 설치 및 로드 시 다음 보안 규칙을 적용해야 한다.

### Schema 검증

1. `goondan.yaml`의 Package 문서 및 리소스 YAML의 **schema 검증을 수행**하고, 실패 시 로드를 중단해야 한다(MUST).
2. 알 수 없는 `kind` 또는 필수 필드 누락은 오류로 처리한다(MUST).

### 경로 탐색 방지

1. `spec.exports`, `spec.dist`, 리소스의 `spec.entry` 등에서 **상위 디렉터리 참조(`../`)를 포함하는 경로는 거부**해야 한다(MUST).
2. 절대 경로 참조도 거부해야 한다(MUST). 모든 경로는 Package Root 또는 `spec.dist` 기준 상대 경로여야 한다.

### 의존성 검증 오류 코드

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

## 13. 상세 예시

### 13.1 라이브러리 패키지 (@goondan/base)

배포용 패키지 — exports가 있어 다른 프로젝트에서 의존성으로 사용 가능.

```yaml
# goondan.yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: "@goondan/base"
  version: "1.0.0"
  annotations:
    description: "Goondan 기본 Tool, Extension, Connector 번들"
spec:
  exports:
    - tools/bash/tool.yaml
    - tools/http-fetch/tool.yaml
    - tools/json-query/tool.yaml
    - tools/file-system/tool.yaml
    - tools/text-transform/tool.yaml
    - connectors/telegram/connector.yaml
    - connectors/slack/connector.yaml
    - connectors/cli/connector.yaml
    - connectors/discord/connector.yaml
    - connectors/github/connector.yaml
    - extensions/basicCompaction/extension.yaml
    - extensions/logging/extension.yaml
  dist:
    - dist/
```

디렉터리 구조:
```
@goondan/base/
├── goondan.yaml          # Package + (인라인 리소스 없음)
├── goondan.lock.yaml     # 의존성 lockfile (의존성 없으면 생략)
├── package.json          # npm 패키지 설정 (Node.js 빌드용)
├── src/                  # 소스 코드
│   └── tools/bash/index.ts
├── dist/                 # 빌드 아티팩트 (spec.dist)
│   ├── tools/bash/
│   │   ├── tool.yaml
│   │   └── index.js
│   └── connectors/telegram/
│       ├── connector.yaml
│       └── index.js
```

### 13.2 애플리케이션 프로젝트 (consumer)

의존성을 소비하고 자체 리소스를 정의하는 프로젝트 — exports 없음.

```yaml
# goondan.yaml
apiVersion: agents.example.io/v1alpha1
kind: Package
metadata:
  name: my-coding-swarm
  version: "0.0.1"
spec:
  dependencies:
    - "@goondan/base"
---
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: planner
spec:
  modelConfig:
    modelRef: { kind: Model, name: claude }
  tools:
    - { kind: Tool, name: bash }
    - { kind: Tool, name: file-system }
---
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: planner }
  agents:
    - { kind: Agent, name: planner }
---
apiVersion: agents.example.io/v1alpha1
kind: Connection
metadata:
  name: cli
spec:
  connectorRef: { kind: Connector, name: cli, package: "@goondan/base" }
  ingress:
    rules:
      - route: {}
```

### 13.3 Package 없는 단순 프로젝트 (하위 호환)

의존성 없이 모든 리소스를 인라인으로 정의하는 가장 단순한 형태.

```yaml
# goondan.yaml — kind: Package 없음
apiVersion: agents.example.io/v1alpha1
kind: Model
metadata:
  name: claude
spec:
  provider: anthropic
  name: claude-sonnet-4-5
---
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: chatbot
spec:
  modelConfig:
    modelRef: { kind: Model, name: claude }
---
apiVersion: agents.example.io/v1alpha1
kind: Swarm
metadata:
  name: default
spec:
  entrypoint: { kind: Agent, name: chatbot }
```

### 13.4 동작 요약

1. `goondan.yaml`을 파싱한다
2. 첫 번째 문서가 `kind: Package`이면 Package 메타데이터를 추출한다
3. `spec.dependencies`가 있으면 각 Package Ref를 레지스트리에서 해석한다
4. 의존성 Package의 `spec.exports`에 명시된 리소스를 Config에 병합한다
5. 현재 `goondan.yaml`의 인라인 리소스를 Config에 병합한다
6. 스크립트(`index.js`)는 리소스 YAML에서의 상대 경로 기준으로 `entry`를 resolve한다

---

## 14. CLI 명령어

### 14.1 개요

Goondan CLI(`gdn`)는 Package를 관리하기 위한 `package` 하위 명령어를 제공한다.
모든 `gdn package *` 명령어는 `goondan.yaml`의 Package 문서를 읽고 쓴다.

### 14.2 의존성 설치

```bash
# goondan.yaml의 spec.dependencies 설치
gdn package install

# lockfile 기준으로 설치 (CI 환경용)
gdn package install --frozen-lockfile
```

**동작:**
1. `goondan.yaml`에서 Package 문서의 `spec.dependencies`를 읽는다
2. 각 Package Ref에 대해 레지스트리에서 메타데이터를 조회한다
3. 버전 해석(semver 범위 → 정확한 버전)을 수행한다
4. 의존성 트리를 구성하고 충돌을 해결한다
5. tarball을 다운로드하고 integrity를 검증한다
6. `<goondanHome>/bundles/<scope>/<name>/<version>/`에 압축 해제한다
7. `goondan.lock.yaml`을 생성/업데이트한다

### 14.3 의존성 추가

```bash
gdn package add @goondan/base
gdn package add @goondan/base@1.2.0
gdn package add @goondan/base@1.2.0 --exact
```

**동작:**
1. 레지스트리에서 패키지 메타데이터를 조회한다
2. `goondan.yaml`의 Package 문서 `spec.dependencies`에 추가한다
3. `gdn package install`을 실행한다

> 만약 `goondan.yaml`에 Package 문서가 없으면 자동 생성한다(SHOULD).

### 14.4 의존성 제거

```bash
gdn package remove @goondan/base
```

**동작:**
1. `goondan.yaml`의 Package 문서에서 해당 의존성을 제거한다
2. 더 이상 필요하지 않은 패키지를 정리한다
3. `goondan.lock.yaml`을 업데이트한다

### 14.5 의존성 업데이트

```bash
gdn package update
gdn package update @goondan/base
gdn package update --latest
```

### 14.6 설치된 패키지 목록

```bash
gdn package list
gdn package list --depth 1
gdn package list --all
```

### 14.7 패키지 발행

```bash
gdn package publish
gdn package publish --tag beta
gdn package publish --access restricted
gdn package publish --dry-run
```

**발행 절차:**
1. `goondan.yaml`에서 Package 문서 검증
2. `spec.exports` 존재 확인 — 없으면 발행 거부
3. `spec.dist` 디렉터리 존재 확인
4. `spec.exports`에 명시된 파일 존재 확인
5. 구성 검증 (`gdn validate`)
6. tarball 생성 (`spec.dist` 디렉터리 + `goondan.yaml` 포함)
7. integrity hash(sha512) 계산
8. 레지스트리에 업로드

### 14.8 패키지 비게시(Unpublish)

```bash
gdn package unpublish @goondan/base@1.0.0
gdn package unpublish @goondan/base
gdn package unpublish @goondan/base@1.0.0 --dry-run
```

### 14.9 패키지 폐기(Deprecate)

```bash
gdn package deprecate @goondan/base@1.0.0 --message "Use v2.0.0 instead"
gdn package deprecate @goondan/base@1.0.0 --message ""
```

### 14.10 레지스트리 로그인/로그아웃

```bash
gdn package login
gdn package login --registry https://my-registry.example.com
gdn package logout
```

### 14.11 패키지 정보 조회

```bash
gdn package info @goondan/base
gdn package info @goondan/base@1.0.0
```

### 14.12 로컬 tarball 생성

```bash
gdn package pack
gdn package pack --out ./dist
```

### 14.13 캐시 관리

```bash
gdn package cache info
gdn package cache clean
gdn package cache clean @goondan/base
```

### 14.14 명령어 요약

| 명령어 | 설명 |
|--------|------|
| `gdn package install` | 의존성 설치 |
| `gdn package add <ref>` | 의존성 추가 |
| `gdn package remove <ref>` | 의존성 제거 |
| `gdn package update [ref]` | 의존성 업데이트 |
| `gdn package list` | 설치된 패키지 목록 |
| `gdn package publish` | 패키지 발행 |
| `gdn package unpublish <ref>` | 패키지 비게시 |
| `gdn package deprecate <ref>` | 패키지 폐기 |
| `gdn package login` | 레지스트리 로그인 |
| `gdn package logout` | 레지스트리 로그아웃 |
| `gdn package info <ref>` | 패키지 정보 조회 |
| `gdn package pack` | 로컬 tarball 생성 |
| `gdn package cache` | 캐시 관리 |

자세한 CLI 스펙은 `docs/specs/cli.md`를 참조한다

---

## 15. 레지스트리 설정

### 15.1 .goondanrc
```yaml
registry: "https://registry.goondan.io"
```

### 15.2 환경 변수
```bash
GOONDAN_REGISTRY=https://registry.goondan.io
GOONDAN_REGISTRY_TOKEN=your-auth-token
```

### 15.3 스코프별 레지스트리

```yaml
# .goondanrc
registry: "https://registry.goondan.io"
scopedRegistries:
  "@myorg": "https://my-org-registry.example.com"
```

**동작 규칙:**
1. `@scope` 패턴에 매칭되는 패키지는 해당 scope의 레지스트리를 우선 사용해야 한다(SHOULD).
2. 매칭되는 scope가 없으면 기본 레지스트리(`registry`)를 사용한다.
3. scope별 레지스트리 라우팅은 설치(`install`/`add`), 게시(`publish`), 조회(`info`) 모두에 적용된다.
