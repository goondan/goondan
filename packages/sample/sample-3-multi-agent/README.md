# Python Hello World 프로젝트 👋

Python 프로그래밍의 첫 걸음을 위한 간단한 Hello World 프로젝트입니다.

## 📝 프로젝트 소개

이 프로젝트는 Python의 기본 문법을 배우고 첫 번째 프로그램을 실행해보는 것을 목표로 합니다. "Hello, World!"를 출력하는 간단한 프로그램으로, Python 프로그래밍의 시작점이 됩니다.

## ✨ 기능

- 콘솔에 "Hello, World!" 메시지 출력
- Python 기본 문법 학습
- 프로그램 실행 방법 이해

## 🔧 요구사항

프로젝트를 실행하기 위해 다음이 필요합니다:

- **Python 3.6 이상** (권장: Python 3.8 이상)
- 텍스트 에디터 또는 IDE (예: VS Code, PyCharm, IDLE)

### Python 설치 확인

터미널 또는 명령 프롬프트에서 다음 명령어를 실행하여 Python이 설치되어 있는지 확인하세요:

```bash
python --version
```

또는

```bash
python3 --version
```

Python 버전이 표시되면 정상적으로 설치된 것입니다.

## 📦 설치

1. **저장소 클론** (Git을 사용하는 경우):
   ```bash
   git clone <repository-url>
   cd python-hello-world
   ```

2. **파일 다운로드** (Git을 사용하지 않는 경우):
   - 프로젝트 파일을 다운로드하여 원하는 폴더에 저장하세요.

## 🚀 실행 방법

### 방법 1: 터미널/명령 프롬프트 사용

1. 프로젝트 폴더로 이동합니다:
   ```bash
   cd python-hello-world
   ```

2. Python 파일을 실행합니다:
   ```bash
   python hello.py
   ```
   
   또는
   
   ```bash
   python3 hello.py
   ```

3. 결과 확인:
   ```
   Hello, World!
   ```

### 방법 2: IDE 사용

1. IDE(예: VS Code, PyCharm)에서 `hello.py` 파일을 엽니다.
2. 실행 버튼을 클릭하거나 단축키(보통 F5)를 누릅니다.
3. 출력 창에서 결과를 확인합니다.

### 방법 3: Python 대화형 모드

1. 터미널에서 Python을 실행합니다:
   ```bash
   python
   ```

2. 다음 코드를 입력합니다:
   ```python
   print("Hello, World!")
   ```

3. Enter를 누르면 즉시 결과가 표시됩니다.

## 📚 코드 설명

```python
# hello.py
print("Hello, World!")
```

- `print()`: Python의 내장 함수로, 괄호 안의 내용을 화면에 출력합니다.
- `"Hello, World!"`: 출력할 문자열(텍스트)입니다. 큰따옴표(`"`) 또는 작은따옴표(`'`)로 감싸서 표현합니다.

## 🎓 학습 포인트

이 프로젝트를 통해 다음을 배울 수 있습니다:

1. **Python 파일 실행**: `.py` 확장자를 가진 Python 파일을 실행하는 방법
2. **print() 함수**: 화면에 텍스트를 출력하는 기본 함수
3. **문자열**: 텍스트 데이터를 다루는 방법
4. **개발 환경**: Python 개발 환경 설정 및 사용법

## 🔄 다음 단계

Hello World를 성공적으로 실행했다면, 다음 단계로 나아가보세요:

1. **변수 사용하기**:
   ```python
   message = "Hello, World!"
   print(message)
   ```

2. **사용자 입력 받기**:
   ```python
   name = input("이름을 입력하세요: ")
   print(f"Hello, {name}!")
   ```

3. **함수 만들기**:
   ```python
   def greet(name):
       return f"Hello, {name}!"
   
   print(greet("World"))
   ```

## ❓ 문제 해결

### Python을 찾을 수 없다는 오류가 발생하는 경우

- Python이 설치되어 있는지 확인하세요: [python.org](https://www.python.org/downloads/)
- 환경 변수(PATH)에 Python이 추가되어 있는지 확인하세요.
- `python3` 명령어를 대신 사용해보세요.

### 파일을 찾을 수 없다는 오류가 발생하는 경우

- 현재 디렉토리에 `hello.py` 파일이 있는지 확인하세요.
- `ls` (Mac/Linux) 또는 `dir` (Windows) 명령어로 파일 목록을 확인하세요.

### 한글이 깨져서 보이는 경우

- 파일을 UTF-8 인코딩으로 저장했는지 확인하세요.
- 터미널/명령 프롬프트의 인코딩 설정을 확인하세요.

## 📖 참고 자료

- [Python 공식 문서](https://docs.python.org/ko/3/)
- [Python 튜토리얼](https://docs.python.org/ko/3/tutorial/)
- [점프 투 파이썬](https://wikidocs.net/book/1)

## 📄 라이선스

이 프로젝트는 교육 목적으로 자유롭게 사용할 수 있습니다.

## 🤝 기여

개선 사항이나 제안이 있으시면 언제든지 이슈를 등록하거나 풀 리퀘스트를 보내주세요!

---

**Happy Coding! 🎉**

Python 프로그래밍의 즐거운 여정을 시작하세요!