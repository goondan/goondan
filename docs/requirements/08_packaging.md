## 8. Config 구성 단위와 패키징

### 8.1 구성 파일 분할과 로딩

1. 구현은 구성 파일을 폴더/파일 단위로 분할 관리할 수 있어야 한다(MUST).
2. 로더는 단일 파일, 디렉터리, 다중 YAML 문서(`---`)를 처리해야 한다(MUST).
3. 로딩 결과는 결정론적이어야 하며, 동일 입력에서 동일 리소스 집합을 생성해야 한다(MUST).

### 8.2 Package 기본 개념

Package는 재사용 가능한 배포 단위다. 다음 아티팩트를 포함할 수 있다.

- 리소스 YAML
- 프롬프트 파일
- 도구/확장/커넥터 스크립트
- 스킬 번들

Package 매니페스트는 패키지 메타데이터, 의존성, 배포 대상 리소스 목록을 정의해야 한다(MUST).

### 8.3 의존성 해석 규칙

1. 의존성 그래프는 순환 참조 없이 DAG를 구성해야 한다(MUST).
2. 버전 제약(semver range) 해석 결과는 lockfile 생성 시 고정되어야 한다(MUST).
3. 동일 패키지의 상이한 버전 요구가 충돌하면 설치를 중단하고 충돌 보고를 반환해야 한다(MUST).
4. 충돌 자동 우회(임의 최신 버전 선택)는 기본 동작이 되어서는 안 된다(MUST NOT).

### 8.4 values 주입과 병합 우선순위

values 병합 우선순위는 다음 순서를 따라야 한다(MUST).

1. 패키지 기본값
2. 상위 패키지 override
3. 사용자 override(프로젝트 로컬)

추가 규칙:

1. 객체는 재귀 병합한다(SHOULD).
2. 배열은 기본 교체(replace) 정책을 사용한다(SHOULD).
3. 민감값은 values 직접 입력 대신 ValueSource/SecretRef를 사용해야 한다(SHOULD).

### 8.5 Lockfile과 재현성

1. 설치 결과를 재현하기 위해 lockfile을 생성해야 한다(MUST).
2. lockfile에는 해석된 버전, 소스(ref/digest), 의존성 트리를 포함해야 한다(MUST).
3. CI/배포 환경은 lockfile 기반 설치 모드를 제공해야 한다(SHOULD).

### 8.6 레지스트리/캐시 요구사항

1. 패키지 레지스트리에서 아티팩트 메타데이터와 tarball 다운로드를 지원해야 한다(MUST).
2. 다운로드 아티팩트는 digest 검증을 수행해야 한다(MUST).
3. 로컬 캐시는 System State Root 하위에 저장하고, 동일 digest 재다운로드를 회피해야 한다(SHOULD).
4. 인증이 필요한 레지스트리는 토큰 기반 접근을 지원해야 한다(SHOULD).

### 8.7 보안 및 검증

1. 패키지 설치 시 schema 검증을 수행하고 실패 시 로드를 중단해야 한다(MUST).
2. 패키지가 허용되지 않은 경로(예: `../`)를 참조하면 거부해야 한다(MUST).
3. Runtime 실행 전에 패키지 의존성 검증 결과를 사용자에게 명확한 오류 코드와 함께 제공해야 한다(MUST).

### 8.8 패키지 게시/운영 라이프사이클

#### 8.8.1 게시(Publish)

1. 게시 전 `goondan.yaml`의 Package 문서 스키마 검증과 리소스 구성 검증(`gdn validate`)을 통과해야 한다(MUST).
2. 게시 시 tarball 생성과 SHA512 integrity hash 계산을 수행해야 한다(MUST).
3. dist-tag(latest, beta 등) 지정을 지원해야 한다(SHOULD).
4. `--dry-run` 모드로 게시 전 검증만 수행할 수 있어야 한다(SHOULD).

#### 8.8.2 비게시(Unpublish) / 폐기(Deprecate)

1. 게시된 패키지 버전의 비게시를 지원해야 한다(MUST).
2. 비게시 대신 폐기(deprecate) 표시로 다운로드는 허용하되 경고를 제공하는 모드를 지원해야 한다(SHOULD).
3. 다른 패키지가 의존하는 버전의 비게시 시 경고를 제공해야 한다(SHOULD).

#### 8.8.3 접근 제어

1. 패키지는 공개(public) 또는 제한(restricted) 접근 수준을 가져야 한다(MUST).
2. 제한 패키지의 게시/설치는 인증된 요청만 허용해야 한다(MUST).

### 8.9 레지스트리 인증

1. 레지스트리는 Bearer Token 기반 인증을 지원해야 한다(MUST).
2. 인증 토큰은 프로젝트 설정 파일(`.goondanrc`) 또는 환경 변수(`GOONDAN_REGISTRY_TOKEN`)로 제공할 수 있어야 한다(MUST).
3. scope별 레지스트리 분리 구성을 지원해야 한다(SHOULD).
4. 인증 토큰은 설정 파일에 평문 저장하지 않는 것을 권장한다(SHOULD).

### 8.10 Package 스펙 연동

구체적인 레지스트리 API, `goondan.yaml` Package 문서, `goondan.lock.yaml` lockfile 형식, CLI 명령(`gdn package *`)은 구현 스펙 `docs/specs/bundle_package.md`를 따른다.
