/**
 * 팩트체킹 서비스 모듈
 * 추출된 주장을 검증하고 결과를 저장하는 기능을 제공합니다.
 */
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const { formatTimeInterval, trustScoreToVisual, calculateSimilarity } = require('../utils/helpers');
const config = require('../config');
const Claim = require('../models/claim');
const VerificationResult = require('../models/verificationResult');
const { Verification } = require('../models/verification');
const Redis = require('ioredis');
const { tavily } = require('@tavily/core');

// API 키 로깅 (디버깅용)
logger.info('API 키 상태:');
logger.info(`Google AI API 키 설정됨: ${Boolean(process.env.GOOGLE_AI_API_KEY)}, 키 길이: ${process.env.GOOGLE_AI_API_KEY ? process.env.GOOGLE_AI_API_KEY.length : 0}`);
logger.info(`Tavily API 키 설정됨: ${Boolean(process.env.TAVILY_API_KEY)}, 키 길이: ${process.env.TAVILY_API_KEY ? process.env.TAVILY_API_KEY.length : 0}`);
logger.info(`config.api.googleAi.apiKey 설정됨: ${Boolean(config.api.googleAi && config.api.googleAi.apiKey)}, 키 길이: ${config.api.googleAi && config.api.googleAi.apiKey ? config.api.googleAi.apiKey.length : 0}`);
logger.info(`config.api.tavily.apiKey 설정됨: ${Boolean(config.api.tavily && config.api.tavily.apiKey)}, 키 길이: ${config.api.tavily && config.api.tavily.apiKey ? config.api.tavily.apiKey.length : 0}`);

// Google AI 초기화 
let genAI = null;
const initializeGoogleAI = () => {
  try {
    // API 키 확인 (우선순위: 환경 변수 직접 접근 > config 객체 > 기본값)
    // .env 파일이 로드되었는지 확인하기 위해 환경 변수 직접 접근
    const apiKey = process.env.GOOGLE_AI_API_KEY || 
                 (config.api?.googleAi?.apiKey || '') || 
                 (config.apiKeys?.googleAI || '');
    
    // API 키 로그 기록 (비밀번호 부분은 가림)
    if (apiKey) {
      const maskedKey = apiKey.length > 8 ? 
        `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 
        '(유효하지 않은 키)';
      logger.info(`Google AI API 키 사용: ${maskedKey}, 길이: ${apiKey.length}`);
    } else {
      logger.error('Google AI API 키가 없습니다!');
      throw new Error('유효한 Google AI API 키가 설정되지 않았습니다.');
    }
    
    if (apiKey === 'YOUR_GOOGLE_AI_API_KEY') {
      logger.error('Google AI API 키가 기본값으로 설정되어 있습니다.');
      throw new Error('유효한 Google AI API 키로 변경해야 합니다.');
    }
    
    // Google AI 초기화 - 최신 SDK 방식으로 업데이트
    try {
      // 최신 SDK 방식
      genAI = new GoogleGenerativeAI(apiKey);
      logger.info('Google AI 클라이언트 초기화 성공');
    } catch (initError) {
      logger.error(`Google AI 클라이언트 초기화 실패: ${initError.message}`);
      throw initError;
    }
    
    // 모델 이름 환경변수에서 가져오기
    const modelName = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";
    logger.info(`Google AI 모델 사용: ${modelName}`);
    
    return true;
  } catch (error) {
    logger.error(`Google AI 초기화 오류: ${error.message}`);
    return false;
  }
};

// Google AI 초기화 실행
initializeGoogleAI();

// 모델 이름 환경변수에서 가져오기 (전역 상수)
const GEMINI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";

// SSE 클라이언트 관리
let sseClients = [];

// Redis 캐시 설정
const redis = new Redis(config.redis);

// Tavily API 초기화
let tavilyClient = null;

try {
  if (process.env.TAVILY_API_KEY || (config.api?.tavily?.apiKey && config.api.tavily.apiKey !== 'your_tavily_api_key_here')) {
    const { tavily } = require('@tavily/core');
    const apiKey = process.env.TAVILY_API_KEY || config.api.tavily.apiKey;
    tavilyClient = tavily({ apiKey });
    logger.info('Tavily API 클라이언트가 초기화되었습니다.');
  } else {
    logger.warn('Tavily API 키가 설정되지 않았습니다. Tavily 검색 기능이 비활성화됩니다.');
  }
} catch (error) {
  logger.error(`Tavily API 초기화 오류: ${error.message}`);
}

// 캐시 키 생성 함수
function generateCacheKey(type, content) {
  const hash = require('crypto')
    .createHash('md5')
    .update(content)
    .digest('hex');
  return `factcheck:${type}:${hash}`;
}

/**
 * SSE 클라이언트 등록
 * @param {Object} client - SSE 클라이언트 정보
 */
function registerSSEClient(client) {
  sseClients.push(client);
  logger.info(`새 SSE 클라이언트 연결됨: ${client.id}`);
}

/**
 * SSE 클라이언트 제거
 * @param {string} clientId - 제거할 클라이언트 ID
 */
function removeSSEClient(clientId) {
  sseClients = sseClients.filter(client => client.id !== clientId);
  logger.info(`SSE 클라이언트 연결 해제: ${clientId}`);
}

/**
 * 모든 SSE 클라이언트에 이벤트 전송
 * @param {Object} data - 전송할 데이터
 */
function sendEventToAll(data) {
  sseClients.forEach(client => {
    client.response.write(`data: ${JSON.stringify(data)}\n\n`);
  });
}

/**
 * 주장 검증 결과 전송
 * @param {Object} claim - 검증된 주장 정보
 * @param {Object} result - 검증 결과
 */
function sendVerificationResult(claim, result) {
  const data = {
    eventType: 'verification_result',
    claim: claim,
    result: result,
    timestamp: new Date().toISOString()
  };
  
  sendEventToAll(data);
}

/**
 * 검증 상태 및 진행도 업데이트
 * @param {string} claimId - 검증 대상 ID
 * @param {string} status - 검증 상태
 * @param {number} progress - 진행도 (0-100)
 * @returns {Promise<void>}
 */
async function updateVerificationStatus(claimId, status, progress) {
  try {
    await Verification.updateOne(
      { claimId: claimId },
      { 
        $set: { 
          status: status,
          progress: progress,
          updatedAt: new Date()
        }
      }
    );
    console.log(`[팩트체커] 검증 상태 업데이트: ID=${claimId}, 상태=${status}, 진행도=${progress}%`);
    
    // SSE를 통해 클라이언트에도 진행 상태 알림
    sendVerificationProgress(claimId, progress, status);
  } catch (error) {
    console.error(`[팩트체커] 검증 상태 업데이트 오류:`, error);
    logger.error(`[팩트체커] 검증 상태 업데이트 실패: ${error.message}`, { 
      service: 'factchecker',
      claimId,
      error
    });
  }
}

/**
 * 주장 검증 진행상황 전송
 * @param {string} claimId - 주장 ID
 * @param {number} progress - 진행률 (0-100)
 * @param {string} status - 현재 상태 메시지
 */
function sendVerificationProgress(claimId, progress, status) {
  // 검증 진행상황은 전송하지 않음
  return;
}

/**
 * 외부 팩트체크 소스에서 관련 검증 결과 검색
 * @param {string} claimText - 검증할 주장 텍스트
 * @param {string[]} topics - 관련 주제 키워드
 * @returns {Promise<Array>} - 검증 결과 배열
 */
async function checkExternalFactCheckSources(claimText, topics = []) {
  const results = [];
  
  try {
    // 1. 빅카인즈 API 검색
    if (config.api.bigkinds && config.api.bigkinds.apiKey) {
      try {
        console.log('[팩트체커] 빅카인즈 API 검색 중...');
        const bigkindsResponse = await axios.get(
          `${config.api.bigkinds.endpoint}/search`,
          {
            params: {
      query: claimText,
              fields: ['title', 'content'],
              provider: ['factcheck'],
              size: 5
            },
            headers: {
              'Authorization': `Bearer ${config.api.bigkinds.apiKey}`
            }
          }
        );
        
        if (bigkindsResponse.data && bigkindsResponse.data.documents) {
          results.push(...bigkindsResponse.data.documents.map(doc => ({
            source: '빅카인즈',
            url: doc.url,
            title: doc.title,
            rating: doc.factcheck_rating || '확인 필요',
            explanation: doc.content,
            publishedAt: doc.published_at
          })));
        }
      } catch (error) {
        console.warn('[팩트체커] 빅카인즈 API 검색 실패:', error.message);
      }
    }
    
    // 2. Factiverse API 검색
    if (config.api.factiverse && config.api.factiverse.apiKey) {
      try {
        console.log('[팩트체커] Factiverse API 검색 중...');
        const factiverseResponse = await axios.post(
          `${config.api.factiverse.endpoint}/verify`,
          {
            text: claimText,
            topics: topics
          },
          {
            headers: {
              'X-API-Key': config.api.factiverse.apiKey
            }
          }
        );
        
        if (factiverseResponse.data && factiverseResponse.data.results) {
          results.push(...factiverseResponse.data.results.map(result => ({
            source: 'Factiverse',
            url: result.sourceUrl,
            title: result.title,
            rating: result.rating,
            explanation: result.explanation,
            publishedAt: result.publishedAt
          })));
        }
  } catch (error) {
        console.warn('[팩트체커] Factiverse API 검색 실패:', error.message);
      }
    }
    
    // 3. Google Fact Check API 검색
    if (config.api.googleFactCheck && config.api.googleFactCheck.apiKey) {
      try {
        console.log('[팩트체커] Google Fact Check API 검색 중...');
        const googleResponse = await axios.get(
          'https://factchecktools.googleapis.com/v1alpha1/claims:search',
          {
            params: {
      key: config.api.googleFactCheck.apiKey,
      query: claimText,
              languageCode: 'ko'
            }
          }
        );
        
        if (googleResponse.data && googleResponse.data.claims) {
          results.push(...googleResponse.data.claims.map(claim => ({
            source: claim.claimReview[0].publisher.name,
            url: claim.claimReview[0].url,
            title: claim.text,
            rating: claim.claimReview[0].textualRating,
            explanation: claim.claimReview[0].textualRating,
            publishedAt: claim.claimReview[0].reviewDate
          })));
        }
      } catch (error) {
        console.warn('[팩트체커] Google Fact Check API 검색 실패:', error.message);
      }
    }
    
    // 결과가 없는 경우 기본 응답
    if (results.length === 0) {
      console.log('[팩트체커] 외부 팩트체크 결과 없음');
      results.push({
        source: '자동 검증',
        url: null,
        title: '자동 분석 결과',
        rating: '확인 필요',
        explanation: '외부 팩트체크 결과를 찾을 수 없습니다.',
        publishedAt: new Date().toISOString()
      });
    }
  
  return results;
  } catch (error) {
    console.error('[팩트체커] 외부 소스 검색 중 오류:', error);
    return [{
      source: '오류',
      url: null,
      title: '검색 실패',
      rating: '확인 불가',
      explanation: `외부 소스 검색 중 오류 발생: ${error.message}`,
      publishedAt: new Date().toISOString()
    }];
  }
}

/**
 * 검증 결과를 클라이언트에 전송
 * @param {string} claimId - 검증 대상 ID
 * @param {Object} result - 검증 결과 객체
 */
async function sendVerificationComplete(claimId, result) {
  try {
    const trustScore = result.result.trustScore;
    
    // 검증 결과 요약 생성
    const summary = {
      trustScore: trustScore * 100, // 백분율로 변환
      verdict: getVerdict(trustScore),
      mainPoints: []
    };

    // 주요 포인트 추출
    if (result.result.factCheckerAnalysis) {
      summary.mainPoints = result.result.factCheckerAnalysis
        .split('\n')
        .filter(line => line.trim().length > 0)
        .slice(0, 3); // 상위 3개 포인트만 선택
    }

    // 시각화 데이터 생성
    const verificationData = {
      eventType: 'verification_complete', // 이벤트 타입 키 변경
      claimId: claimId,
      summary: summary,
      visualStyle: {
        color: getTrustScoreColor(trustScore),
        icon: getTrustScoreIcon(trustScore)
      },
      timestamp: new Date().toISOString()
    };

    // SSE를 통해 결과 전송
    sseClients.forEach(client => {
      client.response.write(`data: ${JSON.stringify(verificationData)}\n\n`);
    });
    
    console.log(`[팩트체커] 검증 결과 전송 완료: ID=${claimId}, 신뢰도=${summary.trustScore}%`);
  } catch (error) {
    console.error('[팩트체커] 검증 결과 전송 오류:', error);
    // 오류 발생 시 오류 이벤트 전송
    const errorData = {
      eventType: 'verification_error', // 이벤트 타입 키 변경
      claimId: claimId,
      error: error.message
    };
    
    sseClients.forEach(client => {
      client.response.write(`data: ${JSON.stringify(errorData)}\n\n`);
        });
      }
    }

/**
 * 신뢰도 점수에 따른 판정 결과 반환
 * @param {number} trustScore - 신뢰도 점수 (0-1)
 * @returns {string} - 판정 결과
 */
function getVerdict(trustScore) {
  const score = trustScore * 100;
  if (score >= 80) return '사실';
  if (score >= 40) return '부분적 사실';
  if (score >= 20) return '허위';
  return '확인불가';
}

/**
 * 신뢰도 점수에 따른 색상 코드 반환
 * @param {number} trustScore - 신뢰도 점수 (0-1)
 * @returns {string} - 색상 코드
 */
function getTrustScoreColor(trustScore) {
  const score = trustScore * 100;
  if (score >= 80) return '#4CAF50'; // 녹색
  if (score >= 60) return '#8BC34A'; // 연한 녹색
  if (score >= 40) return '#FFC107'; // 노란색
  if (score >= 20) return '#FF9800'; // 주황색
  return '#F44336'; // 빨간색
}

/**
 * 신뢰도 점수에 따른 아이콘 반환
 * @param {number} trustScore - 신뢰도 점수 (0-1)
 * @returns {string} - 아이콘 이름
 */
function getTrustScoreIcon(trustScore) {
  const score = trustScore * 100;
  if (score >= 80) return 'check_circle';
  if (score >= 60) return 'check';
  if (score >= 40) return 'info';
  if (score >= 20) return 'warning';
  return 'error';
}

// 재시도 설정
const RETRY_OPTIONS = {
  maxRetries: 3,
  retryDelay: 1000,
  services: {
    linkup: true,
    genAI: true,
    redis: true
  }
};

// 재시도 로직
async function withRetry(operation, options = {}) {
  const retries = options.maxRetries || RETRY_OPTIONS.maxRetries;
  const delay = options.retryDelay || RETRY_OPTIONS.retryDelay;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`[팩트체커] 재시도 중 (${attempt}/${retries}):`, error.message);
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
}

// 오류 로깅 개선
function logError(context, error, metadata = {}) {
  const errorInfo = {
    context,
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    timestamp: new Date().toISOString(),
    ...metadata
  };
  
  console.error('[팩트체커] 오류 발생:', errorInfo);
  logger.error(JSON.stringify(errorInfo));
}

// 핵심 키워드 추출 함수
async function extractKeywords(text, maxKeywords = 5) {
  try {
    // 입력 텍스트 정리
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      logger.warn('[FactChecker] 키워드 추출에 유효하지 않은 텍스트가 제공되었습니다.');
      return fallbackKeywordExtraction('', maxKeywords);
    }
    
    // 너무 긴 텍스트는 요약하여 처리
    const MAX_LENGTH = 10000;
    const truncatedText = text.length > MAX_LENGTH 
      ? text.substring(0, MAX_LENGTH) + '...' 
      : text;
    
    // Gemini AI를 사용하여 키워드 추출
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    
    // API 키와 모델명 환경변수에서 가져오기 (로깅 개선)
    const apiKey = process.env.GOOGLE_AI_API_KEY || config.api?.googleAi?.apiKey || '';
    const GEMINI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";
    
    logger.info(`[FactChecker] Google AI API 키 사용: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}, 길이: ${apiKey.length}`);
    
    if (!apiKey) {
      logger.error('[FactChecker] Gemini API 키가 설정되지 않았습니다. 기본 키워드 추출 방식을 사용합니다.');
      return fallbackKeywordExtraction(truncatedText, maxKeywords);
    }
    
    try {
      // Gemini 초기화
      const genAI = new GoogleGenerativeAI(apiKey);
      logger.info('[FactChecker] Google AI 클라이언트 초기화 성공');
      
      logger.info(`[FactChecker] Google AI 모델 사용: ${GEMINI_MODEL}`);
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      
      // 텍스트 언어 감지 (한국어/영어 등)
      const isKorean = /[가-힣]/.test(truncatedText);
      const isEnglish = /[a-zA-Z]/.test(truncatedText);
      
      // 개선된 키워드 추출 프롬프트 구성
      let prompt;
      
      if (isKorean) {
        prompt = `[뉴스 핵심 키워드 추출기]

다음 뉴스 본문을 분석하여 인터넷 검색에 최적화된 가장 핵심적인 키워드 ${maxKeywords}개를 추출해주세요:

[뉴스 본문]
"${truncatedText}"

단계별 분석:
1. 뉴스의 주요 주제와 중심 내용을 파악하세요.
2. 주요 인물, 조직, 장소, 사건 등 고유한 개체를 식별하세요.
3. ${maxKeywords}개의 검색 키워드 후보를 추출하고, 각 후보의 중요도를 평가하세요.
4. 검색 효율성이 가장 높은 키워드를 최종 선정하세요.

다음 기준으로 키워드를 선정하세요:
- 뉴스의 핵심 내용을 가장 잘 대표하는 용어
- 검색 시 관련성 높은 결과를 얻을 수 있는 구체적인 용어
- 검색 엔진에서 효과적으로 인식되는 용어
- 해당 뉴스의 고유성을 잘 표현하는 용어

최종 출력 형식:
${maxKeywords}개의 키워드만 쉼표로 구분하여 나열해주세요. 그 외 다른 설명이나 문장은 포함하지 마세요.`;
      } else if (isEnglish) {
        prompt = `[News Keyword Extractor]

Analyze the following news content and extract the ${maxKeywords} most optimized keywords for internet search:

[News Content]
"${truncatedText}"

Step-by-step analysis:
1. Identify the main topic and central content of the news.
2. Identify unique entities such as key people, organizations, places, events.
3. Extract ${maxKeywords} search keyword candidates and evaluate the importance of each.
4. Select the keywords with the highest search efficiency.

Select keywords based on these criteria:
- Terms that best represent the core content of the news
- Specific terms that can yield highly relevant results when searched
- Terms that are effectively recognized by search engines
- Terms that express the uniqueness of the news

Final output format:
List only the ${maxKeywords} keywords separated by commas. Do not include any other explanations or sentences.`;
      } else {
        // 언어 감지 실패시 일반 프롬프트 사용
        prompt = `Extract the ${maxKeywords} most important and search-optimized keywords from the following text:

"${truncatedText}"

Focus on:
- Proper nouns (people, places, organizations)
- Significant events
- Central topics and concepts
- Distinctive terms related to the content

Return only the keywords as a comma-separated list. No explanations or sentences.`;
      }
      
      // Gemini로 키워드 추출
      const result = await model.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }]}],
        generationConfig: {
          temperature: 0.1, // 낮은 온도로 일관된 결과 생성
          maxOutputTokens: 100, // 짧은 응답
        }
      });
      
      // 응답 텍스트 가져오기
      const response = result.response.text().trim();
      logger.info(`[FactChecker] AI 키워드 추출 응답: ${response}`);
      
      // 응답에서 키워드만 추출하여 배열로 변환
      const splitPattern = /,|\n|;|\/|\|/; // 다양한 구분자 지원
      const keywords = response
        .split(splitPattern)
        .map(word => {
          // 키워드 정리 (숫자, 특수문자 등 정리)
          const cleaned = word.trim().replace(/^["'`]|["'`]$/g, '');
          return cleaned;
        })
        .filter(word => word.length > 0) // 빈 문자열 제거
        .slice(0, maxKeywords); // 지정된 개수만큼 자르기
      
      logger.info(`[FactChecker] AI가 추출한 키워드: ${keywords.join(', ')}`);
      
      // 키워드가 추출되지 않은 경우 대체 방법 사용
      if (!keywords || keywords.length === 0) {
        logger.warn('[FactChecker] AI 키워드 추출 결과가 없어 대체 방법 사용');
        return fallbackKeywordExtraction(truncatedText, maxKeywords);
      }
      
      return keywords;
    } catch (aiError) {
      // AI 모델 호출 오류
      logger.error(`[FactChecker] Gemini 모델 호출 오류: ${aiError.message}`);
      
      // 두 번째 시도: 단순화된 프롬프트로 재시도
      try {
        // Gemini 재초기화 및 단순화된 프롬프트
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
        
        const simplePrompt = `다음 텍스트에서 인터넷 검색에 가장 유용한 핵심 키워드 ${maxKeywords}개를 추출해 주세요:
        
"${truncatedText.substring(0, 5000)}"

결과는 키워드만 쉼표로 구분해서 나열해 주세요. 다른 설명은 포함하지 마세요.`;
        
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: simplePrompt }]}],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 100,
          }
        });
        
        const response = result.response.text().trim();
        
        const keywords = response
          .split(/,|\n/)
          .map(word => word.trim())
          .filter(word => word.length > 0)
          .slice(0, maxKeywords);
        
        if (keywords.length > 0) {
          logger.info(`[FactChecker] 단순 프롬프트로 키워드 추출 성공: ${keywords.join(', ')}`);
          return keywords;
        }
      } catch (retryError) {
        logger.error(`[FactChecker] 키워드 추출 재시도 실패: ${retryError.message}`);
      }
      
      // 오류 발생 시 대체 방법 사용
      return fallbackKeywordExtraction(truncatedText, maxKeywords);
    }
  } catch (error) {
    logger.error(`[FactChecker] 키워드 추출 중 오류 발생: ${error.message}`);
    
    // 오류 발생 시 대체 방법 사용
    return fallbackKeywordExtraction(text, maxKeywords);
  }
}

// 기존 키워드 추출 방식 (폴백용) - 개선
function fallbackKeywordExtraction(text, maxKeywords = 5) {
  try {
    if (!text || typeof text !== 'string') {
      logger.warn('[FactChecker] 폴백 키워드 추출에 유효하지 않은 텍스트가 제공되었습니다.');
      return ['뉴스', '정보', '최신', 'news', 'information'].slice(0, maxKeywords);
    }
    
    // 불용어 목록 확장
    const stopWords = new Set([
      // 한글 불용어
      '이', '그', '저', '것', '등', '및', '이런', '또는', '에서', '으로', '하고', '에게', '에게서', '부터',
      '이다', '있다', '하다', '때문', '이라', '되다', '그리고', '그러나', '그래서', '있는', '같은',
      // 영어 불용어
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'about', 
      'like', 'from', 'after', 'before', 'between', 'into', 'through', 'during', 'is', 'are', 'was',
      'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could',
      'of', 'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their'
    ]);
    
    // 한글 형태소 분석과 유사한 기본 처리
    // 띄어쓰기 단위로 나누기
    let words = text.split(/\s+/);
    
    // 어절 단위로 처리
    const processedWords = [];
    for (const word of words) {
      // 특수 문자 및 숫자만 있는 단어 제거
      if (/^[\d\s\W]+$/.test(word)) continue;
      
      // 길이가 너무 짧은 단어 제거 (한글은 1자 이상, 영어는 3자 이상)
      if ((/[가-힣]/.test(word) && word.length < 2) || 
          (/^[a-zA-Z]+$/.test(word) && word.length < 3)) {
        continue;
      }
      
      // 불용어 제거
      if (stopWords.has(word.toLowerCase())) continue;
      
      // 특수 문자 제거
      const cleaned = word.replace(/[^\w가-힣]/g, '');
      if (cleaned.length > 0) {
        processedWords.push(cleaned);
      }
    }
    
    // 빈도수 계산 및 가중치 적용
    const wordFreq = {};
    const titleWeight = 1.5; // 제목에 등장하는 단어에 가중치
    const firstParaWeight = 1.2; // 첫 문단에 등장하는 단어에 가중치
    
    // 간단한 휴리스틱으로 제목과 첫 문단 식별
    const lines = text.split('\n');
    const titleWords = lines.length > 0 ? lines[0].split(/\s+/) : [];
    const firstParaWords = lines.length > 1 ? lines[1].split(/\s+/) : [];
    
    // 빈도수 계산
    processedWords.forEach(word => {
      const lowerWord = word.toLowerCase();
      
      // 기본 가중치로 시작
      if (!wordFreq[lowerWord]) {
        wordFreq[lowerWord] = 0;
      }
      
      // 기본 출현 가중치
      wordFreq[lowerWord] += 1;
      
      // 추가 가중치 적용
      if (titleWords.some(w => w.toLowerCase().includes(lowerWord))) {
        wordFreq[lowerWord] += titleWeight;
      }
      
      if (firstParaWords.some(w => w.toLowerCase().includes(lowerWord))) {
        wordFreq[lowerWord] += firstParaWeight;
      }
    });
    
    // 빈도수 기준 정렬 후 상위 키워드 반환
    const keywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .map(entry => entry[0])
      .slice(0, maxKeywords);
    
    logger.info(`[FactChecker] 폴백 방식으로 추출한 키워드: ${keywords.join(', ')}`);
    
    // 키워드가 추출되지 않은 경우 기본값 반환
    if (keywords.length === 0) {
      return ['뉴스', '정보', '최신', 'news', 'information'].slice(0, maxKeywords);
    }
    
    return keywords;
  } catch (error) {
    logger.error(`[FactChecker] 폴백 키워드 추출 오류: ${error.message}`);
    return ['뉴스', '정보', '최신', 'news', 'information'].slice(0, maxKeywords);
  }
}

// _analyzeContentWithAI 함수 구현 (factChecker.js 상단에 위치시킵니다)
async function _analyzeContentWithAI(content) {
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const apiKey = process.env.GOOGLE_AI_API_KEY || config.api?.googleAi?.apiKey || '';
    const GEMINI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";
    
    if (!apiKey || !content) {
      logger.error('[FactChecker] AI 분석 실패: API 키가 없거나 콘텐츠가 없습니다.');
      return {
        summary: content?.substring(0, 150) + '...',
        claims: [],
        topics: ['뉴스', '정보']
      };
    }
    
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    // 프롬프트 구성
    const prompt = `
    다음 뉴스 콘텐츠를 분석해주세요:
    
    "${content.substring(0, 10000)}"
    
    다음 형식으로 JSON 응답을 제공해주세요:
    {
      "summary": "200자 이내의 뉴스 요약",
      "claims": [
        {"text": "검증 가능한 주장 1", "type": "factual/statistical/opinion"},
        {"text": "검증 가능한 주장 2", "type": "factual/statistical/opinion"}
      ],
      "topics": ["주제1", "주제2", "주제3"]
    }
    
    주의: valid JSON 형식으로만 응답하세요.
    `;
    
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }]}],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      }
    });
    
    const responseText = result.response.text();
    
    // JSON 추출 (마크다운 코드블록이 있을 경우 처리)
    let jsonData;
    try {
      const jsonMatch = responseText.match(/```(?:json)?([\s\S]*?)```/) || [null, responseText];
      const jsonText = jsonMatch[1].trim();
      jsonData = JSON.parse(jsonText);
    } catch (parseError) {
      // 전체 텍스트를 JSON으로 파싱 시도
      try {
        jsonData = JSON.parse(responseText);
      } catch (e) {
        logger.error(`[FactChecker] JSON 파싱 오류: ${e.message}`);
        jsonData = {
          summary: content.substring(0, 150) + '...',
          claims: [],
          topics: ['뉴스', '정보']
        };
      }
    }
    
    return {
      summary: jsonData.summary || '',
      claims: jsonData.claims || [],
      topics: jsonData.topics || []
    };
  } catch (error) {
    logger.error(`[FactChecker] AI 분석 중 오류 발생: ${error.message}`);
    return {
      summary: content?.substring(0, 150) + '...',
      claims: [],
      topics: ['뉴스', '정보']
    };
  }
}

// MCP 서버를 통한 Tavily 검색 (LangGraph 스타일 최적화)
async function searchWithTavilyMCP(content, summary = null) {
  try {
    logger.info('[FactChecker] Tavily 검색 시작');
    
    // 1. 텍스트 준비
    const textForKeywords = summary && summary.length > 100 ? summary : content;
    
    // 2. 키워드 추출
    const allKeywords = await extractKeywords(textForKeywords, 10);
    
    if (!allKeywords || allKeywords.length === 0) {
      logger.warn('[FactChecker] 키워드를 추출할 수 없습니다. 검색을 중단합니다.');
      return { 
        success: false, 
        error: '키워드를 추출할 수 없습니다',
        results: [] 
      };
    }
    
    // 3. 키워드 중요도 분류 - 주요 키워드와 보조 키워드 분리
    const primaryKeywords = allKeywords.slice(0, Math.min(5, allKeywords.length));
    const secondaryKeywords = allKeywords.slice(5);
    
    // 4. 한국어-영어 키워드 매핑 확장
    const koreanToEnglishMap = {
      '미얀마': 'Myanmar',
      '지진': 'earthquake',
      '강진': 'earthquake',
      '만달레이': 'Mandalay',
      '사망자': 'casualties',
      '구조': 'rescue',
      '골든타임': 'golden time',
      '국제지원': 'international support',
      '이재민': 'displaced people',
      '피해': 'damage',
      '재난': 'disaster',
      '긴급구호': 'emergency relief',
      '한국': 'South Korea',
      '북한': 'North Korea',
      '대통령': 'president',
      '수출': 'export',
      '수입': 'import',
      '전쟁': 'war',
      '장관': 'minister',
      '경제': 'economy',
      '코로나': 'COVID',
      '백신': 'vaccine',
      '의료': 'medical',
      '확진': 'confirmed cases',
      '해외': 'overseas',
      '대선': 'presidential election',
      '총선': 'general election',
      '환율': 'exchange rate',
      '주식': 'stocks',
      '실업': 'unemployment',
      '무역': 'trade',
      '무역분쟁': 'trade dispute',
      '투자': 'investment',
      '교육': 'education',
      '테러': 'terrorism',
      '국방': 'defense',
      '핵무기': 'nuclear weapons',
      '기후변화': 'climate change',
      '태풍': 'typhoon',
      '홍수': 'flood',
      '가뭄': 'drought',
      '화재': 'fire',
      '정부': 'government',
      '법안': 'bill',
      '동남아': 'Southeast Asia',
      '갈등': 'conflict',
      '합의': 'agreement',
      '협상': 'negotiation'
    };
    
    // 보강 키워드 (검색 품질 향상용)
    const enhancementTerms = ['최신 정보', '뉴스', 'latest news', 'recent updates'];
    
    // 5. 최적화된 검색 쿼리 구성
    let primaryQueryTerms = [...primaryKeywords];
    
    // 한국어 키워드가 있으면 영어 버전도 추가
    primaryKeywords.forEach(keyword => {
      if (koreanToEnglishMap[keyword]) {
        primaryQueryTerms.push(koreanToEnglishMap[keyword]);
      }
    });
    
    // 최종 쿼리 구성 (주요 키워드 + 보강 용어)
    const optimizedQuery = [...new Set([
      ...primaryQueryTerms.slice(0, 5), // 중복 제거 후 주요 키워드 최대 5개
      enhancementTerms[0],  // '최신 정보'
      enhancementTerms[2]   // 'latest news'
    ])].join(' ');
    
    logger.info(`[FactChecker] Tavily 최적화 검색 쿼리: ${optimizedQuery}`);
    
    // 6. API 키 확인
    const tavilyApiKey = process.env.TAVILY_API_KEY || config.api?.tavily?.apiKey || '';
    
    // API 키 로깅 (마스킹 처리)
    if (tavilyApiKey) {
      const maskedKey = tavilyApiKey.length > 8 ? 
        `${tavilyApiKey.substring(0, 4)}...${tavilyApiKey.substring(tavilyApiKey.length - 4)}` : 
        '(유효하지 않은 키)';
      logger.info(`[FactChecker] Tavily API 키 사용: ${maskedKey}, 길이: ${tavilyApiKey.length}`);
    }
    
    if (!tavilyApiKey) {
      logger.error('[FactChecker] Tavily API 키가 설정되지 않았습니다. 환경변수를 확인하세요.');
      return { 
        success: false, 
        error: 'API 키가 설정되지 않았습니다. 환경변수를 확인하세요.',
        results: [] 
      };
    }
    
    // 7. 관련성 높은 도메인 설정 (특히 뉴스 사이트)
    const includeDomains = [
      // 국제 뉴스 사이트
      'reuters.com', 'ap.org', 'bbc.com', 'news.bbc.co.uk', 
      'nytimes.com', 'washingtonpost.com', 'theguardian.com', 'cnn.com',
      
      // 한국 뉴스 사이트
      'koreaherald.com', 'koreatimes.co.kr', 'chosun.com', 'joins.com', 
      'donga.com', 'mk.co.kr', 'hankyung.com', 'yna.co.kr', 
      'hani.co.kr', 'kmib.co.kr', 'ytn.co.kr', 'news.kbs.co.kr', 
      'news.sbs.co.kr', 'news.jtbc.co.kr', 'news.mbn.co.kr', 'news.tvchosun.com'
    ];
    
    // 8. Tavily API 요청 구성
    const searchParams = {
      api_key: tavilyApiKey,
      query: optimizedQuery,
      search_depth: "advanced",
      max_results: 10,
      include_raw_content: false,
      include_domains: includeDomains
    };
    
    logger.info('[FactChecker] Tavily API 클라이언트 요청 준비 완료');
    // logger.debug(`[FactChecker] Tavily 검색 파라미터: ${JSON.stringify(searchParams, null, 2)}`);
    
    // 9. API 직접 호출 (axios 사용)
    const axios = require('axios');
    let searchResponse;
    
    try {
      logger.info('[FactChecker] Tavily API 요청 시작...');
      // 첫 번째 엔드포인트 시도
      const response = await axios.post('https://api.tavily.com/search', searchParams, {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        timeout: 15000 // 15초 타임아웃
      });
      
      searchResponse = response.data;
      logger.info(`[FactChecker] Tavily API 응답 성공: ${typeof searchResponse}, 결과 수: ${searchResponse.results ? searchResponse.results.length : 0}`);
      
    } catch (apiError) {
      logger.error(`[FactChecker] Tavily API 오류: ${apiError.message}`);
      
      // API 응답 정보 로깅 (디버깅용)
      if (apiError.response) {
        logger.error(`[FactChecker] Tavily API 상태 코드: ${apiError.response.status}`);
        logger.error(`[FactChecker] Tavily API 오류 데이터: ${JSON.stringify(apiError.response.data)}`);
        
        // 오류 응답에 따른 세부 메시지 기록
        if (apiError.response.status === 401) {
          logger.error('[FactChecker] Tavily API 인증 오류: API 키가 잘못되었거나 만료되었습니다.');
        } else if (apiError.response.status === 400) {
          logger.error('[FactChecker] Tavily API 잘못된 요청 오류: 요청 형식이 잘못되었습니다.');
        } else if (apiError.response.status === 429) {
          logger.error('[FactChecker] Tavily API 속도 제한 오류: 너무 많은 요청을 보냈습니다.');
        }
      }
      
      // 인증 오류 시 대체 인증 방식 시도
      if (apiError.response && apiError.response.status === 401) {
        logger.info('[FactChecker] 대체 엔드포인트로 재시도');
        
        try {
          // 대체 엔드포인트 및 Bearer 토큰 방식 시도
          const altResponse = await axios.post('https://api.tavily.com/v1/search', {
            query: optimizedQuery,
            search_depth: "advanced",
            max_results: 10,
            include_domains: includeDomains
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
              'Authorization': `Bearer ${tavilyApiKey}`
            },
            timeout: 15000
          });
          
          searchResponse = altResponse.data;
          logger.info('[FactChecker] 대체 엔드포인트 호출 성공');
          
        } catch (altError) {
          logger.error(`[FactChecker] 대체 엔드포인트 오류: ${altError.message}`);
          throw new Error('Tavily API 인증 오류');
        }
      } else {
        throw apiError; // 재시도 불가능한 다른 오류는 상위로 전파
      }
    }
    
    // 10. 결과 처리
    if (!searchResponse || !searchResponse.results || !Array.isArray(searchResponse.results)) {
      logger.warn(`[FactChecker] Tavily 검색 결과 형식 오류: ${JSON.stringify(searchResponse)}`);
      
      // 검색 결과가 없으면 MCP 모듈로 시도
      try {
        logger.info('[FactChecker] MCP 모듈로 검색 시도');
        
        if (typeof require('mcp_tavily_search') === 'function') {
          const mcpTavilySearch = require('mcp_tavily_search');
          const mcpResponse = await mcpTavilySearch({
            query: optimizedQuery,
            max_results: 10
          });
          
          if (mcpResponse && mcpResponse.results) {
            searchResponse = mcpResponse;
            logger.info('[FactChecker] MCP 모듈을 통한 검색 성공');
          }
        } else {
          logger.warn('[FactChecker] MCP 모듈을 로드할 수 없습니다');
        }
      } catch (mcpError) {
        logger.error(`[FactChecker] MCP 모듈 호출 오류: ${mcpError.message}`);
      }
    }
    
    // 결과 유효성 확인
    if (searchResponse && searchResponse.results && Array.isArray(searchResponse.results)) {
      logger.info(`[FactChecker] Tavily 검색 완료: ${searchResponse.results.length}개 결과`);
      
      // 검색 결과가 충분하지 않은 경우 (3개 미만)
      if (searchResponse.results.length < 3) {
        logger.warn('[FactChecker] 검색 결과가 충분하지 않아 쿼리 재구성...');
        
        // 보다 넓은 범위의 키워드 추출 시도
        const broadKeywords = await extractKeywords(content, 10);
        
        // 더 폭넓은 쿼리 재구성
        const broadQuery = [...new Set([
          ...broadKeywords,
          ...secondaryKeywords,
          ' 최신 뉴스 정보'
        ])].join(' ');
        
        logger.info(`[FactChecker] 넓은 범위 쿼리 재구성: ${broadQuery}`);
        
        try {
          // 넓은 쿼리로 재검색
          const broadResponse = await axios.post('https://api.tavily.com/search', {
            api_key: tavilyApiKey,
            query: broadQuery,
            search_depth: "advanced",
            max_results: 10
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            }
          });
          
          if (broadResponse.data && broadResponse.data.results && 
              Array.isArray(broadResponse.data.results) && 
              broadResponse.data.results.length > 0) {
            
            // 기존 결과와 새 결과 병합
            const uniqueResults = [...searchResponse.results];
            
            // 중복 URL 제거하면서 병합
            broadResponse.data.results.forEach(newResult => {
              if (!uniqueResults.some(existing => existing.url === newResult.url)) {
                uniqueResults.push(newResult);
              }
            });
            
            searchResponse.results = uniqueResults;
            logger.info(`[FactChecker] 넓은 범위 검색 병합 후 결과: ${uniqueResults.length}개`);
          }
        } catch (broadError) {
          logger.error(`[FactChecker] 넓은 범위 검색 오류: ${broadError.message}`);
        }
      }
      
      // 여전히 결과가 부족한 경우 - 마지막 시도
      if (searchResponse.results.length < 2) {
        logger.warn('[FactChecker] 여전히 부족한 결과, 일반 키워드로 마지막 시도...');
        
        const generalKeywords = primaryKeywords
          .slice(0, 2)
          .concat(['latest', 'news', 'information'])
          .join(' ');
        
        try {
          // 도메인 제한 없이 일반 키워드로 검색
          const generalResponse = await axios.post('https://api.tavily.com/search', {
            api_key: tavilyApiKey,
            query: generalKeywords,
            search_depth: "basic",
            max_results: 5
          }, {
            headers: {
              'Content-Type': 'application/json'
            }
          });
          
          if (generalResponse.data && generalResponse.data.results && 
              Array.isArray(generalResponse.data.results) && 
              generalResponse.data.results.length > 0) {
            
            // 결과 병합
            const finalResults = [...searchResponse.results];
            
            generalResponse.data.results.forEach(genResult => {
              if (!finalResults.some(existing => existing.url === genResult.url)) {
                finalResults.push(genResult);
              }
            });
            
            searchResponse.results = finalResults;
            logger.info(`[FactChecker] 일반 검색 병합 후 최종 결과: ${finalResults.length}개`);
          }
        } catch (generalError) {
          logger.error(`[FactChecker] 일반 키워드 검색 오류: ${generalError.message}`);
        }
      }
      
      // 결과 형식화 및 반환
      return {
        success: true,
        query: optimizedQuery,
        results: searchResponse.results,
        timestamp: new Date().toISOString()
      };
    }
    
    // 어떤 방법으로도 결과를 얻지 못한 경우 대체 콘텐츠 제공
    logger.error('[FactChecker] Tavily 검색 결과 없음, 대체 결과 생성');
    
    return {
      success: false,
      query: optimizedQuery,
      error: 'Tavily API에서 검색 결과를 찾을 수 없습니다',
      results: [{
        title: '관련 검색 결과를 찾을 수 없습니다',
        url: '#',
        content: '검색 키워드와 관련된 최신 정보를 찾을 수 없습니다. 다른 키워드로 검색하거나 나중에 다시 시도해보세요.',
        score: 0.5,
        source: 'Tavily API (직접 호출)'
      }],
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error(`[FactChecker] Tavily 검색 중 예외 발생: ${error.message}`);
    
    // 에러 발생 시에도 최소한의 결과 제공
    return {
      success: false,
      error: `검색 처리 중 오류: ${error.message}`,
      results: [{
        title: '검색 처리 중 오류가 발생했습니다',
        url: '#',
        content: `검색 처리 중 다음 오류가 발생했습니다: ${error.message}. 잠시 후 다시 시도해보세요.`,
        score: 0.3,
        source: '오류'
      }],
      timestamp: new Date().toISOString()
    };
  }
}

// 검색 결과 기반 신뢰도 계산 함수
function calculateSearchTrustScore(searchResults, originalContent) {
  // 배열 타입 검증 및 안전한 변환
  const ensureArrayResults = (results) => {
    // 결과가 없는 경우
    if (!results) {
      logger.warn('[FactChecker] 검색 결과가 없습니다 (undefined 또는 null)');
      return [];
    }
    
    // 이미 배열인 경우
    if (Array.isArray(results)) {
      return results;
    }
    
    // 결과가 문자열인 경우 (JSON 파싱 시도)
    if (typeof results === 'string') {
      logger.warn('[FactChecker] 검색 결과가 문자열입니다: ' + results.substring(0, 50) + '...');
      try {
        const parsed = JSON.parse(results);
        if (Array.isArray(parsed)) {
          return parsed;
        } else if (parsed && parsed.results && Array.isArray(parsed.results)) {
          return parsed.results;
        } else {
          logger.error('[FactChecker] 문자열 파싱 결과가 배열이 아닙니다');
          return [];
        }
      } catch (e) {
        logger.error(`[FactChecker] 검색 결과 문자열 파싱 오류: ${e.message}`);
        return [];
      }
    }
    
    // 객체인 경우 (results 속성 확인)
    if (typeof results === 'object') {
      if (results.results && Array.isArray(results.results)) {
        return results.results;
      } else {
        logger.warn(`[FactChecker] 검색 결과 객체에 올바른 results 배열이 없습니다: ${JSON.stringify(Object.keys(results))}`);
        return [];
      }
    }
    
    // 그 외 모든 케이스
    logger.warn(`[FactChecker] 검색 결과가 예상치 못한 형식입니다: ${typeof results}`);
    return [];
  };
  
  try {
    // 검색 결과 배열로 변환
    const resultsArray = ensureArrayResults(searchResults);
    
    // 유효한 검색 결과가 없는 경우
    if (!resultsArray || resultsArray.length === 0) {
      logger.warn('[FactChecker] 변환 후에도 유효한 검색 결과가 없습니다. 기본 신뢰도 0.5 반환');
      return 0.5; // 기본값 반환
    }
    
    // 로깅용으로 결과 데이터 요약
    logger.info(`[FactChecker] 신뢰도 계산 시작: ${resultsArray.length}개 검색 결과 처리`);
    
    // 각 검색 결과의 관련성 및 신뢰도 점수를 기반으로 평균 계산
    let totalRelevanceScore = 0;
    let totalReliabilityScore = 0;
    let validResultsCount = 0;
    
    // 각 검색 결과 항목에 대해 점수 계산
    for (const result of resultsArray) {
      if (!result) continue;
      
      try {
        // 이미 계산된 점수가 있다면 사용
        const relevanceScore = result.score || 
          calculateContentRelevance(result.content || '', originalContent);
        
        const reliabilityScore = result.sourceReliability || 
          calculateSourceReliability(result.url || '#');
        
        // NaN이나 Infinity 등의 유효하지 않은 숫자 확인
        if (!isNaN(relevanceScore) && isFinite(relevanceScore) && 
            !isNaN(reliabilityScore) && isFinite(reliabilityScore)) {
          totalRelevanceScore += relevanceScore;
          totalReliabilityScore += reliabilityScore;
          validResultsCount++;
        }
      } catch (resultError) {
        logger.warn(`[FactChecker] 개별 결과 처리 중 오류: ${resultError.message}`);
        continue;
      }
    }
    
    // 유효한 결과가 없는 경우
    if (validResultsCount === 0) {
      logger.warn('[FactChecker] 유효한 검색 결과가 없습니다. 기본 신뢰도 사용.');
      return 0.5;
    }
    
    // 관련성과 신뢰도의 평균 계산
    const avgRelevanceScore = totalRelevanceScore / validResultsCount;
    const avgReliabilityScore = totalReliabilityScore / validResultsCount;
    
    // 최종 신뢰도 점수 계산 (관련성 70%, 신뢰도 30% 가중치)
    const trustScore = (avgRelevanceScore * 0.7) + (avgReliabilityScore * 0.3);
    
    // 결과에 따라 보정 (결과가 많을수록 신뢰도 증가)
    const resultCountFactor = Math.min(0.1, validResultsCount * 0.01); // 최대 0.1 보너스
    const finalTrustScore = Math.min(0.95, trustScore + resultCountFactor);
    
    logger.info(`[FactChecker] 신뢰도 계산 완료: ${finalTrustScore.toFixed(2)} (관련성: ${avgRelevanceScore.toFixed(2)}, 신뢰도: ${avgReliabilityScore.toFixed(2)}, 결과 수: ${validResultsCount})`);
    
    return finalTrustScore;
  } catch (error) {
    logger.error(`[FactChecker] 신뢰도 계산 중 오류 발생: ${error.message}`);
    // 스택 트레이스 로깅 추가
    logger.error(`[FactChecker] 오류 스택: ${error.stack}`);
    return 0.5; // 오류 시 기본값 반환
  }
}

/**
 * 콘텐츠와 검색 결과의 관련성 점수 계산
 * @param {string} resultContent - 검색 결과 콘텐츠
 * @param {string} originalContent - 원본 콘텐츠 또는 요약
 * @returns {number} 관련성 점수 (0-1 사이)
 */
function calculateContentRelevance(resultContent, originalContent) {
  try {
    if (!resultContent || !originalContent) return 0.5;
    
    // 텍스트 정규화
    const normalizeText = (text) => text.toLowerCase().replace(/\s+/g, ' ').trim();
    
    const normalizedResult = normalizeText(resultContent);
    const normalizedOriginal = normalizeText(originalContent);
    
    // 원본 콘텐츠에서 주요 단어 추출 (3글자 이상)
    const originalWords = normalizedOriginal.split(/\s+/).filter(word => word.length > 3);
    
    // 검색 결과에 포함된 주요 단어 수 계산
    let matchCount = 0;
    originalWords.forEach(word => {
      if (normalizedResult.includes(word)) {
        matchCount++;
      }
    });
    
    // 관련성 점수 계산 (0.3-0.9 범위)
    const relevanceScore = originalWords.length > 0 
      ? 0.3 + Math.min(0.6, (matchCount / originalWords.length) * 0.8)
      : 0.5;
      
    return relevanceScore;
  } catch (error) {
    console.error('관련성 점수 계산 오류:', error.message);
    return 0.5; // 오류 시 중간값 반환
  }
}

/**
 * URL 기반 소스 신뢰도 점수 계산
 * @param {string} url - 검색 결과 URL
 * @returns {number} 신뢰도 점수 (0-1 사이)
 */
function calculateSourceReliability(url) {
  try {
    if (!url) return 0.5;
    
    // 신뢰도 높은 뉴스 도메인 목록
    const highReliabilityDomains = [
      'reuters.com', 'ap.org', 'bbc.com', 'bbc.co.uk', 
      'nytimes.com', 'washingtonpost.com', 'theguardian.com'
    ];
    
    // 중간 신뢰도 뉴스 도메인 목록
    const mediumReliabilityDomains = [
      'cnn.com', 'bloomberg.com', 'ft.com', 'economist.com', 
      'wsj.com', 'time.com', 'apnews.com'
    ];
    
    // URL에서 도메인 추출
    const domainMatch = url.match(/^(?:https?:\/\/)?(?:[^@\n]+@)?(?:www\.)?([^:/\n]+)/im);
    if (!domainMatch) return 0.5;
    
    const domain = domainMatch[1];
    
    // 도메인 기반 신뢰도 점수 할당
    if (highReliabilityDomains.some(d => domain.includes(d))) {
      return 0.9;
    } else if (mediumReliabilityDomains.some(d => domain.includes(d))) {
      return 0.7;
    } else {
      return 0.5; // 기본 신뢰도
    }
  } catch (error) {
    console.error('소스 신뢰도 계산 오류:', error.message);
    return 0.5; // 오류 시 중간값 반환
  }
}

// 검색 결과가 배열인지 확인하고 강제 변환하는 유틸리티 함수
function ensureSearchResultsAreArray(results) {
  if (!results) {
    logger.warn('[FactChecker] 검색 결과가 없습니다 (undefined 또는 null)');
    return [];
  }
  
  // 이미 배열인 경우
  if (Array.isArray(results)) {
    return results;
  }
  
  // 문자열인 경우 파싱 시도
  if (typeof results === 'string') {
    logger.warn('[FactChecker] 검색 결과가 문자열입니다: ' + results.substring(0, 50) + '...');
    try {
      const parsed = JSON.parse(results);
      if (Array.isArray(parsed)) {
        return parsed;
      } else if (parsed && parsed.results && Array.isArray(parsed.results)) {
        return parsed.results;
      } else {
        logger.error('[FactChecker] 문자열 파싱 결과가 배열이 아닙니다');
        return [];
      }
    } catch (e) {
      logger.error(`[FactChecker] 검색 결과 문자열 파싱 오류: ${e.message}`);
      return [];
    }
  }
  
  // 객체인 경우 results 속성 확인
  if (typeof results === 'object') {
    if (results.results && Array.isArray(results.results)) {
      return results.results;
    } else {
      logger.warn(`[FactChecker] 검색 결과 객체에 올바른 results 배열이 없습니다`);
      return [];
    }
  }
  
  // 그 외 모든 케이스
  logger.warn(`[FactChecker] 검색 결과가 예상치 못한 형식입니다: ${typeof results}`);
  return [];
}

// 통합 검색 함수
async function performIntegratedSearch(content, summary = null) {
  try {
    let allResults = [];
    let errorCount = 0;
    let searchDebugInfo = [];
    
    // API 키 유효성 확인
    const tavilyApiKey = process.env.TAVILY_API_KEY || config.api?.tavily?.apiKey || '';
    const braveApiKey = process.env.BRAVE_API_KEY || config.api?.brave?.apiKey || '';
    
    // API 키 상태 로깅
    logger.info(`[FactChecker] API 키 확인 - Tavily: ${tavilyApiKey ? '설정됨' : '없음'}, Brave: ${braveApiKey ? '설정됨' : '없음'}`);
    
    // 1. Tavily 검색 시도 (summary 전달)
    if (tavilyApiKey) {
      try {
        logger.info('[FactChecker] Tavily 검색 시작');
        const tavilyResults = await searchWithTavilyMCP(content, summary);
        
        searchDebugInfo.push({
          source: 'Tavily',
          resultType: typeof tavilyResults,
          success: !!tavilyResults?.success,
          resultsCount: tavilyResults?.results?.length || 0,
          status: 'completed'
        });
        
        // 결과 검증 및 변환
        if (tavilyResults && typeof tavilyResults === 'object') {
          if (tavilyResults.success && tavilyResults.results) {
            // 결과가 배열인지 확인하고 강제 변환
            const resultsArray = ensureSearchResultsAreArray(tavilyResults.results);
            
            if (resultsArray.length > 0) {
              allResults = [...allResults, ...resultsArray];
              logger.info(`[FactChecker] Tavily 검색 결과: ${resultsArray.length}개 항목 추가됨`);
            } else {
              logger.warn('[FactChecker] Tavily 배열 변환 후 결과가 비어있습니다');
              errorCount++;
            }
          } else {
            logger.warn(`[FactChecker] Tavily 검색 실패 또는 결과 없음: ${tavilyResults?.error || '알 수 없는 오류'}`);
            errorCount++;
          }
        } else {
          // 문자열이나 기타 타입인 경우 변환 시도
          const parsedResults = ensureSearchResultsAreArray(tavilyResults);
          
          if (parsedResults.length > 0) {
            allResults = [...allResults, ...parsedResults];
            logger.info(`[FactChecker] Tavily 변환 성공: ${parsedResults.length}개 항목`);
          } else {
            logger.warn(`[FactChecker] Tavily 검색 결과 타입 오류 또는 변환 실패: ${typeof tavilyResults}`);
            errorCount++;
          }
        }
      } catch (tavilyError) {
        logger.error(`[FactChecker] Tavily 검색 오류: ${tavilyError.message}`);
        searchDebugInfo.push({
          source: 'Tavily',
          error: tavilyError.message,
          status: 'error'
        });
        errorCount++;
      }
    } else {
      logger.warn('[FactChecker] Tavily API 키가 설정되지 않아 검색을 건너뜁니다');
      searchDebugInfo.push({
        source: 'Tavily',
        status: 'skipped',
        reason: 'API 키 없음'
      });
      errorCount++;
    }
    
    // 결과 배열 유효성 확인
    if (!Array.isArray(allResults)) {
      logger.error(`[FactChecker] 결과가 배열이 아님: ${typeof allResults}`);
      allResults = [];
    }
    
    // 2. Brave Search 시도 (요약문 활용)
    if (braveApiKey && (allResults.length < 5 || errorCount > 0)) {
      try {
        logger.info('[FactChecker] Brave Search 검색 시작');
        
        // 요약문이 있으면 요약문에서 키워드 추출, 없으면 원본 콘텐츠에서 추출
        const textForKeywords = summary && summary.length > 50 ? summary : content;
        const keywords = await extractKeywords(textForKeywords, 5);
        const query = keywords.join(' ');
        
        logger.info(`[FactChecker] Brave Search 쿼리: ${query}`);
        
        // axios로 직접 API 호출
        const axios = require('axios');
        let braveResults;
        
        try {
          const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
            params: {
              q: query,
              count: 10
            },
            headers: {
              'Accept': 'application/json',
              'X-Subscription-Token': braveApiKey
            },
            timeout: 10000 // 10초 타임아웃
          });
          
          braveResults = response.data;
          logger.info(`[FactChecker] Brave Search API 호출 성공: ${typeof braveResults}`);
        } catch (braveApiError) {
          logger.error(`[FactChecker] Brave API 직접 호출 오류: ${braveApiError.message}`);
          
          if (braveApiError.response) {
            logger.error(`[FactChecker] Brave API 응답 상태: ${braveApiError.response.status}`);
          }
          
          // MCP Brave 모듈로 대체 시도
          try {
            const braveSearch = require('mcp_brave_search');
            const braveResponse = await braveSearch.brave_web_search({
              query: query,
              count: 10
            });
            
            braveResults = braveResponse;
          } catch (mcpError) {
            logger.error(`[FactChecker] MCP Brave 모듈 호출 오류: ${mcpError.message}`);
            throw new Error('모든 Brave 검색 호출 방식 실패');
          }
        }
        
        // 검색 디버깅 정보 추가
        searchDebugInfo.push({
          source: 'Brave',
          resultType: typeof braveResults,
          resultsFormat: braveResults?.web?.results ? 'web.results' : (braveResults?.results ? 'results' : (braveResults?.data ? 'data' : 'unknown')),
          status: 'completed'
        });
        
        // 결과 형식 확인 및 추출
        let braveSearchResults = [];
        
        if (braveResults?.web?.results && Array.isArray(braveResults.web.results)) {
          braveSearchResults = braveResults.web.results;
        } else if (braveResults?.results && Array.isArray(braveResults.results)) {
          braveSearchResults = braveResults.results;
        } else if (braveResults?.data && Array.isArray(braveResults.data)) {
          braveSearchResults = braveResults.data;
        } else {
          // 다른 형식 시도
          braveSearchResults = ensureSearchResultsAreArray(braveResults);
        }
        
        if (braveSearchResults.length > 0) {
          const formattedResults = braveSearchResults.map(item => {
            if (!item) return null;
            
            // 콘텐츠 필드 추출 (API 응답 형식에 따라 다른 필드명 대응)
            const itemContent = item.description || item.snippet || item.content || '';
            
            // 콘텐츠 관련성 및 소스 신뢰도 점수 계산
            const contentRelevanceScore = calculateContentRelevance(itemContent, textForKeywords);
            const sourceReliability = calculateSourceReliability(item.url || '#');
            
            // 최종 점수는 관련성과 신뢰도의 가중 평균
            const finalScore = (contentRelevanceScore * 0.7) + (sourceReliability * 0.3);
            
            return {
              title: item.title || '제목 없음',
              url: item.url || '#',
              content: itemContent,
              score: finalScore,
              source: 'Brave Search',
              sourceReliability: sourceReliability
            };
          }).filter(Boolean); // null 항목 제거
          
          allResults = [...allResults, ...formattedResults];
          logger.info(`[FactChecker] Brave Search 결과: ${formattedResults.length}개 항목 추가`);
        } else {
          logger.warn('[FactChecker] Brave Search 결과 없음');
          errorCount++;
        }
      } catch (braveError) {
        logger.error(`[FactChecker] Brave Search 오류: ${braveError.message}`);
        searchDebugInfo.push({
          source: 'Brave',
          error: braveError.message,
          status: 'error'
        });
        errorCount++;
      }
    } else if (!braveApiKey) {
      logger.warn('[FactChecker] Brave Search API 키가 설정되지 않아 검색을 건너뜁니다');
      searchDebugInfo.push({
        source: 'Brave',
        status: 'skipped',
        reason: 'API 키 없음'
      });
    } else {
      logger.info('[FactChecker] Tavily에서 충분한 결과를 얻어 Brave Search 건너뜀');
      searchDebugInfo.push({
        source: 'Brave',
        status: 'skipped',
        reason: '충분한 결과 확보'
      });
    }
    
    // 결과 배열 유효성 재확인
    if (!Array.isArray(allResults)) {
      logger.error(`[FactChecker] 최종 결과가 배열이 아님: ${typeof allResults}`);
      allResults = [];
    }
    
    // 최종 결과가 없는 경우 직접 대체 결과 생성
    if (allResults.length === 0) {
      logger.warn('[FactChecker] 모든 검색 API에서 결과를 찾을 수 없어 대체 결과 생성');
      
      // 최소한의 가짜 결과라도 제공 (UI가 더 자연스럽게 표시되도록)
      allResults = [
        {
          title: '관련 정보를 찾을 수 없습니다',
          url: 'https://example.com/no-results',
          content: '이 정보에 대한 관련 검색 결과를 찾을 수 없습니다. 다른 키워드로 검색하거나 나중에 다시 시도해보세요.',
          score: 0.5,
          source: '직접 생성',
          sourceReliability: 0.5
        }
      ];
    }
    
    // 중복 결과 제거 (URL 기준)
    const uniqueResults = allResults.filter((item, index, self) => {
      if (!item || !item.url) return false; // 유효하지 않은 항목 필터링
      return index === self.findIndex((t) => t && t.url === item.url);
    });
    
    // 관련성 점수에 따라 결과 정렬
    const sortedResults = uniqueResults.sort((a, b) => b.score - a.score);
    
    logger.info(`[FactChecker] 통합 검색 완료: 총 ${sortedResults.length}개 결과`);
    
    // 결과 반환 - 항상 배열로 결과 반환 보장
    return {
      success: true,
      results: sortedResults,
      timestamp: new Date(),
      stats: {
        totalResults: sortedResults.length,
        sources: {
          tavily: sortedResults.filter(item => item.source === 'Tavily API (직접 호출)').length,
          brave: sortedResults.filter(item => item.source === 'Brave Search').length,
          fallback: sortedResults.filter(item => item.source === '직접 생성').length
        }
      },
      debugInfo: searchDebugInfo
    };
  } catch (error) {
    logger.error(`[FactChecker] 통합 검색 중 오류 발생:`, error);
    
    // 오류 발생 시에도 빈 배열 대신 대체 콘텐츠 제공
    return {
      success: false,
      results: [
        {
          title: '검색 중 오류가 발생했습니다',
          url: '#',
          content: `검색 처리 중 오류가 발생했습니다: ${error.message}. 나중에 다시 시도해주세요.`,
          score: 0.3,
          source: '오류',
          sourceReliability: 0.3
        }
      ],
      error: error.message,
      timestamp: new Date()
    };
  }
}

class FactChecker {
  constructor() {
    this.logger = logger;
  }

  /**
   * 콘텐츠 처리 컨텍스트 생성
   * @param {string} url - 검증할 URL
   * @returns {Object} 로깅 컨텍스트
   */
  createContext(url) {
    return {
      url,
      processId: Math.random().toString(36).substring(7),
      startTime: Date.now(),
      steps: []
    };
  }

  /**
   * 처리 단계 로깅
   * @param {Object} context - 로깅 컨텍스트
   * @param {string} step - 처리 단계
   * @param {Object} data - 로깅 데이터
   */
  logStep(context, step, data = {}) {
    const stepInfo = {
      step,
      timestamp: new Date().toISOString(),
      duration: Date.now() - context.startTime,
      ...data
    };
    
    context.steps.push(stepInfo);
    
    this.logger.info(`[FactChecker] ${step}`, {
      ...context,
      currentStep: stepInfo
    });
  }

  /**
   * 콘텐츠 로깅
   * @param {Object} context - 로깅 컨텍스트
   * @param {string} type - 콘텐츠 타입
   * @param {string} content - 콘텐츠
   */
  logContent(context, type, content) {
    if (!content) return;
    
    const preview = content.substring(0, 200) + (content.length > 200 ? '...' : '');
    this.logStep(context, `${type} 콘텐츠`, {
      contentType: type,
      contentPreview: preview,
      contentLength: content.length
    });
  }

  /**
   * FireCrawl을 사용하여 URL에서 콘텐츠 추출 (외부 API용)
   * @param {string} url - 추출할 URL
   * @returns {Promise<Object>} 추출 결과
   */
  async extractContentWithFireCrawl(url) {
    return await _extractContentWithFireCrawl(url);
  }

  /**
   * 콘텐츠 분석 및 AI 요약 생성 (외부 API용)
   * @param {string} content - 분석할 콘텐츠
   * @returns {Promise<Object>} - 분석 결과
   */
  async analyzeContentWithAI(content) {
    return await _analyzeContentWithAI(content);
  }

  /**
   * 신뢰도 점수를 기반으로 판정 결과 계산
   * @param {number} trustScore - 신뢰도 점수
   * @returns {string} 판정 결과
   */
  calculateVerdict(trustScore) {
    if (trustScore >= 0.8) return '사실';
    if (trustScore >= 0.4) return '부분적 사실';
    if (trustScore >= 0.2) return '허위';
    return '확인불가';
  }

  /**
   * 향상된 콘텐츠 검증
   * @param {string} url - 검증할 URL
   * @param {string} content - 검증할 콘텐츠 (선택사항)
   * @returns {Promise<Object>} 검증 결과
   */
  async enhancedVerifyContent(url, content = null) {
    const context = this.createContext(url);
    
    try {
      this.logStep(context, '검증 시작', { url });
      
      // 1. 콘텐츠 추출
      let extractedContent = content;
      let title = '';
      let validUrl = url;
      
      if (!content && url) {
        this.logStep(context, 'URL 콘텐츠 추출 시작');
        try {
          // 기존 추출기 사용
          const contentExtractor = require('../utils/contentExtractor');
          const extracted = await contentExtractor.extractContent(url);
          if (extracted && extracted.success && extracted.content) {
            extractedContent = extracted.content;
            title = extracted.title || '';
            this.logContent(context, '추출된', extractedContent);
          } else {
            logger.warn(`[FactChecker] 콘텐츠 추출 실패: ${url}`);
            throw new Error('콘텐츠를 추출할 수 없습니다.');
          }
        } catch (extractError) {
          logger.error(`[FactChecker] 콘텐츠 추출 오류: ${extractError.message}`);
          throw new Error(`콘텐츠 추출 오류: ${extractError.message}`);
        }
      }
      
      if (!extractedContent) {
        throw new Error('콘텐츠를 추출할 수 없습니다.');
      }
      
      // 2. AI 분석
      this.logStep(context, 'AI 분석 시작');
      // this.analyzeContent 대신 분석 함수를 직접 구현
      const analysis = {
        summary: '',
        mainClaims: [],
        topics: [],
        title: title || ''
      };
      
      // Gemini AI를 사용한 콘텐츠 분석
      try {
        const geminiAnalysis = await this.analyzeContentWithAI(extractedContent);
        if (geminiAnalysis) {
          analysis.summary = geminiAnalysis.summary || '';
          analysis.mainClaims = geminiAnalysis.claims || [];
          analysis.topics = geminiAnalysis.topics || [];
          analysis.title = geminiAnalysis.title || title || '';
        }
      } catch (aiError) {
        logger.error(`[FactChecker] AI 분석 오류: ${aiError.message}`);
        // 기본 분석 수행 (오류 발생시)
        analysis.summary = extractedContent.length > 300 
          ? extractedContent.substring(0, 300) + '...'
          : extractedContent;
        analysis.topics = ['뉴스', '기사']; // 기본 토픽
      }
      
      this.logStep(context, 'AI 분석 완료', {
        summary: analysis.summary?.substring(0, 100) + '...',
        claimsCount: analysis.mainClaims?.length,
        topicsCount: analysis.topics?.length
      });
      
      // 3. 통합 검색 수행
      this.logStep(context, '통합 검색 시작');
      const searchResponse = await performIntegratedSearch(extractedContent, analysis.summary);
      const searchResults = searchResponse.results || [];
      
      this.logStep(context, '통합 검색 완료', { 
        resultCount: searchResults.length,
        success: searchResponse.success 
      });
      
      // 4. 검색 기반 신뢰도 계산
      this.logStep(context, '신뢰도 계산 시작');
      const trustScore = calculateSearchTrustScore(searchResults, extractedContent);
      this.logStep(context, '신뢰도 계산 완료', { trustScore });
      
      // 5. 결과 구성
      const result = {
        url: validUrl || '',
        title: title || analysis.title || '',
        summary: analysis.summary || '',
        trustScore,
        verdict: this.calculateVerdict(trustScore),
        verifiedClaims: analysis.mainClaims || [],
        topics: analysis.topics || [],
        sources: Array.isArray(searchResults) ? searchResults.map(result => ({
          title: result.title || '제목 없음',
          url: result.url || '#',
          content: result.content || '',
          relevanceScore: result.score || 0.5,
          sourceReliability: result.sourceReliability || 0.5
        })) : [],
        relatedArticles: analysis.relatedArticles || [],
        metadata: {
          verifiedAt: new Date().toISOString(),
          contentExtracted: !!extractedContent,
          analysisMethod: 'hybrid',
          aiModel: GEMINI_MODEL,
          searchDebugInfo: searchResponse.debugInfo,
          processingSteps: context.steps
        }
      };
      
      this.logStep(context, '검증 완료', {
        trustScore: result.trustScore,
        verdict: result.verdict,
        processingTime: Date.now() - context.startTime
      });
      
      return result;
      
    } catch (error) {
      this.logger.error('[FactChecker] 검증 중 오류 발생', {
        ...context,
        error: {
          message: error.message,
          stack: error.stack
        }
      });
      throw error;
    }
  }
}

module.exports = new FactChecker(); 