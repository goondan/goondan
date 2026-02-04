# Goondan Bundle Package 요구사항 (Git 기반)

본 문서는 Goondan 생태계에서 **Bundle Package를 Git 기반으로 식별/다운로드/의존성 해석**하기 위한 요구사항을 정의한다. 
핵심 목적은 **npm 패키지 개념과 Goondan Bundle Package 개념의 혼선을 제거**하고, Bundle Package 자체(스크립트, YAML 정의, 비-Node 런타임 코드 등)를 **그대로 배포/사용**하는 것이다.

Bundle Package는 기존 문서에서 “Bundle”로 불리던 **배포/패키징 단위**이며, **Bundle 자체는 YAML+코드 폴더 트리**를 의미한다.  
하위 호환을 위해 `bundle.yaml`의 `kind: Bundle` 표기는 유지할 수 있다.

---

## 1. 목표

1. Bundle Package는 **실행 가능한 리소스 묶음**(Tool/Extension/Connector 정의 + 스크립트 파일)을 의미한다.
2. npm은 **선택적 호스팅/메타데이터**로만 사용 가능하며, **필수 의존성 관리 도구가 아니다**.
3. Bundle Package는 **Git 경로**로 식별되고, **bundle.yaml이 있는 폴더 전체가 다운로드**되어야 한다.
4. `spec.include`는 **최종 Config를 구성할 YAML 목록**을 정의하며, **다운로드 범위를 제한하지 않는다**.

---

## 2. 용어

- **Bundle Package Root**: `bundle.yaml`이 위치한 폴더
- **Bundle Package Ref**: Bundle Package를 가리키는 식별자(예: `github.com/goondan/goondan/packages/base`)
- **Include List**: 최종 Config로 **로딩할 YAML 파일 경로 목록**
- **Dependency**: 다른 Bundle Package를 참조하는 Bundle Package Ref 목록

---

## 3. Bundle Package Ref 형식

기본 형식(권장):
```
<host>/<org>/<repo>/<path>@<ref?>
```

- `<host>`: 예: `github.com`
- `<org>/<repo>`: Git 리포지토리
- `<path>`: 리포 내 Bundle Package Root 경로 (생략 불가, root 번들은 `/`로 취급 가능)
- `@<ref>`: 선택. tag/branch/commit SHA

예시:
```
github.com/goondan/goondan/packages/base
github.com/goondan/goondan/packages/base@v0.3.0
github.com/goondan/sample/foo/bar@a1b2c3d
```

규칙:
1. `@ref`가 없으면 리포의 기본 브랜치를 사용한다(MAY).
2. Bundle Package Ref는 **Git fetch 가능한 주소**로 해석되어야 한다(MUST).

---

## 4. 다운로드 및 캐시 규칙

1. Bundle Package를 해석할 때, **Bundle Package Root 전체 디렉터리 트리를 다운로드**한다(MUST).
2. `spec.include`는 **다운로드 범위를 제한하지 않는다**(MUST).
3. 다운로드 경로는 충돌을 방지하기 위해 **host/org/repo/ref/path**를 포함해야 한다(SHOULD).

권장 로컬 경로 예시:
```
state/bundles/git/<host>/<org>/<repo>/<ref>/<path>/
```

---

## 5. bundle.yaml 스키마 (Bundle Package 매니페스트)

```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: base
spec:
  dependencies:
    - github.com/goondan/foo-bar
    - github.com/goondan/sample/foo/bar@v1.2.0
  include:
    - dist/tools/fileRead/tool.yaml
    - dist/extensions/skills/extension.yaml
```

필수 규칙:
1. `kind: Bundle`은 필수이다(MUST).
2. `metadata.name`은 Bundle Package의 식별명으로 사용된다(MUST).
3. `spec.dependencies`는 Bundle Package Ref 목록이다(MAY).
4. `spec.include`는 **최종 Config에 포함할 YAML 목록**이다(MUST).

---

## 6. include 규칙 (핵심)

1. `spec.include`에 명시된 YAML만 **최종 Config에 병합**된다(MUST).
2. `spec.include`에 포함되지 않은 파일도 **Bundle Package Root에 있는 한 다운로드**된다(MUST).
3. `spec.include` 경로는 **Bundle Package Root 기준 상대 경로**로 해석한다(MUST).
4. `spec.include`에 지정된 파일이 없으면 오류로 처리한다(MUST).
5. Git-only 배포에서는 `dist/` 빌드 산출물을 **리포에 포함**하고, include가 dist를 가리키도록 구성한다(SHOULD).

---

## 7. 리소스 YAML 규칙

Tool/Extension/Connector 등 리소스 정의 파일은 기존 Config 스펙과 동일하게 해석한다. 
단, `spec.entry` 경로는 **Bundle Package Root 기준 상대 경로**로 해석한다(MUST).

예시 (Tool):
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: fileRead
spec:
  runtime: node
  entry: "./dist/tools/fileRead/index.js"
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
  entry: "./dist/extensions/skills/index.js"
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

## 8. 구성 병합/로드 순서

1. Bundle Package를 로드하면 `spec.dependencies`를 **재귀적으로 해석**한다(MUST).
2. 로드 순서는 **의존성 → 현재 Bundle Package** 순으로 처리한다(SHOULD).
3. 하나의 Bundle Package 안에서는 `spec.include`에 나열된 **순서대로 리소스를 로드**한다(SHOULD).
4. 동일 Kind/name이 중복될 경우, **후순위 로드가 덮어쓴다**(정책 선택 가능). 덮어쓰기 허용 여부는 런타임 정책에 따른다(MAY).

---

## 9. 이름 충돌과 참조 방식

- 이름이 유일하면 단순 참조:
```
Tool/fileRead
Extension/skills
```

- 이름이 충돌하면 `bundle`을 지정:
```yaml
extensions:
  - extensionRef: Extension/skills
  - bundle: github.com/goondan/goondan/packages/base
    extensionRef: Extension/skills
```

```yaml
tools:
  - toolRef: Tool/fileRead
```

규칙:
1. `bundle`을 지정하면 해당 Bundle Package Root에서만 리소스를 탐색한다(MUST).
2. `bundle`이 없으면 모든 로드된 리소스 네임스페이스에서 **유일 매칭**을 요구한다(MUST).

---

## 10. 무결성 및 재현성

1. Bundle Package 다운로드 후 **Fingerprint(해시)**를 계산한다(SHOULD).
2. `bundle lock`은 Bundle Package Ref와 해시/커밋 정보를 저장해 **재현 가능한 로딩**을 보장한다(SHOULD).
3. `bundle verify`는 저장된 fingerprint와 실제 파일 해시를 비교한다(SHOULD).

---

## 11. 상세 예시

### 11.1 Bundle Package 리포 구조
```
repo: github.com/goondan/goondan
path: /base

/base
  bundle.yaml
  tools/
    fileRead/
      tool.yaml
      index.js
  extensions/
    skills/
      extension.yaml
      index.js
  tools_py/
    sum/
      tool.yaml
      sum.py
```

### 11.2 bundle.yaml
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Bundle
metadata:
  name: base
spec:
  dependencies:
    - github.com/goondan/foo-bar@v0.2.0
  include:
    - dist/tools/fileRead/tool.yaml
    - dist/extensions/skills/extension.yaml
    - tools_py/sum/tool.yaml
```

### 11.3 tool.yaml / extension.yaml
```yaml
# dist/tools/fileRead/tool.yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: fileRead
spec:
  runtime: node
  entry: "./dist/tools/fileRead/index.js"
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
  entry: "./dist/extensions/skills/index.js"
```

```yaml
# tools_py/sum/tool.yaml
apiVersion: agents.example.io/v1alpha1
kind: Tool
metadata:
  name: pySum
spec:
  runtime: python
  entry: "./tools_py/sum/sum.py"
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

### 11.4 Agent에서 Bundle Package 사용
```yaml
apiVersion: agents.example.io/v1alpha1
kind: Agent
metadata:
  name: default
spec:
  extensions:
    - extensionRef: Extension/skills
    - bundle: github.com/goondan/goondan/packages/base
      extensionRef: Extension/skills
  tools:
    - toolRef: Tool/fileRead
    - toolRef: Tool/pySum
```

### 11.5 동작 요약
1. `github.com/goondan/goondan/packages/base`를 git으로 가져온다.
2. `/base` 폴더 전체를 다운로드한다.
3. `bundle.yaml`을 읽고 `include` 목록에 있는 YAML만 Config에 병합한다.
4. 스크립트(`index.js`, `sum.py`)는 Bundle Package Root 기준으로 `entry`를 resolve한다.

---

## 12. 비목표

- npm 패키지를 **개발 필수 요소로 강제하지 않는다**.
- Bundle Package는 “빌드 결과물(dist)만 배포”하는 패키징 모델이 아니다.
