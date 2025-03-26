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

## 사용 방법

1. 백엔드 서버를 실행합니다 (`npm start`).
2. Chrome 브라우저에서 뉴스 기사 페이지로 이동합니다.
3. 확장 프로그램 아이콘을 클릭하여 팝업창을 엽니다.
4. "주장 검증" 버튼을 클릭하여 현재 페이지의 내용을 분석합니다.
5. 분석 결과를 확인하고 주장의 신뢰도를 평가합니다.

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