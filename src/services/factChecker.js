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
    const words = text.split(/\s+/);
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', '등', '및', '이', '그', '저']);
    const keywords = words
      .filter(word => word.length > 1 && !stopWords.has(word.toLowerCase()))
      .slice(0, maxKeywords);
    return keywords;
  } catch (error) {
    console.error('키워드 추출 실패:', error);
    return text.split(/\s+/).slice(0, 3);
  }
}

// MCP 서버를 통한 Tavily 검색
async function searchWithTavilyMCP(content) {
  try {
    console.log('Tavily 검색 시작...');
    
    // 키워드 추출
    const keywords = await extractKeywords(content, 5);
    
    if (!keywords || keywords.length === 0) {
      console.warn('키워드를 추출할 수 없어 검색을 진행할 수 없습니다.');
      return { success: false, error: '검색 키워드를 추출할 수 없습니다.', results: [] };
    }
    
    // 검색 쿼리 구성
    const query = keywords.join(' ');
    console.log(`Tavily 검색 쿼리: ${query}`);
    
    // API 키 확인
    if (!process.env.TAVILY_API_KEY && (!config.api.tavily || !config.api.tavily.apiKey || config.api.tavily.apiKey === 'your_tavily_api_key_here')) {
      console.warn('유효한 Tavily API 키가 설정되지 않았습니다. 검색 결과를 반환하지 않습니다.');
      return { success: false, error: 'API 키가 설정되지 않았습니다.', results: [] };
    }
    
    try {
      // Tavily 클라이언트 설정
      const { tavily } = require('@tavily/core');
      const apiKey = process.env.TAVILY_API_KEY || (config.api?.tavily?.apiKey || '');
      
      const tavilyClient = tavily({ 
        apiKey: apiKey
      });
      
      // Tavily 검색 요청
      const searchResponse = await tavilyClient.search({
        query: query,
        searchDepth: "basic",
        includeDomains: ["news.com", "reuters.com", "ap.org", "bbc.com", "news.bbc.co.uk"],
        maxResults: 5
      });
      
      console.log(`Tavily 검색 완료: ${searchResponse.results ? searchResponse.results.length : 0}개 결과`);
      
      // 결과 형식화
      const formattedResults = searchResponse.results.map(item => ({
        title: item.title || '제목 없음',
        url: item.url,
        content: item.content || item.snippet || '',
        score: 0.7, // 기본 점수 사용 (calculateRelevanceScore 함수가 구현되지 않음)
        publishedDate: item.publishedDate || new Date().toISOString()
      }));
      
      return {
        success: true,
        results: formattedResults
      };
    } catch (innerError) {
      console.error('Tavily API 호출 오류:', innerError.message);
      return { 
        success: false, 
        error: innerError.message || 'Tavily API 호출 중 오류가 발생했습니다.', 
        results: [] 
      };
    }
  } catch (error) {
    console.error('Tavily 검색 실패:', error.message);
    return {
      success: false,
      error: error.message || '검색 중 오류가 발생했습니다.',
      results: []
    };
  }
}

// 통합 검색 함수
async function performIntegratedSearch(content) {
  try {
    let allResults = [];
    let errorCount = 0;
    
    // 1. Tavily 검색 시도
    try {
      logger.info('[FactChecker] Tavily 검색 시작');
      const tavilyResults = await searchWithTavilyMCP(content);
      
      if (tavilyResults && tavilyResults.success && tavilyResults.results && tavilyResults.results.length > 0) {
        allResults = [...tavilyResults.results];
        logger.info(`[FactChecker] Tavily 검색 결과: ${tavilyResults.results.length}개 항목 추가`);
      } else {
        logger.warn(`[FactChecker] Tavily 검색 실패 또는 결과 없음: ${tavilyResults?.error || '알 수 없는 오류'}`);
        errorCount++;
      }
    } catch (tavilyError) {
      logger.error(`[FactChecker] Tavily 검색 오류: ${tavilyError.message}`);
      errorCount++;
    }
    
    // 2. Brave Search 시도 (MCP)
    try {
      logger.info('[FactChecker] Brave Search 검색 시작');
      // 키워드 추출
      const keywords = await extractKeywords(content, 5);
      const query = keywords.join(' ');
      
      const braveSearch = require('mcp_brave_search');
      const braveResults = await braveSearch.brave_web_search({
        query: query,
        count: 10
      });
      
      if (braveResults && braveResults.data && braveResults.data.length > 0) {
        const formattedResults = braveResults.data.map(item => ({
          title: item.title || '제목 없음',
          url: item.url,
          content: item.description || '',
          score: item.relevance_score || 0.7,
          source: 'Brave Search'
        }));
        
        allResults = [...allResults, ...formattedResults];
        logger.info(`[FactChecker] Brave Search 결과: ${formattedResults.length}개 항목 추가`);
      } else {
        logger.warn('[FactChecker] Brave Search 결과 없음');
        errorCount++;
      }
    } catch (braveError) {
      logger.error(`[FactChecker] Brave Search 오류: ${braveError.message}`);
      errorCount++;
    }
    
    // 3. Web Search API 추가 (웹 검색 MCP)
    try {
      if (allResults.length < 5 && errorCount > 0) {
        logger.info('[FactChecker] Web Search API 검색 시도 (백업)');
        const keywords = await extractKeywords(content, 5);
        const query = keywords.join(' ');
        
        const webSearch = require('mcp_web_search');
        const webResults = await webSearch.web_search({
          query: query,
          limit: 5
        });
        
        if (webResults && webResults.results && webResults.results.length > 0) {
          const formattedResults = webResults.results.map(item => ({
            title: item.title || '제목 없음',
            url: item.url,
            content: item.snippet || '',
            score: 0.6,
            source: 'Web Search'
          }));
          
          allResults = [...allResults, ...formattedResults];
          logger.info(`[FactChecker] Web Search 결과: ${formattedResults.length}개 항목 추가`);
        }
      }
    } catch (webError) {
      logger.warn(`[FactChecker] Web Search 오류: ${webError.message}`);
    }
    
    // 중복 결과 제거 (URL 기준)
    const uniqueResults = allResults.filter((item, index, self) => 
      index === self.findIndex((t) => t.url === item.url)
    );
    
    // 결과가 없을 경우 처리
    if (uniqueResults.length === 0) {
      logger.warn('[FactChecker] 모든 검색 API에서 결과를 찾을 수 없습니다.');
      return {
        success: false,
        results: [],
        error: '검색 결과를 찾을 수 없습니다.',
        timestamp: new Date()
      };
    }
    
    logger.info(`[FactChecker] 통합 검색 완료: 총 ${uniqueResults.length}개 결과`);
    
    // 결과 반환
    return {
      success: true,
      results: uniqueResults,
      timestamp: new Date()
    };
  } catch (error) {
    logger.error(`[FactChecker] 통합 검색 실패: ${error.message}`);
    return {
      success: false,
      results: [],
      error: error.message || '검색 중 오류가 발생했습니다.',
      timestamp: new Date()
    };
  }
}

// 신뢰도 점수 계산 함수 (통합 검색용)
function calculateSearchTrustScore(searchResults, content) {
  try {
    // 검색 결과가 없으면 중간 값 반환
    if (!searchResults || searchResults.length === 0) {
      logger.warn('[FactChecker] 검색 결과 없음, 기본 신뢰도 0.5 반환');
      return 0.5;
    }
    
    // content가 문자열인지 확인하고 필요시 변환
    let textContent = content;
    if (!content) {
      logger.warn('[FactChecker] 콘텐츠가 없음, 기본 신뢰도 0.5 반환');
      return 0.5;
    }
    
    // content가 문자열이 아니면 문자열로 변환 시도
    if (typeof content !== 'string') {
      try {
        if (content.text) {
          textContent = content.text;
        } else if (content.content) {
          textContent = content.content;
        } else {
          textContent = JSON.stringify(content);
        }
        logger.info(`[FactChecker] 콘텐츠를 문자열로 변환 (${typeof content} -> 문자열)`);
      } catch (conversionError) {
        logger.error(`[FactChecker] 콘텐츠 변환 오류: ${conversionError.message}`);
        return 0.5;
      }
    }
    
    // 전체 콘텐츠에서 핵심 문장 추출 (최대 10개)
    const sentences = textContent
      .replace(/\s+/g, ' ')
      .split(/[.!?]/)
      .map(s => s.trim())
      .filter(s => s.length > 15 && s.length < 200)
      .slice(0, 10);
    
    if (sentences.length === 0) {
      logger.warn('[FactChecker] 분석 가능한 문장 없음, 기본 신뢰도 0.5 반환');
      return 0.5;
    }
    
    // 각 검색 결과에 대한 관련성 점수 계산
    const relevanceScores = searchResults.map(result => {
      // 결과 내용이 없으면 관련성 낮음
      if (!result.content || result.content.length < 50) {
        return 0.1;
      }
      
      // 검색 결과 내용을 문장으로 분리
      const resultSentences = result.content
        .replace(/\s+/g, ' ')
        .split(/[.!?]/)
        .map(s => s.trim())
        .filter(s => s.length > 5);
      
      // 원본 문장과 검색 결과 문장 간 유사도 계산
      let matchCount = 0;
      let totalComparisons = 0;
      
      for (const sentence of sentences) {
        for (const resultSentence of resultSentences) {
          totalComparisons++;
          
          // 간단한 유사도 체크: 핵심 구문이 포함되는지 확인
          const words = sentence.split(' ').filter(w => w.length > 3);
          const matchingWords = words.filter(word => 
            resultSentence.toLowerCase().includes(word.toLowerCase())
          );
          
          if (matchingWords.length >= 2 || (words.length > 0 && matchingWords.length / words.length > 0.3)) {
            matchCount++;
          }
        }
      }
      
      // 기본 유사도 점수 계산 (0.1~0.9 범위)
      const similarityScore = Math.min(0.9, 0.1 + (matchCount / Math.max(1, totalComparisons)) * 0.8);
      
      // 관련성 점수 = 유사도 x 검색 결과 점수 (결과에 포함된 경우)
      return similarityScore * (result.score || 0.7);
    });
    
    // 상위 5개 결과에 대한 평균 점수 계산
    const topScores = relevanceScores
      .sort((a, b) => b - a)
      .slice(0, 5);
    
    // 평균 점수를 0.1~0.9 범위로 조정
    const avgScore = topScores.reduce((sum, score) => sum + score, 0) / topScores.length;
    const normalizedScore = 0.1 + Math.min(0.8, avgScore * 0.9);
    
    logger.info(`[FactChecker] 검색 기반 신뢰도 점수: ${normalizedScore.toFixed(2)} (${searchResults.length}개 결과)`);
    return normalizedScore;
  } catch (error) {
    logger.error(`[FactChecker] 신뢰도 점수 계산 오류: ${error.message}`);
    return 0.5; // 오류 발생 시 중간값 반환
  }
}

// 모든 SSE 클라이언트에 이벤트 전송
function sendVerificationProgress(claimId, progress, status) {
  // 검증 진행상황은 전송하지 않음
  return;
}

/**
 * 콘텐츠 분석 및 AI 요약 생성 (내부 함수)
 * @param {string} content - 분석할 콘텐츠
 * @returns {Promise<Object>} - 분석 결과
 */
async function _analyzeContentWithAI(content) {
  try {
    // 콘텐츠가 너무 짧으면 기본값 반환
    if (!content || content.length < 50) {
      logger.warn('[FactChecker] 분석할 콘텐츠가 너무 짧음:', content?.length || 0);
      return {
        summary: '콘텐츠가 너무 짧아 분석할 수 없습니다.',
        mainClaims: [],
        topics: []
      };
    }
    
    // Gemini API 준비
    let genAI;
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      // API 키와 모델명 환경변수에서 가져오기
      const apiKey = process.env.GOOGLE_AI_API_KEY || config.api?.googleAi?.apiKey || '';
      genAI = new GoogleGenerativeAI(apiKey);
      logger.info('[FactChecker] Gemini API 초기화 성공');
    } catch (error) {
      logger.error('[FactChecker] Gemini API 초기화 오류:', error);
      throw new Error('AI 분석 서비스를 사용할 수 없습니다.');
    }
    
    // 분석을 위한 콘텐츠 준비 (너무 긴 경우 잘라냄)
    const MAX_LENGTH = 10000;
    const truncatedContent = content.length > MAX_LENGTH 
      ? content.substring(0, MAX_LENGTH) + '...' 
      : content;
    
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    // 1. 콘텐츠 요약 생성
    const summaryPrompt = `다음 콘텐츠를 3-5문장으로 요약해주세요. 핵심 내용과 주요 주장을 포함하세요:
    
    "${truncatedContent}"
    
    요약:`;
    
    let summary = '';
    try {
      const summaryResult = await model.generateContent(summaryPrompt);
      summary = summaryResult.response.text().trim();
      logger.info(`[FactChecker] 콘텐츠 요약 생성 완료: ${summary.length}자`);
    } catch (summaryError) {
      logger.error(`[FactChecker] 요약 생성 오류: ${summaryError.message}`);
      summary = '요약 생성 중 오류가 발생했습니다.';
    }
    
    // 2. 주장 감지 (검증 가능한 사실적 주장 추출)
    const claimsPrompt = `다음 콘텐츠에서 검증 가능한 사실적 주장을 JSON 형식으로 최대 5개 추출해주세요.
    각 주장은 text(주장 내용)와 confidence(신뢰도, 0.0~1.0 사이 숫자)를 포함해야 합니다.
    
    "${truncatedContent}"
    
    응답 형식:
    {
      "claims": [
        {"text": "주장1", "confidence": 0.9},
        {"text": "주장2", "confidence": 0.8}
      ]
    }`;
    
    let mainClaims = [];
    try {
      const claimsResult = await model.generateContent(claimsPrompt);
      const claimsText = claimsResult.response.text().trim();
      
      // JSON 부분만 추출
      const jsonMatch = claimsText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedClaims = JSON.parse(jsonMatch[0]);
        if (parsedClaims.claims && Array.isArray(parsedClaims.claims)) {
          mainClaims = parsedClaims.claims;
        }
      }
      
      logger.info(`[FactChecker] 주장 감지 완료: ${mainClaims.length}개 추출`);
    } catch (claimsError) {
      logger.error(`[FactChecker] 주장 감지 오류: ${claimsError.message}`);
      mainClaims = [];
    }
    
    // 3. 주제 식별
    const topicsPrompt = `다음 콘텐츠의 핵심 주제를 3-5개의 키워드로 추출해주세요.
    각 주제는 1-3단어로 간결하게 표현하세요. JSON 형식으로 응답해주세요.
    
    "${truncatedContent}"
    
    응답 형식:
    {
      "topics": ["주제1", "주제2", "주제3"]
    }`;
    
    let topics = [];
    try {
      const topicsResult = await model.generateContent(topicsPrompt);
      const topicsText = topicsResult.response.text().trim();
      
      // JSON 부분만 추출
      const jsonMatch = topicsText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsedTopics = JSON.parse(jsonMatch[0]);
        if (parsedTopics.topics && Array.isArray(parsedTopics.topics)) {
          topics = parsedTopics.topics;
        }
      }
      
      logger.info(`[FactChecker] 주제 식별 완료: ${topics.length}개 추출`);
    } catch (topicsError) {
      logger.error(`[FactChecker] 주제 식별 오류: ${topicsError.message}`);
      topics = [];
    }
    
    // 분석 결과 반환
    return {
      summary,
      mainClaims,
      topics
    };
  } catch (error) {
    logger.error('[FactChecker] AI 콘텐츠 분석 오류:', error);
    return {
      summary: '콘텐츠 분석 중 오류가 발생했습니다.',
      mainClaims: [],
      topics: []
    };
  }
}

/**
 * 요약 분석 생성
 * @param {Object} data - 콘텐츠 및 분석 데이터
 * @returns {Promise<string>} - 생성된 요약 분석
 */
async function generateSummaryAnalysis(data) {
  if (!genAI) {
    if (!initializeGoogleAI()) {
      return '분석 서비스를 사용할 수 없습니다.';
    }
  }
  
  try {
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    // 분석 데이터 변환
    const { title, content, claims = [], sources = [], factualityScore } = data;
    
    // 주장 형식화
    const claimsText = claims.length > 0
      ? `\n\n주요 주장:\n${claims.map((c, i) => `${i+1}. ${c.text || c}`).join('\n')}`
      : '\n\n주요 주장: 없음';
    
    // 소스 형식화 (최대 3개)
    const sourcesText = sources.length > 0
      ? `\n\n참고 소스:\n${sources.slice(0, 3).map((s, i) => `${i+1}. ${s.title || s.name || '출처 ' + (i+1)}`).join('\n')}`
      : '';
    
    // 신뢰도 점수
    const trustText = factualityScore !== undefined
      ? `\n\n신뢰도 점수: ${typeof factualityScore === 'number' ? (factualityScore * 100).toFixed(0) + '%' : factualityScore}`
      : '';
    
    const truncatedContent = content && content.length > 1500 
      ? content.substring(0, 1500) + '...' 
      : (content || '콘텐츠 없음');
    
    const prompt = `
    다음 콘텐츠에 대한 간결한 요약 분석을 생성해주세요:
    
    제목: ${title || '제목 없음'}
    
    콘텐츠:
    "${truncatedContent}"
    ${claimsText}${sourcesText}${trustText}
    
    다음 내용을 포함하는 3-4문장 분량의 요약 분석을 작성해주세요:
    1. 콘텐츠의 주요 주제
    2. 주요 주장의 신뢰성 평가
    3. 전반적인 신뢰도 평가
    
    분석:
    `;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    logger.error(`요약 분석 생성 오류: ${error.message}`);
    return '요약 분석을 생성할 수 없습니다.';
  }
}

/**
 * 콘텐츠 검증 프로세스 개선 버전
 * 1. URL 제공 시 FireCrawl로 콘텐츠 추출
 * 2. 추출된 콘텐츠 AI 분석
 * 3. 관련 기사 검색
 * 4. 검증 실행
 * 
 * @param {string} url - 검증할 URL (선택적)
 * @param {string} title - 콘텐츠 제목 (선택적)
 * @param {string} content - 검증할 콘텐츠
 * @returns {Promise<Object>} - 검증 결과
 */
async function enhancedVerifyContent(url, title, content) {
  try {
    // URL 로깅 및 유효성 검사
    logger.info(`[FactChecker] 검증 프로세스 시작: URL=${url || '(없음)'}`);
    
    let validUrl = null;
    if (url) {
      try {
        // URL 형식 검증
        const urlObj = new URL(url);
        validUrl = urlObj.toString();
        logger.info(`[FactChecker] 유효한 URL 확인: ${validUrl}`);
      } catch (e) {
        logger.warn(`[FactChecker] 잘못된 URL 형식: ${url}`);
        validUrl = null;
      }
    }
    
    // 캐시된 결과 확인
    const cacheKey = generateCacheKey('verification', validUrl || content);
    const cachedResult = await redis.get(cacheKey);
    
    if (cachedResult) {
      logger.info(`[FactChecker] 캐시된 검증 결과 사용: ${cacheKey}`);
      const result = JSON.parse(cachedResult);
      logVerificationResult(result);
      return result;
    }
    
    let extractedContent = null;
    
    // URL이 제공된 경우 콘텐츠 추출 시도
    if (validUrl) {
      logger.info(`[FactChecker] URL에서 콘텐츠 추출 시작: ${validUrl}`);
      
      // FireCrawl 대신 contentExtractor만 사용 (MCP 브라우저 또는 레거시 방식)
      try {
        logger.info(`[FactChecker] contentExtractor로 콘텐츠 추출 시도: ${validUrl}`);
        const contentExtractor = require('../utils/contentExtractor');
        const extracted = await contentExtractor.extractFromUrl(validUrl);
        
        if (extracted && extracted.title && extracted.content) {
          title = extracted.title || title;
          content = extracted.content || content;
          logger.info(`[FactChecker] contentExtractor 콘텐츠 추출 성공`);
          logExtractedContent({title, content});
        } else {
          logger.warn(`[FactChecker] contentExtractor 콘텐츠 추출 실패`);
        }
      } catch (extractError) {
        logger.error(`[FactChecker] 콘텐츠 추출 오류: ${extractError.message}`);
      }
    } else {
      logger.info(`[FactChecker] 유효한 URL 없음, 제공된 콘텐츠만 사용`);
    }
    
    // 콘텐츠 유효성 검사
    if (!content || content.length < 50) {
      logger.warn(`[FactChecker] 충분한 콘텐츠가 없음: ${content?.length || 0}자`);
      return {
        url: validUrl || '제공되지 않음',
        title: title || '제목 없음',
        summary: '검증 실패: 충분한 콘텐츠가 없습니다',
        trustScore: 0.5,
        verdict: '검증 불가',
        error: '충분한 콘텐츠를 제공해주세요 (최소 50자)'
      };
    }
    
    // AI로 콘텐츠 분석 (요약, 주장 추출, 주제 식별)
    logger.info(`[FactChecker] AI 콘텐츠 분석 시작`);
    const analysis = await _analyzeContentWithAI(content);
    logger.info(`[FactChecker] AI 콘텐츠 분석 완료: 요약=${analysis.summary?.length || 0}자, 주장=${analysis.mainClaims?.length || 0}개, 주제=${analysis.topics?.length || 0}개`);
    
    // 관련 기사 검색 (FireCrawl 사용하지 않음)
    let relatedArticles = [];
    if (validUrl && content) {
      // Brave Search를 사용한 관련 기사 검색으로 대체
      try {
        const urlObj = new URL(validUrl);
        const domainKeywords = urlObj.hostname.replace(/^www\./, '').split('.')[0];
        const searchQuery = `${domainKeywords} ${title?.substring(0, 50) || ''}`;
        
        const braveSearch = require('mcp_brave_search');
        const results = await braveSearch.brave_web_search({
          query: searchQuery,
          count: 5
        });
        
        if (results && results.data && results.data.length > 0) {
          relatedArticles = results.data.map(item => ({
            title: item.title,
            url: item.url,
            source: 'Brave Search'
          }));
          logger.info(`[FactChecker] 관련 기사 검색 완료: ${relatedArticles.length}개 항목`);
        }
      } catch (searchError) {
        logger.warn(`[FactChecker] 관련 기사 검색 오류: ${searchError.message}`);
      }
    }
    
    // 주제 기반 웹 검색 수행 (Brave Search 또는 Tavily)
    let searchResults = [];
    let searchServiceUsed = '';
    
    if (analysis.topics && analysis.topics.length > 0) {
      // 1. 주제와 핵심 키워드 결합하여 검색 쿼리 구성
      let searchQuery = '';
      
      // 핵심 키워드 추출
      const keywords = await extractKeywords(content);
      
      // 주제와 키워드 결합
      if (keywords.length > 0) {
        searchQuery = `${analysis.topics.slice(0, 2).join(' ')} ${keywords.slice(0, 3).join(' ')}`;
      } else {
        searchQuery = analysis.topics.slice(0, 3).join(' ');
      }
      
      // 더 명확한 검색을 위해 제목의 핵심 키워드도 포함
      if (title) {
        const titleKeywords = await extractKeywords(title);
        if (titleKeywords.length > 0) {
          searchQuery = `${searchQuery} ${titleKeywords[0]}`;
        }
      }
      
      logger.info(`[FactChecker] 검색 쿼리 생성: "${searchQuery}"`);
      
      // 2. Brave Search API 사용 시도 (MCP 지원)
      try {
        const braveSearch = require('mcp_brave_search');
        const braveResults = await braveSearch.brave_web_search({
          query: searchQuery,
          count: 10
        });
        
        if (braveResults && braveResults.data && braveResults.data.length > 0) {
          searchResults = braveResults.data.map(item => ({
            title: item.title,
            url: item.url,
            content: item.description || '',
            score: item.relevance_score || 0.5
          }));
          searchServiceUsed = 'Brave Search';
          logger.info(`[FactChecker] Brave Search 결과: ${searchResults.length}개 항목`);
        }
      } catch (braveError) {
        logger.warn(`[FactChecker] Brave Search 오류: ${braveError.message}, Tavily로 대체 시도`);
      }
      
      // 3. Brave Search 실패 시 Tavily API 사용
      if (searchResults.length === 0) {
        try {
          const tavilyResults = await searchWithTavilyMCP(searchQuery);
          
          if (tavilyResults && tavilyResults.results) {
            searchResults = tavilyResults.results;
            searchServiceUsed = 'Tavily';
            logger.info(`[FactChecker] Tavily 검색 결과: ${searchResults.length}개 항목`);
          }
        } catch (tavilyError) {
          logger.error(`[FactChecker] Tavily 검색 오류: ${tavilyError.message}`);
        }
      }
    }
    
    // 주장 검증을 위한 AI 평가
    logger.info(`[FactChecker] 주장 검증 시작: ${analysis.mainClaims.length}개 주장`);
    const trustScorePromises = analysis.mainClaims.map(async (claim, index) => {
      if (index > 2) return null; // 처음 3개 주장만 검증
      
      // FactCheckerIntegration 서비스로 주장 검증
      try {
        const factCheckerIntegration = require('./factCheckerIntegration');
        const verificationResult = await factCheckerIntegration.verifyClaim(claim.text, {
          languageCode: 'ko',
          maxResults: 5
        });
        
        logger.info(`[FactChecker] 주장 검증 완료 (${index+1}/3): "${claim.text.substring(0, 50)}..." - 신뢰도: ${verificationResult.verification.trustScore}`);
        
        return {
          claim: claim.text,
          trustScore: verificationResult.verification.trustScore,
          status: verificationResult.verification.status,
          sources: verificationResult.verification.sources || []
        };
      } catch (verifyError) {
        logger.warn(`[FactChecker] 주장 검증 오류: ${verifyError.message}`);
        return {
          claim: claim.text,
          trustScore: 0.5,
          status: 'UNKNOWN',
          sources: []
        };
      }
    });
    
    // 주장 검증 결과 수집
    const claimVerifications = (await Promise.all(trustScorePromises)).filter(Boolean);
    
    // 검색 결과 기반 신뢰도 점수 계산
    const searchTrustScore = calculateSearchTrustScore(searchResults, content);
    
    // 종합 신뢰도 점수 계산: 검색 결과 + 주장 검증 결과 조합
    let finalTrustScore = searchTrustScore;
    
    if (claimVerifications.length > 0) {
      // 주장 검증 결과의 평균 점수도 반영
      const avgClaimScore = claimVerifications.reduce((acc, cv) => acc + cv.trustScore, 0) / claimVerifications.length;
      // 검색 결과 70%, 주장 검증 30% 가중치
      finalTrustScore = searchTrustScore * 0.7 + avgClaimScore * 0.3;
    }
    
    logger.info(`[FactChecker] 계산된 신뢰도 점수: ${finalTrustScore.toFixed(2)} (검색: ${searchTrustScore.toFixed(2)}, 주장 검증: ${claimVerifications.length}개)`);
    
    // 응답 포맷
    const result = {
      url: validUrl || '제공되지 않음',
      title: title || '제목 없음',
      summary: analysis.summary || '요약 불가',
      trustScore: finalTrustScore,
      verdict: getVerdict(finalTrustScore),
      verifiedClaims: claimVerifications.map(vc => ({
        text: vc.claim,
        trustScore: vc.trustScore,
        status: vc.status,
        sources: vc.sources.slice(0, 3) // 주요 소스 3개만 포함
      })),
      topics: analysis.topics,
      sources: searchResults.map(result => ({
        title: result.title,
        url: result.url,
        content: result.content,
        relevanceScore: result.score || 0.5
      })),
      relatedArticles,
      metadata: {
        verifiedAt: new Date().toISOString(),
        contentExtracted: extractedContent ? extractedContent.success : false,
        analysisMethod: 'hybrid',
        aiModel: GEMINI_MODEL,
        searchServiceUsed
      }
    };
    
    // 캐시에 결과 저장 (30분)
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 1800);
    logger.info(`[FactChecker] 검증 완료 및 결과 캐싱: ${cacheKey}`);
    
    // 최종 검증 결과 로깅
    logVerificationResult(result);
    
    return result;
  } catch (error) {
    logger.error(`[FactChecker] 향상된 콘텐츠 검증 오류:`, error);
    
    return {
      url: url || '제공되지 않음',
      title: title || '제목 없음',
      summary: '검증 실패',
      trustScore: 0.5,
      verdict: '검증 불가',
      verifiedClaims: [],
      topics: [],
      sources: [],
      relatedArticles: [],
      error: error.message
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
      if (!content && url) {
        this.logStep(context, 'URL 콘텐츠 추출 시작');
        extractedContent = await _extractContentWithFireCrawl(url);
        this.logContent(context, '추출된', extractedContent);
      }
      
      if (!extractedContent) {
        throw new Error('콘텐츠를 추출할 수 없습니다.');
      }
      
      // 2. AI 분석
      this.logStep(context, 'AI 분석 시작');
      const analysis = await _analyzeContentWithAI(extractedContent);
      this.logStep(context, 'AI 분석 완료', {
        summary: analysis.summary?.substring(0, 100) + '...',
        claimsCount: analysis.mainClaims?.length,
        topicsCount: analysis.topics?.length
      });
      
      // 3. 검색 기반 신뢰도 계산
      this.logStep(context, '신뢰도 계산 시작');
      const trustScore = await calculateSearchTrustScore(extractedContent, analysis);
      this.logStep(context, '신뢰도 계산 완료', { trustScore });
      
      // 4. 결과 구성
      const result = {
        url,
        title: analysis.title || '',
        summary: analysis.summary || '',
        trustScore,
        verdict: this.calculateVerdict(trustScore),
        verifiedClaims: analysis.mainClaims || [],
        topics: analysis.topics || [],
        sources: analysis.topics ? analysis.topics.map(topic => ({
          title: topic,
          url: `https://example.com/topic/${encodeURIComponent(topic)}`,
          relevanceScore: 0.8
        })) : [],
        relatedArticles: analysis.relatedArticles || [],
        metadata: {
          verifiedAt: new Date().toISOString(),
          contentExtracted: !!extractedContent,
          analysisMethod: 'hybrid',
          aiModel: GEMINI_MODEL,
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