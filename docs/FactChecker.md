# 🔄 뉴스 팩트체크 AI 프롬프트 체인 개발 템플릿 V1.0

> 뉴스와 주장의 사실 여부를 효과적으로 검증하기 위한 프롬프트 체인 설계 템플릿입니다.

## 📋 목표 정의 및 사용자 프로파일링
- **핵심 목표**: 뉴스 주장과 정보의 사실 여부를 자동으로 검증하여 정확하고 신뢰할 수 있는 팩트체크 결과 제공
- **사용자 프로필**: 
  - 숙련도: 중급 (기본적인 팩트체크 개념 이해)
  - 배경 지식: 기본적인 NLP 및 검색 기술에 대한 이해
  - 기대 사항: 정확하고 빠른 자동화된 팩트체크 솔루션
- **예상 결과물**: 사실 검증 결과 보고서 (신뢰도 점수, 관련 증거 문서 목록, 검증 근거 요약)
- **성공 평가 지표**: 
  - 검증 정확도: 실제 사실과 검증 결과의 일치도 (85% 이상)
  - 검증 속도: 입력부터 결과 도출까지 5초 이내
  - 관련성 점수: 검색된 증거 문서의 관련성 80% 이상

## 🔗 체인 유형 선택
- **선택한 체인 유형**: 선형 체인 + 병렬 체인 조합
  - 키워드 추출 및 검색은 선형으로 진행
  - 여러 검색 API 결과와 유사도 분석은 병렬로 처리
- **선택 이유**: 각 단계가 순차적 의존성을 가지면서도, 검색과 분석 단계에서는 병렬 처리를 통해 시간 효율성 확보
- **참조 사례**: 구글의 자동화된 팩트체크 시스템, ClaimBuster와 같은 자동 팩트체크 도구

## 📑 단계별 프롬프트 설계

### 1️⃣ 주장 분석 및 핵심 키워드 추출
```
[맥락 설정]
- 배경: 팩트체크를 위해 주장의 핵심 키워드를 추출하는 초기 단계입니다.
- 중요성: 정확한 키워드 추출은 관련 뉴스 검색의 품질을 결정합니다.

[지시사항]
- 주요 작업: 입력된 뉴스 제목과 요약에서 핵심 팩트체크 대상 키워드를 추출하세요.
- 세부 지침: 
  1. 주장에서 핵심 명사구, 인물, 기관, 장소, 날짜, 수치 등을 식별하세요.
  2. 각 키워드의 중요도를 판단하여 우선순위를 매기세요.
  3. 검색에 효과적인 키워드 조합을 2-3개 구성하세요.
  4. 불필요한 관사, 접속사, 부사는 제거하세요.

[입력 형식]
- 데이터 형태: 뉴스 제목과 요약 텍스트
- 입력 예시: 
  "제목: 정부, 내년부터 전기차 보조금 50% 삭감 계획 발표"
  "요약: 환경부는 어제 기자회견을 통해 2026년부터 전기차 구매 보조금을 현행 대비 50% 삭감할 계획이라고 발표했다. 이는 전기차 시장의 자생력 확보를 위한 조치라고 밝혔다."

[출력 형식]
- 구조: JSON 형식으로 키워드 및 검색 쿼리 조합 제공
- 스타일: 간결하고 명확한 키워드 리스트
- 출력 예시:
  ```json
  {
    "주요_키워드": [
      {"키워드": "전기차 보조금", "중요도": "높음"},
      {"키워드": "환경부", "중요도": "중간"},
      {"키워드": "50% 삭감", "중요도": "높음"},
      {"키워드": "2026년", "중요도": "높음"},
      {"키워드": "자생력 확보", "중요도": "낮음"}
    ],
    "검색_쿼리": [
      "환경부 전기차 보조금 50% 삭감 2026년",
      "정부 전기차 보조금 삭감 계획 발표",
      "2026년 전기차 보조금 정책 변경"
    ]
  }
  ```

[제약 조건]
- 필수 포함 요소: 주체(누가), 행위(무엇을), 시간(언제), 수치(얼마나) 관련 키워드
- 제외 요소: 의견적 표현, 추측성 언어, 감정적 표현
- 특별 고려사항: 가능한 한 사실 검증이 가능한 구체적 키워드를 우선시하세요
```

### 2️⃣ 최신 뉴스 검색 실행
```
[맥락 설정]
- 배경: 1단계에서 추출한 키워드를 활용하여 관련 최신 뉴스를 검색합니다.
- 이전 단계와의 연결: 1단계에서 생성된 검색 쿼리를 입력으로 사용합니다.

[지시사항]
- 주요 작업: 제공된 검색 쿼리를 사용하여 Tavily와 Brave Search 도구로 최신 뉴스를 검색하세요.
- 세부 지침:
  1. 각 검색 쿼리에 대해 Tavily와 Brave Search 양쪽 모두 검색을 실행하세요.
  2. Tavily 검색시 'news' 토픽으로 설정하고 최근 7일 내 정보로 제한하세요.
  3. 검색 결과에서 URL, 제목, 요약, 날짜 정보를 추출하세요.
  4. 신뢰할 수 있는 뉴스 출처(주요 언론사)의 결과를 우선적으로 선별하세요.

[입력 형식]
- 데이터 형태: 1단계에서 생성된 JSON 형식의 검색 쿼리 목록
- 입력 예시:
  ```json
  {
    "검색_쿼리": [
      "환경부 전기차 보조금 50% 삭감 2026년",
      "정부 전기차 보조금 삭감 계획 발표",
      "2026년 전기차 보조금 정책 변경"
    ]
  }
  ```

[출력 형식]
- 구조: JSON 형식으로 검색 결과 목록 제공
- 스타일: 간결하고 구조화된 검색 결과 목록
- 출력 예시:
  ```json
  {
    "검색_결과": [
      {
        "출처": "Tavily-news",
        "쿼리": "환경부 전기차 보조금 50% 삭감 2026년",
        "결과": [
          {
            "URL": "https://example.com/news1",
            "제목": "환경부, 2026년부터 전기차 보조금 단계적 축소 방안 발표",
            "요약": "환경부가 어제 기자회견에서 2026년부터 전기차 보조금을 단계적으로 축소하는 계획을 발표했다.",
            "날짜": "2025-03-26",
            "신뢰도_점수": 0.85
          },
          ...
        ]
      },
      {
        "출처": "Brave Search",
        "쿼리": "환경부 전기차 보조금 50% 삭감 2026년",
        "결과": [
          ...
        ]
      },
      ...
    ]
  }
  ```

[제약 조건]
- 필수 포함 요소: URL, 제목, 요약, 날짜, 출처 정보
- 제외 요소: 광고, 중복 기사, 7일 이상 지난 오래된 뉴스
- 특별 고려사항: 검색 결과 중 날짜가 최신인 것을 우선 순위로 하세요
```

### 3️⃣ 유사도 분석 및 관련성 평가
```
[맥락 설정]
- 배경: 검색된 뉴스와 원 주장 간의 텍스트 유사도를 분석하여 관련성을 평가합니다.
- 이전 단계와의 연결: 2단계에서 검색된 뉴스 결과를 입력으로 사용합니다.

[지시사항]
- 주요 작업: 원 주장과 검색된 뉴스 간의 유사도를 분석하고 관련성 점수를 산출하세요.
- 세부 지침:
  1. 원 주장과 각 뉴스 기사 간 텍스트 유사도를 계산하세요.
  2. 주요 키워드의 포함 여부와 그 맥락을 분석하세요.
  3. 시간, 수치, 주체 등 핵심 사실 정보의 일치도를 확인하세요.
  4. 각 뉴스별 관련성 점수(0~1 사이)를 산출하세요.
  5. 관련성 점수가 높은 뉴스 상위 5개를 선별하세요.

[입력 형식]
- 데이터 형태: 원 주장 텍스트와 2단계에서 검색된 뉴스 결과 JSON
- 입력 예시: 원 주장 + 2단계 검색 결과 JSON

[출력 형식]
- 구조: 관련성 점수가 포함된 JSON 형식의 뉴스 목록
- 스타일: 점수 기준 내림차순 정렬된 결과 목록
- 출력 예시:
  ```json
  {
    "관련성_평가_결과": [
      {
        "URL": "https://example.com/news1",
        "제목": "환경부, 2026년부터 전기차 보조금 단계적 축소 방안 발표",
        "요약": "환경부가 어제 기자회견에서 2026년부터 전기차 보조금을 단계적으로 축소하는 계획을 발표했다.",
        "날짜": "2025-03-26",
        "출처": "Tavily-news",
        "관련성_점수": 0.92,
        "키워드_일치도": "높음",
        "시간_일치도": "높음",
        "수치_일치도": "중간"
      },
      ...
    ]
  }
  ```

[제약 조건]
- 필수 포함 요소: 관련성 점수, 키워드/시간/수치 일치도 평가
- 제외 요소: 관련성 점수 0.5 미만인 뉴스
- 특별 고려사항: 날짜 정보의 최신성과 출처의 신뢰성도 고려하세요
```

### 4️⃣ 뉴스 콘텐츠 추출 및 분석
```
[맥락 설정]
- 배경: 관련성이 높은 뉴스의 상세 내용을 추출하여 분석합니다.
- 이전 단계와의 연결: 3단계에서 선별된 관련성 높은 뉴스를 입력으로 사용합니다.

[지시사항]
- 주요 작업: 관련성 점수가 높은 뉴스 URL에서 상세 내용을 추출하고 분석하세요.
- 세부 지침:
  1. 선별된 뉴스 URL의 전체 콘텐츠를 tavily-extract 도구로 추출하세요.
  2. 추출된 콘텐츠에서 원 주장과 관련된 핵심 구절과 정보를 식별하세요.
  3. 뉴스 내용에서 주장을 뒷받침하거나 반박하는 구체적 증거를 추출하세요.
  4. 각 뉴스 출처의 신뢰도와 객관성을 평가하세요.

[입력 형식]
- 데이터 형태: 3단계에서 선별된 관련성 높은 뉴스 URL 목록
- 입력 예시: 3단계 결과에서 관련성 높은 상위 5개 뉴스 URL

[출력 형식]
- 구조: 각 뉴스별 상세 분석 결과가 포함된 JSON
- 스타일: 구조화된 분석 보고서
- 출력 예시:
  ```json
  {
    "콘텐츠_분석_결과": [
      {
        "URL": "https://example.com/news1",
        "추출_시간": "2025-03-27T15:30:00Z",
        "전체_콘텐츠_길이": 4532,
        "핵심_증거_구절": [
          "환경부 김OO 장관은 '2026년부터 전기차 보조금을 연간 10%씩 단계적으로 삭감하여 2030년까지 약 50% 수준으로 축소할 계획'이라고 밝혔다.",
          "이번 정책은 전기차 시장의 자생력 확보와 재정 부담 완화를 위한 조치로, 작년 말 국무회의에서 승인되었다."
        ],
        "주장_지지_여부": "부분_일치",
        "불일치_내용": "50% 삭감이 단번에 이루어지는 것이 아니라 2030년까지 단계적으로 진행됨",
        "출처_신뢰도": "높음",
        "분석_신뢰도": 0.88
      },
      ...
    ]
  }
  ```

[제약 조건]
- 필수 포함 요소: 원문 증거 구절, 주장 지지 여부, 불일치 내용
- 제외 요소: 의견 기반 분석, 추측성 판단
- 특별 고려사항: 원 주장과 직접적으로 관련된 사실적 증거만 추출하세요
```

### 5️⃣ 통합 사실 검증 및 결과 종합
```
[맥락 설정]
- 배경: 이전 단계들의 결과를 통합하여 최종 팩트체크 결과를 도출합니다.
- 이전 단계와의 연결: 1~4단계의 모든 분석 결과를 종합하여 활용합니다.

[지시사항]
- 주요 작업: 수집된 모든 증거를 종합하여 원 주장의 사실 여부를 최종 판정하세요.
- 세부 지침:
  1. 각 뉴스 출처의 증거 가중치를 신뢰도에 따라 산정하세요.
  2. 주장을 구성하는 각 세부 요소별 사실 여부를 평가하세요.
  3. 모든 증거를 종합하여 "사실", "대체로 사실", "절반의 사실", "대체로 거짓", "거짓", "판단 불가" 중 하나로 최종 판정하세요.
  4. 판정 근거와 종합적 설명을 작성하세요.
  5. 모든 참고 출처를 명확히 인용하세요.

[입력 형식]
- 데이터 형태: 1~4단계의 모든 분석 결과
- 입력 예시: 4단계까지의 모든 분석 데이터

[출력 형식]
- 구조: 종합 판정 결과 보고서
- 스타일: 간결하면서 명확한 최종 보고서
- 출력 예시:
  ```json
  {
    "팩트체크_결과": {
      "원_주장": "환경부는 어제 기자회견을 통해 2026년부터 전기차 구매 보조금을 현행 대비 50% 삭감할 계획이라고 발표했다.",
      "최종_판정": "대체로 사실",
      "정확도_점수": 0.82,
      "판정_설명": "환경부는 실제로 전기차 보조금 삭감 계획을 발표했으나, 50% 삭감은 2026년부터 시작하여 2030년까지 단계적으로 진행될 예정입니다. 따라서 '2026년부터 50% 삭감'이라는 표현은 다소 오해의 소지가 있습니다.",
      "세부_판정": [
        {"요소": "환경부 발표", "판정": "사실", "신뢰도": 0.95},
        {"요소": "전기차 보조금 삭감", "판정": "사실", "신뢰도": 0.95},
        {"요소": "2026년부터", "판정": "사실", "신뢰도": 0.95},
        {"요소": "50% 삭감", "판정": "부분 사실", "신뢰도": 0.7}
      ],
      "증거_출처": [
        {"URL": "https://example.com/news1", "인용_구절": "환경부 김OO 장관은 '2026년부터 전기차 보조금을 연간 10%씩 단계적으로 삭감하여 2030년까지 약 50% 수준으로 축소할 계획'이라고 밝혔다."}
      ]
    }
  }
  ```

[제약 조건]
- 필수 포함 요소: 최종 판정, 정확도 점수, 판정 설명, 증거 출처
- 제외 요소: 개인 의견, 미확인 정보, 출처가 불명확한 정보
- 특별 고려사항: 증거가 불충분한 경우 '판단 불가'로 분류하세요
```

## 🔄 체인 연결 및 흐름 설계
- **흐름 패턴**: 선형 진행 + 2-3단계 병렬 처리
- **단계 간 데이터 전달 방식**:
  
  [1. 키워드 추출] ➡️ [추출된 검색 쿼리 리스트] ➡️ [2. 뉴스 검색]
  [2. 뉴스 검색] ➡️ [검색된 뉴스 리스트] ➡️ [3. 유사도 분석]
  [3. 유사도 분석] ➡️ [관련성 높은 뉴스 URL] ➡️ [4. 콘텐츠 추출]
  [4. 콘텐츠 추출] ➡️ [분석된 증거 데이터] ➡️ [5. 통합 판정]
  
- **병렬 처리**: 
  - 2단계: Tavily와 Brave Search 동시 검색
  - 3단계: 여러 뉴스 기사 병렬 분석
  - 4단계: 여러 URL의 콘텐츠 병렬 추출

## 🔍 검증 및 개선 메커니즘
- **결과물 검증 방식**:
  - 교차 검증: 여러 뉴스 출처의 정보 일치도 검사
  - 신뢰도 테스트: 이미 검증된 사실을 샘플로 시스템 정확도 평가
- **피드백 통합 프로세스**:
  - 피드백 수집 지점: 최종 팩트체크 결과에 대한 정확도 평가
  - 피드백 반영 메커니즘: 각 단계별 오류 패턴 분석 및 프롬프트 개선
- **자기 수정 메커니즘**:
  - 오류 감지 로직: 상충되는 정보 발견 시 추가 검색 수행
  - 수정 프로세스: 신뢰도 높은 출처의 정보를 우선시하여 결과 재조정
- **반복적 개선 계획**:
  - 평가 주기: 매 50회 검증 후 결과 분석
  - 개선 프로세스: 오류 패턴 분석 후 프롬프트 미세 조정

## 📚 참고 자료 및 리소스
- **관련 프롬프트 패턴**: 
  - 단계적 분석 프롬프트 (Step-by-Step Analysis)
  - 증거 기반 추론 (Evidence-Based Reasoning)
  - 신뢰도 가중치 평가 (Credibility Weighted Assessment)
- **참고 문헌**: 
  - "Automated Fact-Checking Systems: A Survey" (2023)
  - "NLP Techniques for Misinformation Detection" (2024)
- **도구 및 리소스**: 
  - Tavily Search API
  - Brave Search API
  - Claude 모델의 RAG(Retrieval-Augmented Generation) 능력

## 📝 사용 지침
1. 입력 주장은 가능한 한 원문 그대로 제공하세요.
2. 뉴스 검색 단계에서 시간 범위는 주장의 시기에 따라 적절히 조정하세요.
3. 판정 결과는 증거 기반으로 객관적이고 균형 있게 제시하세요.
4. 판단 불가능한 경우 무리하게 판정하지 말고 '판단 불가'로 분류하세요.
5. 시스템 성능 개선을 위해 주기적으로 오류 패턴을 분석하고 프롬프트를 미세 조정하세요.