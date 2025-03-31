/**
 * 주장 감지 모듈
 * 텍스트에서 문장 단위로 주장을 식별하고, 유형을 분류하며, 우선순위를 산정합니다.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const natural = require('natural');
const logger = require('../utils/logger');
const { claimPatterns } = require('../utils/helpers');
const config = require('../config');
const { findKeywordAndSearchFromClaims } = require('./contentRecognition');

// 한국어 NLP 처리를 위한 설정
const tokenizer = new natural.SentenceTokenizer();
const tfidf = new natural.TfIdf();

// Google AI 초기화
const genAI = new GoogleGenerativeAI({apiKey: config.api.googleAi.apiKey});

// 환경변수에서 모델명 가져오기
const GEMINI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";

/**
 * 주장 유형 정의
 */
const CLAIM_TYPES = {
  FACTUAL: '사실적 주장',     // 검증 가능한 사실에 관한 주장
  PREDICTIVE: '예측 주장',    // 미래에 대한 예측을 담은 주장
  CAUSAL: '인과 관계 주장',   // 원인과 결과를 연결하는 주장
  VALUE: '가치 주장',         // 가치 판단이 포함된 주장
  POLICY: '정책 주장'         // 정책이나 행동 방침에 관한 주장
};

/**
 * 주장 특성 추출을 위한 패턴
 */
const claimFeaturePatterns = {
  // 사실적 주장 패턴
  factual: {
    statistic: /(\d+(?:\.\d+)?%?)\s*(?:의|는|은|이|가)/g,
    factMarkers: /(?:사실|실제로|실제|객관적으로|공식적으로|통계에 따르면|연구에 따르면|보고서에 따르면)/g,
    pastEvents: /(?:했다|되었다|일어났다|발생했다|완료되었다|진행되었다)/g
  },
  
  // 예측 주장 패턴
  predictive: {
    futureMarkers: /(?:것이다|예정이다|전망이다|예상된다|추정된다|예측된다|될 것이다|할 것이다)/g,
    conditionalMarkers: /(?:면|을 경우|라면|ㄴ다면|한다면|만약|가정하면)/g
  },
  
  // 인과 관계 주장 패턴
  causal: {
    causalMarkers: /(?:때문에|로 인해|덕분에|영향으로|결과로|초래했다|유발했다|이어졌다)/g,
    correlationMarkers: /(?:관련이 있다|연관되어 있다|상관관계가 있다|비례한다|반비례한다)/g
  },
  
  // 가치 주장 패턴
  value: {
    valueMarkers: /(?:중요하다|필요하다|가치가 있다|의미가 있다|바람직하다|옳다|그르다|좋다|나쁘다|최고의|최악의|최선의|이상적인)/g,
    comparisonMarkers: /(?:보다|더|가장|비해|대비)/g
  },
  
  // 정책 주장 패턴
  policy: {
    policyMarkers: /(?:해야 한다|필요가 있다|요구된다|의무가 있다|추진해야 한다|시행해야 한다|도입해야 한다|개선해야 한다)/g,
    regulationMarkers: /(?:법률|법안|규제|정책|제도|시행령|지침|가이드라인|허용|금지|의무화)/g
  }
};

/**
 * 텍스트에서 문장 단위로 분리하여 주장을 감지하는 메인 함수
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<Array>} - 감지된 주장 목록 (유형, 우선순위 포함)
 */
async function detectClaims(text) {
  try {
    logger.info(`주장 감지 시작 - 텍스트 길이: ${text.length} 자`);
    
    // 1. 문장 단위로 분리
    const sentences = tokenizeText(text);
    logger.info(`텍스트 토큰화 완료 - ${sentences.length}개 문장 추출됨`);
    
    // 2. 각 문장에 대해 주장 식별 및 특성 추출
    const claimCandidates = sentences.map(identifyClaimFeatures);
    logger.info(`주장 후보 식별 완료 - ${claimCandidates.length}개 문장 분석됨`);
    
    // 3. 필터링 (점수가 임계값 이상인 문장만 주장으로 간주)
    const MIN_CLAIM_SCORE = 0.4;
    let potentialClaims = claimCandidates.filter(item => item.score >= MIN_CLAIM_SCORE);
    logger.info(`주장 후보 필터링 - ${potentialClaims.length}개 잠재적 주장 감지됨`, {
      claims_count: potentialClaims.length,
      min_score: MIN_CLAIM_SCORE
    });
    
    // 로그에 감지된 모든 주장 출력
    logger.info(`감지된 주장 목록`, {
      detected_claims: potentialClaims.map(claim => ({
        text: claim.text.substring(0, 50) + (claim.text.length > 50 ? '...' : ''),
        score: claim.score,
        features: claim.features
      }))
    });
    
    // 4. AI 모델을 활용한 주장 분석 및 유형 분류 (충분한 후보가 있을 경우)
    if (potentialClaims.length > 0) {
      potentialClaims = await classifyClaimsWithAI(potentialClaims);
      logger.info(`AI 주장 분류 완료 - ${potentialClaims.length}개 주장 분류됨`);
    }
    
    // 5. 우선순위 산정
    potentialClaims = calculateClaimPriorities(potentialClaims, text);
    
    // 6. 결과 정렬 (우선순위 높은 순)
    potentialClaims.sort((a, b) => b.priority - a.priority);
    
    // 최종 식별된 주장 로그
    logger.info(`최종 식별된 주장`, {
      identified_claims: potentialClaims.map(claim => ({
        text: claim.text.substring(0, 50) + (claim.text.length > 50 ? '...' : ''),
        type: claim.type,
        priority: claim.priority,
        confidence: claim.confidence
      }))
    });
    
    return potentialClaims;
  } catch (error) {
    logger.error(`주장 감지 중 오류 발생: ${error.message}`);
    return [];
  }
}

/**
 * 텍스트를 문장 단위로 분리
 * @param {string} text - 분석할 텍스트
 * @returns {Array<string>} - 문장 배열
 */
function tokenizeText(text) {
  // 기본 문장 분리
  let sentences = tokenizer.tokenize(text);
  
  // 따옴표 안의 내용을 별도의 문장으로 처리 (인용구)
  const quotationRegex = /["']([^"']+)["']/g;
  let match;
  
  while ((match = quotationRegex.exec(text)) !== null) {
    if (match[1] && match[1].length > 10) {
      sentences.push(match[1]);
    }
  }
  
  // 중복 제거 및 정제
  sentences = [...new Set(sentences)]
    .map(s => s.trim())
    .filter(s => s.length > 10); // 너무 짧은 문장 제외
  
  return sentences;
}

/**
 * 문장에서 주장 관련 특성 식별
 * @param {string} sentence - 분석할 문장
 * @returns {Object} - 주장 후보 객체 (특성 및 점수 포함)
 */
function identifyClaimFeatures(sentence) {
  const features = {
    text: sentence,
    score: 0,
    features: {
      factual: 0,
      predictive: 0, 
      causal: 0,
      value: 0,
      policy: 0
    },
    entities: [],
    confidence: 0
  };
  
  // 1. 기본 주장 패턴 매칭
  if (claimPatterns.quotedStatement.test(sentence)) {
    features.score += 0.3;
    features.confidence = 0.8;
  }
  
  if (claimPatterns.declarative.test(sentence)) {
    features.score += 0.2;
    features.confidence = 0.6;
  }
  
  if (claimPatterns.numericalClaim.test(sentence)) {
    features.score += 0.3;
    features.features.factual += 0.4;
    features.confidence = 0.7;
  }
  
  // 2. 주장 유형별 특성 분석
  // 사실적 주장 특성
  if (claimFeaturePatterns.factual.statistic.test(sentence)) {
    features.score += 0.2;
    features.features.factual += 0.3;
  }
  
  if (claimFeaturePatterns.factual.factMarkers.test(sentence)) {
    features.score += 0.3;
    features.features.factual += 0.4;
  }
  
  if (claimFeaturePatterns.factual.pastEvents.test(sentence)) {
    features.score += 0.1;
    features.features.factual += 0.2;
  }
  
  // 예측 주장 특성
  if (claimFeaturePatterns.predictive.futureMarkers.test(sentence)) {
    features.score += 0.2;
    features.features.predictive += 0.5;
  }
  
  if (claimFeaturePatterns.predictive.conditionalMarkers.test(sentence)) {
    features.score += 0.1;
    features.features.predictive += 0.3;
  }
  
  // 인과 관계 주장 특성
  if (claimFeaturePatterns.causal.causalMarkers.test(sentence)) {
    features.score += 0.2;
    features.features.causal += 0.5;
  }
  
  if (claimFeaturePatterns.causal.correlationMarkers.test(sentence)) {
    features.score += 0.2;
    features.features.causal += 0.4;
  }
  
  // 가치 주장 특성
  if (claimFeaturePatterns.value.valueMarkers.test(sentence)) {
    features.score += 0.1;
    features.features.value += 0.5;
  }
  
  if (claimFeaturePatterns.value.comparisonMarkers.test(sentence)) {
    features.score += 0.1;
    features.features.value += 0.3;
  }
  
  // 정책 주장 특성
  if (claimFeaturePatterns.policy.policyMarkers.test(sentence)) {
    features.score += 0.2;
    features.features.policy += 0.5;
  }
  
  if (claimFeaturePatterns.policy.regulationMarkers.test(sentence)) {
    features.score += 0.2;
    features.features.policy += 0.4;
  }
  
  // 3. 개체명 포함 여부 (간단한 패턴 매칭)
  const entityPatterns = [
    /(?:\d{4}년|\d{1,2}월|\d{1,2}일)/g,  // 날짜
    /(?:\d+(?:\.\d+)?%)/g,              // 백분율
    /(?:[가-힣]+(?:대통령|총리|장관|의원|교수|박사|위원장|대표|회장))/g // 인물 직함
  ];
  
  entityPatterns.forEach(pattern => {
    const matches = sentence.match(pattern);
    if (matches) {
      features.entities = [...features.entities, ...matches];
      features.score += 0.1 * matches.length;
    }
  });
  
  // 최종 점수 정규화 (0-1 사이)
  features.score = Math.min(features.score, 1.0);
  
  // 가장 높은 특성 기반으로 예비 유형 결정
  const featureScores = features.features;
  const maxFeature = Object.keys(featureScores).reduce((a, b) => 
    featureScores[a] > featureScores[b] ? a : b);
  
  features.preliminaryType = maxFeature;
  
  return features;
}

/**
 * Google AI를 사용하여 주장 유형 분류
 * @param {Array} claimCandidates - 주장 후보 목록
 * @returns {Promise<Array>} - 유형이 분류된 주장 목록
 */
async function classifyClaimsWithAI(claimCandidates) {
  try {
    // 너무 많은 후보가 있는 경우 상위 10개만 처리
    const candidatesToProcess = claimCandidates.length > 10 
      ? claimCandidates.slice(0, 10) 
      : claimCandidates;
    
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    const claimTexts = candidatesToProcess.map(c => c.text).join('\n\n');
    
    const prompt = `
    다음 문장들을 분석하여 각각이 어떤 유형의 주장인지 분류해주세요.
    가능한 유형:
    - 사실적 주장: 검증 가능한 사실에 관한 주장
    - 예측 주장: 미래에 대한 예측을 담은 주장
    - 인과 관계 주장: 원인과 결과를 연결하는 주장
    - 가치 주장: 가치 판단이 포함된 주장
    - 정책 주장: 정책이나 행동 방침에 관한 주장
    
    문장들:
    ${claimTexts}
    
    각 문장에 대해 다음 형식의 JSON으로 응답해주세요:
    [
      {
        "text": "문장 내용",
        "type": "주장 유형",
        "explanation": "분류 이유 간략 설명",
        "checkworthiness": 팩트체킹 필요성 점수(0.0-1.0)
      }
    ]
    `;
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    const textResponse = response.text();
    
    // JSON 추출
    const jsonMatch = textResponse.match(/\[\s*\{.*\}\s*\]/s);
    if (jsonMatch) {
      try {
        const aiClassifications = JSON.parse(jsonMatch[0]);
        
        // AI 분류 결과를 기존 후보와 병합
        candidatesToProcess.forEach(candidate => {
          const aiResult = aiClassifications.find(r => r.text === candidate.text);
          if (aiResult) {
            candidate.type = mapAITypeToClaimType(aiResult.type);
            candidate.explanation = aiResult.explanation;
            candidate.checkworthiness = aiResult.checkworthiness;
            
            // 신뢰도 조정 (AI 결과 반영)
            candidate.confidence = (candidate.confidence + aiResult.checkworthiness) / 2;
          } else {
            // AI 결과가 없는 경우, 예비 유형 기반으로 설정
            candidate.type = CLAIM_TYPES[candidate.preliminaryType.toUpperCase()];
          }
        });
        
        return candidatesToProcess;
      } catch (parseError) {
        logger.error(`AI 응답 파싱 중 오류: ${parseError.message}`);
        // 파싱 오류 시 원래 후보 반환 (유형은 예비 유형으로 설정)
        return candidatesToProcess.map(c => ({
          ...c,
          type: CLAIM_TYPES[c.preliminaryType.toUpperCase()]
        }));
      }
    }
    
    // AI 응답에서 JSON을 추출할 수 없는 경우
    return candidatesToProcess.map(c => ({
      ...c,
      type: CLAIM_TYPES[c.preliminaryType.toUpperCase()]
    }));
    
  } catch (error) {
    logger.error(`AI를 통한 주장 분류 중 오류 발생: ${error.message}`);
    // 오류 발생 시 원래 후보 반환 (유형은 예비 유형으로 설정)
    return claimCandidates.map(c => ({
      ...c,
      type: CLAIM_TYPES[c.preliminaryType.toUpperCase()]
    }));
  }
}

/**
 * AI가 분류한 유형을 시스템 유형으로 매핑
 * @param {string} aiType - AI가 응답한 유형 문자열
 * @returns {string} - 시스템에서 정의한 유형
 */
function mapAITypeToClaimType(aiType) {
  const lowerType = aiType.toLowerCase();
  
  if (lowerType.includes('사실')) return CLAIM_TYPES.FACTUAL;
  if (lowerType.includes('예측')) return CLAIM_TYPES.PREDICTIVE;
  if (lowerType.includes('인과') || lowerType.includes('원인')) return CLAIM_TYPES.CAUSAL;
  if (lowerType.includes('가치')) return CLAIM_TYPES.VALUE;
  if (lowerType.includes('정책')) return CLAIM_TYPES.POLICY;
  
  // 기본값
  return CLAIM_TYPES.FACTUAL;
}

/**
 * 주장에 대한 우선순위 산정
 * @param {Array} claims - 주장 목록
 * @param {string} fullText - 전체 텍스트
 * @returns {Array} - 우선순위가 산정된 주장 목록
 */
function calculateClaimPriorities(claims, fullText) {
  // TF-IDF 분석을 위한 문서 추가
  tfidf.addDocument(fullText);
  
  return claims.map(claim => {
    let priorityScore = 0;
    
    // 1. 주장 유형에 따른 가중치 적용
    const typeWeights = {
      [CLAIM_TYPES.FACTUAL]: 0.8,
      [CLAIM_TYPES.CAUSAL]: 0.7,
      [CLAIM_TYPES.PREDICTIVE]: 0.6,
      [CLAIM_TYPES.POLICY]: 0.5,
      [CLAIM_TYPES.VALUE]: 0.4
    };
    
    const typeWeight = typeWeights[claim.type] || 0.5;
    priorityScore += typeWeight;
    
    // 2. 신뢰도 점수 반영
    priorityScore += claim.confidence * 0.7;
    
    // 3. 주장의 구체성 (개체 포함 여부)
    if (claim.entities && claim.entities.length > 0) {
      priorityScore += Math.min(claim.entities.length * 0.1, 0.3);
    }
    
    // 4. AI가 산정한 체크 가치 점수 반영
    if (claim.checkworthiness) {
      priorityScore += claim.checkworthiness * 0.8;
    }
    
    // 5. 텍스트 위치 가중치 (텍스트 앞에 있을수록 중요할 가능성)
    const positionIndex = fullText.indexOf(claim.text);
    if (positionIndex !== -1) {
      const positionWeight = 1 - (positionIndex / fullText.length);
      priorityScore += positionWeight * 0.3;
    }
    
    // 6. 재인용 여부 (여러 번 등장하는 주장은 중요할 가능성)
    const occurrences = (fullText.match(new RegExp(escapeRegExp(claim.text), 'g')) || []).length;
    if (occurrences > 1) {
      priorityScore += Math.min(occurrences * 0.1, 0.3);
    }
    
    // 최종 우선순위 점수 정규화 (0-1 사이)
    claim.priority = Math.min(priorityScore / 3, 1.0);
    
    return claim;
  });
}

/**
 * 정규식 특수문자 이스케이프 함수
 * @param {string} string - 이스케이프할 문자열
 * @returns {string} - 이스케이프된 문자열
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 주장 유형에 따른 분석 프롬프트 생성
 * @param {string} claimType - 주장 유형
 * @param {string} claimText - 주장 텍스트
 * @returns {string} - 분석 프롬프트
 */
function generateAnalysisPromptByType(claimType, claimText) {
  const prompts = {
    [CLAIM_TYPES.FACTUAL]: `다음 사실적 주장을 검증하기 위해 필요한 정보는 무엇인가요? "${claimText}"`,
    [CLAIM_TYPES.PREDICTIVE]: `다음 예측 주장을 평가하기 위한 근거와 가정은 무엇인가요? "${claimText}"`,
    [CLAIM_TYPES.CAUSAL]: `다음 인과 관계 주장에서 원인과 결과의 관계가 타당한지 어떻게 검증할 수 있나요? "${claimText}"`,
    [CLAIM_TYPES.VALUE]: `다음 가치 주장에 담긴 가치 판단의 기준은 무엇인가요? "${claimText}"`,
    [CLAIM_TYPES.POLICY]: `다음 정책 주장은 어떤 목표와 방법을 제시하고 있나요? "${claimText}"`
  };
  
  return prompts[claimType] || `다음 주장을 검증하기 위해 필요한 정보는 무엇인가요? "${claimText}"`;
}

/**
 * 주장 감지 결과 요약
 * @param {Array} claims - 감지된 주장 목록
 * @returns {Object} - 요약 정보
 */
function summarizeClaimDetection(claims) {
  if (!claims || claims.length === 0) {
    return {
      totalClaims: 0,
      typeDistribution: {},
      averagePriority: 0,
      topClaims: []
    };
  }
  
  // 유형별 분포
  const typeDistribution = {};
  claims.forEach(claim => {
    const type = claim.type;
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;
  });
  
  // 평균 우선순위
  const averagePriority = claims.reduce((sum, claim) => sum + claim.priority, 0) / claims.length;
  
  // 우선순위 상위 3개 주장
  const topClaims = [...claims]
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map(claim => ({
      text: claim.text,
      type: claim.type,
      priority: claim.priority
    }));
  
  return {
    totalClaims: claims.length,
    typeDistribution,
    averagePriority,
    topClaims
  };
}

/**
 * 주장 감지 후 핵심 키워드 추출 및 검색 수행
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<Object>} - 주장 감지 및 검색 결과
 */
async function detectClaimsAndSearch(text) {
  try {
    logger.info(`주장 감지 및 키워드 검색 시작 - 텍스트 길이: ${text.length} 자`);
    
    // 1. 주장 감지 수행
    const detectedClaims = await detectClaims(text);
    logger.info(`주장 감지 완료 - ${detectedClaims.length}개 주장 감지됨`);
    
    if (detectedClaims.length === 0) {
      logger.warn(`주장이 감지되지 않아 키워드 검색을 수행할 수 없습니다.`);
      return {
        claims: [],
        searchResults: null
      };
    }
    
    // 2. 감지된 주장에서 키워드 추출 및 검색 수행
    const claimObjects = detectedClaims.map(claim => ({
      text: claim.text,
      confidence: claim.confidence || claim.priority || 0.5,
      type: claim.type
    }));
    
    logger.info(`감지된 주장에서 키워드 추출 및 검색 시작`);
    const searchResults = await findKeywordAndSearchFromClaims(claimObjects);
    
    // 3. 결과 반환
    return {
      claims: detectedClaims,
      searchResults
    };
  } catch (error) {
    logger.error(`주장 감지 및 키워드 검색 중 오류 발생: ${error.message}`);
    return {
      claims: [],
      searchResults: null,
      error: error.message
    };
  }
}

module.exports = {
  detectClaims,
  CLAIM_TYPES,
  generateAnalysisPromptByType,
  summarizeClaimDetection,
  detectClaimsAndSearch
}; 