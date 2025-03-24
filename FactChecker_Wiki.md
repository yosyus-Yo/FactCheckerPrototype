# 📊 FactChecker 프로젝트 위키

## 📋 프로젝트 개요

**FactChecker**는 실시간 미디어 콘텐츠(뉴스, 영상, 오디오)의 사실 주장을 자동으로 감지하고 검증하여 증강현실(AR) 인터페이스로 시각화하는 시스템입니다.

### 핵심 목표

- 실시간 미디어에서 검증 가능한 사실 주장을 자동 감지
- 다중 신뢰 소스를 통한 주장의 정확성 검증
- WebXR 기반 AR 오버레이로 검증 결과 직관적 시각화
- 사용자 친화적이고 비침습적인 인터페이스 제공

### 대상 사용자

- **일반 대중**: 미디어 콘텐츠 소비 시 실시간 팩트체크 활용
- **팩트체커/저널리스트**: 전문적인 검증 작업 효율화
- **교육기관**: 미디어 리터러시 교육 도구로 활용

### 성공 평가 지표

- 주장 감지 정확도: 85% 이상
- 실시간 검증 속도: 2초 이내
- AR 시각화 표시 시간: 0.8초 이내
- 사용자 만족도: 4.0/5.0 이상

## 🏗️ 시스템 아키텍처

### 계층 구조

```
📦 FactChecker
 ┣ 📂 frontend (React + WebXR)
 ┃ ┣ 📂 features
 ┃ ┃ ┣ 📂 content-recognition
 ┃ ┃ ┣ 📂 claim-detection
 ┃ ┃ ┣ 📂 fact-verification
 ┃ ┃ ┗ 📂 ar-visualization
 ┃ ┣ 📂 shared
 ┃ ┗ 📂 core
 ┣ 📂 backend (Node.js + TypeScript)
 ┃ ┣ 📂 services
 ┃ ┣ 📂 domain
 ┃ ┗ 📂 infrastructure
 ┗ 📂 common
```

### 프로세스 흐름

```
콘텐츠 인식 및 전처리 ➡️ 트랜스크립트 데이터 ➡️ 주장 감지 및 분류
주장 감지 및 분류 ➡️ 검증 대상 주장 목록 ➡️ 다중 소스 팩트체크 (병렬 처리)
다중 소스 팩트체크 ➡️ 검증 결과 데이터 ➡️ AR 시각화 및 사용자 인터페이스
```

### 체인 유형 및 패턴

- **분기 체인 + 병렬 체인 조합**
  - 분기 조건: 콘텐츠 유형, 언어, 주장 유형에 따른 최적 처리 경로 선택
  - 병렬 처리: 다중 데이터 소스 동시 쿼리 및 결과 통합

## 🧩 핵심 모듈

### 1. 콘텐츠 인식 모듈 (`ContentRecognitionModule`)

**주요 기능**:
- 실시간 미디어 스트림 캡처 (비디오 60fps)
- 음성-텍스트 변환 (STT)
- 언어 감지 및 텍스트 정규화

**기술 요소**:
- Google AI Studio Stream Realtime API
- 다중 언어 지원 (우선순위: 한국어, 영어)
- 화자 구분 및 시간 코드 부여

### 2. 주장 감지 모듈 (`ClaimDetectionModule`)

**주요 기능**:
- 문장 단위 주장 식별
- 주장 유형 분류 (통계적, 역사적, 인용 등)
- 검증 우선순위 산정

**기술 요소**:
- 정치/경제/사회 분야별 150+ 패턴 기반 분석
- 중요도 및 논쟁성 기준 우선순위 계산
- 핵심 엔티티 추출

### 3. 팩트체크 모듈 (`FactCheckModule`)

**주요 기능**:
- 다중 소스 병렬 검증
- 결과 통합 및 신뢰도 계산
- 맥락 정보 수집

**기술 요소**:
- 빅카인즈 API (한국 뉴스 데이터)
- Factiverse Live API (다국어 팩트체킹)
- Google Fact Check API

**구현 예시**:
```typescript
class CoreFactCheckService {
  async verifyClaimBatch(claims: Claim[]): Promise<VerificationResult[]> {
    const bigkindsResults = await this.bigkindsAPI.verify(claims);
    const factiverseResults = await this.factiverseAPI.verify(claims);
    
    return this.resultIntegrator.combine([
      bigkindsResults,
      factiverseResults
    ]);
  }
}
```

### 4. AR 시각화 모듈 (`ARVisualizationModule`)

**주요 기능**:
- WebXR 기반 AR 오버레이 생성
- 신뢰도 수준별 시각적 표현
- 사용자 인터랙션 처리

**기술 요소**:
- WebXR Device API
- 신뢰도 색상 코드 (녹색: 사실, 노란색: 부분적 사실, 빨간색: 허위)
- 비침습적 오버레이 디자인

**구현 예시**:
```jsx
const ARFactOverlay = ({ claim, verificationResult }) => {
  const { initAR, arSession } = useWebXR();
  const [isVisible, setIsVisible] = useState(false);
  
  useEffect(() => {
    if (claim && verificationResult) {
      initAR();
      setIsVisible(true);
    }
  }, [claim, verificationResult]);
  
  return (
    arSession && isVisible && (
      <div className="ar-overlay" style={{ opacity: 0.85 }}>
        <TruthIndicator score={verificationResult.truth_score} />
        <p className="claim-text">{claim.claim_text}</p>
        <button onClick={() => setIsVisible(false)}>닫기</button>
      </div>
    )
  );
};
```

## 📝 데이터 모델

### 주장 (Claim)

```typescript
interface Claim {
  id: string;
  text: string;
  type: ClaimType;
  confidence: number;
  timestamp: number;
  speaker?: string;
  entities: Entity[];
  priority: number;
}
```

### 검증 결과 (VerificationResult)

```typescript
interface VerificationResult {
  claimId: string;
  truthScore: number;
  verdict: Verdict;
  sources: Source[];
  contextTimeline: TimelineEvent[];
  contraryClaims: Claim[];
}
```

### AR 오버레이 (AROverlay)

```typescript
interface AROverlay {
  id: string;
  verificationResult: VerificationResult;
  position: Vector3D;
  visibility: VisibilityState;
  interactionState: InteractionState;
}
```

## 🛠️ 기술 스택

### 프론트엔드
- **프레임워크**: React 18.x
- **상태 관리**: Redux Toolkit 2.x
- **타입 시스템**: TypeScript 5.x
- **AR 구현**: WebXR API
- **UI 컴포넌트**: TailwindCSS, Headless UI

### 백엔드
- **런타임**: Node.js 20 LTS
- **프레임워크**: Express.js 4.x
- **타입 시스템**: TypeScript 5.x
- **API 설계**: REST API + JSON:API

### 데이터베이스
- **주요 데이터**: MongoDB 7.x
- **캐싱/실시간 데이터**: Redis 7.x

### 클라우드/인프라
- **배포 환경**: AWS (ECS, Lambda, S3, CloudFront)
- **CI/CD**: GitHub Actions
- **모니터링**: AWS CloudWatch, Sentry

### 외부 API
- **미디어 처리**: Google AI Studio Stream Realtime
- **팩트체킹**: 빅카인즈 API, Factiverse Live API, Google Fact Check API

## 📅 구현 로드맵

### 1단계: MVP (1-6개월)
- 크롬 확장프로그램 베타 출시 (유튜브, 네이버TV, 카카오TV 연동)
- 빅카인즈 기본 데이터 파이프라인 구축
- 핵심 주장 감지 알고리즘 구현
- 기본 팩트체크 기능 구현

### 2단계: 고도화 (7-12개월)
- WebXR 기반 AR 인터페이스 고도화
- Factiverse/Google FactCheck 멀티API 병렬 처리 시스템 구축
- 다국어 지원 확대
- 성능 최적화 및 UX 개선

### 3단계: 확장 (13-18개월)
- AI 생성 콘텐츠 감지 모듈 추가 (GAN 생성 영상 식별)
- 방송사 실시간 자막 연동 상용화
- B2B API 구축
- 생태계 확장 (플러그인, API 개방)

## 🚀 성능 최적화 전략

### 실시간 처리 파이프라인
- **스트리밍 처리**: 청크 단위 병렬 처리
- **메모리 관리**: 슬라이딩 윈도우 방식
- **웹워커 활용**: 백그라운드 처리로 UI 블로킹 방지

```typescript
// 웹워커 활용 예시
// main.ts
const worker = new Worker('./factcheck.worker.ts');
worker.postMessage({ claim: claimText });
worker.onmessage = (event) => {
  updateUI(event.data.result);
};

// factcheck.worker.ts
self.onmessage = async (event) => {
  const { claim } = event.data;
  const result = await verifyClaimWithExternalAPIs(claim);
  self.postMessage({ result });
};
```

### API 최적화
- **배치 처리**: 주장 묶음 단위 검증
- **커넥션 풀링**: API 클라이언트 재사용
- **캐싱 전략**: Redis 활용 (TTL: 24시간)

### 반응형 설계
- **네트워크 상태 대응**: 적응형 콘텐츠 로딩
- **오프라인 모드**: 중요 데이터 로컬 캐싱
- **점진적 향상**: 기기 성능에 따른 기능 조정

## 🧪 품질 관리 및 테스트

### 테스트 전략
```typescript
describe('FactCheckModule', () => {
  it('should verify claims within 2 seconds', async () => {
    const startTime = Date.now();
    await factChecker.verify(testClaims);
    expect(Date.now() - startTime).toBeLessThan(2000);
  });
});
```

### 모니터링 및 알림
- **실시간 모니터링**: 처리 지연 임계값 2초
- **에러율 모니터링**: 임계값 1%
- **알림 체계**: Slack 통합

### 피드백 통합 프로세스
- **피드백 수집**: AR 인터페이스 내 피드백 기능
- **주간 모델 업데이트**: 사용자 피드백 기반 알고리즘 조정
- **오류 감지 자동화**: 반복적 오탐지 패턴 분석

## 🔗 참고 자료 및 리소스

### 관련 문서
- [WebXR 디바이스 API 명세](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API)
- [빅카인즈 API 문서](https://www.bigkinds.or.kr/)
- [Factiverse Live API 가이드](https://factiverse.ai/)
- [Google Fact Check API 레퍼런스](https://developers.google.com/fact-check/tools/api)

### 기술 트렌드
- AI와 XR의 결합: 증강 현실에 의미 있는 콘텐츠 제공
- 실시간 팩트체킹: 정보 소비 시점에 검증 제공
- WebXR 표준화: 크로스 플랫폼 AR 경험 단순화 