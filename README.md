# FactChecker

실시간 미디어 콘텐츠의 진위 여부를 자동으로 검증하고 AR로 시각화하는 시스템입니다. 크롬 확장 프로그램과 백엔드 서버로 구성되어 있으며, 뉴스 기사나 영상의 내용을 분석하여 팩트체킹을 수행합니다.

## 주요 기능

- 웹 페이지의 뉴스 콘텐츠 자동 추출 및 분석
- 주장 감지 및 사실 여부 검증
- 실시간 팩트체킹 결과 시각화
- 다중 소스 검증 및 신뢰도 평가
- 백엔드 API와 크롬 확장 프로그램 연동

## 프로젝트 구조

```
FactChecker/
├── extension/               # 크롬 확장 프로그램
│   ├── background.js        # 백그라운드 서비스 워커
│   ├── content/             # 콘텐츠 스크립트
│   ├── popup/               # 팝업 인터페이스
│   ├── icons/               # 아이콘 리소스
│   └── manifest.json        # 확장 프로그램 매니페스트
├── src/                     # 백엔드 서버
│   ├── app.js               # 메인 애플리케이션
│   ├── config/              # 서버 설정
│   ├── models/              # 데이터 모델
│   ├── routes/              # API 엔드포인트
│   ├── services/            # 비즈니스 로직
│   └── utils/               # 유틸리티 함수
├── .env                     # 환경 변수 (비공개)
└── .env.example             # 환경 변수 예시
```

## 설치 방법

### 1. 백엔드 서버 설정

```bash
# 프로젝트 클론
git clone https://github.com/yosyus-Yo/FactCheckerPrototype.git
cd FactCheckerPrototype

# 패키지 설치
npm install

# 환경 설정
cp .env.example .env
# .env 파일을 편집하여 필요한 API 키와 설정을 입력합니다.

# 서버 실행
npm start
```

### 2. 크롬 확장 프로그램 설치

1. Chrome 브라우저에서 `chrome://extensions`로 이동합니다.
2. 개발자 모드를 활성화합니다.
3. "압축해제된 확장 프로그램을 로드합니다" 버튼을 클릭합니다.
4. 프로젝트의 `extension` 폴더를 선택합니다.

## 상세 사용 방법

### 기본 사용법

1. 백엔드 서버를 실행합니다 (`npm start`).
2. Chrome 브라우저에서 뉴스 기사 페이지로 이동합니다.
3. 확장 프로그램 아이콘을 클릭하여 팝업창을 엽니다.
4. "주장 검증" 버튼을 클릭하여 현재 페이지의 내용을 분석합니다.
5. 분석 결과를 확인하고 주장의 신뢰도를 평가합니다.

### 확장 프로그램 사용법

#### 실시간 팩트체킹

1. 뉴스 기사나 블로그 등 팩트체크가 필요한 웹 페이지에서 확장 프로그램 아이콘이 활성화됩니다.
2. 아이콘 클릭 후 "실시간 팩트체킹" 토글 버튼을 활성화하면 페이지의 내용을 자동으로 분석합니다.
3. 확인된 주장에는 신뢰도 점수에 따라 색상 코드가 부여됩니다:
   - 녹색(0.8-1.0): 사실로 확인됨
   - 노란색(0.5-0.79): 부분적 사실
   - 빨간색(0.0-0.49): 허위 정보

#### 수동 팩트체킹

1. 특정 텍스트를 선택한 후 마우스 오른쪽 버튼 클릭하여 컨텍스트 메뉴에서 "선택한 텍스트 팩트체크"를 선택합니다.
2. 또는 확장 프로그램 팝업에서 "수동 검증" 탭을 선택하고 텍스트를 직접 입력하여 검증할 수 있습니다.
3. 결과는 팝업창에 표시되며, 상세 보기를 통해 근거 자료를 확인할 수 있습니다.

#### AR 시각화 모드

1. 확장 프로그램 팝업에서 "AR 시각화" 버튼을 활성화합니다.
2. 웹캠 접근 권한을 허용하면 AR 모드가 활성화됩니다.
3. 스마트폰이나 태블릿으로 뉴스 기사나 영상을 비추면 실시간으로 팩트체킹 결과가 오버레이됩니다.

### 백엔드 API 사용

FactChecker의 API를 직접 호출하여 서비스를 이용할 수 있습니다:

#### 주요 엔드포인트

- `POST /api/verify/url`: URL을 통한 콘텐츠 검증
  ```bash
  curl -X POST http://localhost:3000/api/verify/url \
    -H "Content-Type: application/json" \
    -d '{"url": "https://example.com/news/article"}'
  ```

- `POST /api/verify/text`: 텍스트 기반 콘텐츠 검증
  ```bash
  curl -X POST http://localhost:3000/api/verify/text \
    -H "Content-Type: application/json" \
    -d '{"text": "검증할 텍스트 내용", "title": "텍스트 제목"}'
  ```

- `GET /api/status`: 서버 상태 확인
  ```bash
  curl http://localhost:3000/api/status
  ```

## 고급 기능 및 커스터마이징

### 신뢰도 계산 알고리즘 조정

`src/services/factChecker.js` 파일에서 신뢰도 계산 알고리즘의 가중치를 조정할 수 있습니다:

- `calculateSearchTrustScore` 함수에서 관련성과 신뢰도의 가중치 비율 조정
- `calculateSourceReliability` 함수에서 소스의 신뢰도 점수 조정

### 키워드 추출 최적화

키워드 추출 성능을 향상시키려면 다음 설정을 조정할 수 있습니다:

1. `.env` 파일에서 `GOOGLE_AI_MODEL` 값을 더 높은 성능의 모델로 변경
2. `src/services/factChecker.js`의 `extractKeywords` 함수에서 프롬프트 템플릿 수정

## 문제 해결

### 일반적인 오류 및 해결 방법

1. **API 연결 오류**
   - `.env` 파일에 API 키가 올바르게 설정되었는지 확인
   - 서버 로그에서 오류 메시지 확인
   - 인터넷 연결 확인

2. **확장 프로그램이 작동하지 않는 경우**
   - Chrome 개발자 도구의 콘솔에서 오류 메시지 확인
   - 백엔드 서버가 실행 중인지 확인
   - 확장 프로그램을 재로드하거나 브라우저 재시작

3. **검증 결과가 정확하지 않은 경우**
   - 더 많은 API 키를 추가하여 다중 소스 검증 향상
   - 키워드 추출 알고리즘 최적화
   - 특정 도메인에 맞는 커스텀 검증 로직 추가

### 로그 확인 방법

- 백엔드 로그: `src/logs/` 디렉토리의 로그 파일 확인
- 확장 프로그램 로그: Chrome 개발자 도구 > 콘솔 탭에서 확인

## API 키 요구사항

- Google AI API 키
- 빅카인즈 API 키 (한국 뉴스 분석용)
- Factiverse API 키 (팩트체킹 통합)
- Google Fact Check API 키 

## 기술 스택

- **백엔드**: Node.js, Express
- **프론트엔드**: JavaScript, HTML/CSS
- **데이터베이스**: MongoDB
- **API**: RESTful API
- **확장 프로그램**: Chrome Extension API

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다. 자세한 내용은 LICENSE 파일을 참조하세요.

## 기여 방법

이슈와 풀 리퀘스트는 환영합니다. 대규모 변경의 경우, 먼저 이슈를 열어 논의해주세요. 