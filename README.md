# FactChecker

실시간 미디어 콘텐츠의 진위 여부를 자동으로 검증하고 AR로 시각화하는 앱입니다.

## 설치 방법

1. 프로젝트 클론
```
git clone https://github.com/username/factchecker.git
cd factchecker
```

2. 패키지 설치
```
npm install
```

3. 환경 설정
`.env.example` 파일을 복사하여 `.env` 파일을 생성하고 필요한 API 키와 설정을 입력합니다.

4. 서버 실행
```
npm run dev
```

## 기능

- 실시간 미디어 스트림 처리
- 주장 감지 및 분류
- 다중 소스 팩트체킹
- WebXR 기반 AR 시각화

## API 키 요구사항

- Google AI API 키
- 빅카인즈 API 키
- Factiverse API 키
- Google Fact Check API 키 