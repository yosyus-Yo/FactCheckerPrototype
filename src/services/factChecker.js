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

// Google AI 초기화
let genAI = null;
if (config.api.googleAi && config.api.googleAi.apiKey) {
  genAI = new GoogleGenerativeAI(config.api.googleAi.apiKey);
  
  // AI 분석 메서드 구현
  genAI.analyzeSentiment = async (text) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `다음 텍스트의 감정을 분석해주세요. 긍정, 부정, 중립 비율을 백분율로 표시하고, 주요 감정도 알려주세요:
      
      "${text}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const analysis = response.text();
      
      // 기본값 설정
      const sentiment = {
        positive: 0.33,
        negative: 0.33,
        neutral: 0.34,
        dominant: '중립'
      };
      
      // 분석 결과에서 감정 비율 추출 시도
      try {
        if (analysis.includes('긍정')) sentiment.positive = 0.6;
        if (analysis.includes('부정')) sentiment.negative = 0.6;
        if (analysis.includes('중립')) sentiment.neutral = 0.6;
        
        // 주요 감정 결정
        sentiment.dominant = Object.entries(sentiment)
          .filter(([key]) => key !== 'dominant')
          .reduce((a, b) => a[1] > b[1] ? a : b)[0];
      } catch (parseError) {
        console.warn('[팩트체커] 감정 분석 결과 파싱 오류:', parseError);
      }
      
      return sentiment;
    } catch (error) {
      console.error('[팩트체커] 감정 분석 오류:', error);
      return {
        positive: 0.33,
        negative: 0.33,
        neutral: 0.34,
        dominant: '중립'
      };
    }
  };
  
  genAI.identifyTopics = async (text) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `다음 텍스트의 주요 주제를 3개 이하의 키워드로 추출해주세요:
      
      "${text}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const topics = response.text().split(',').map(t => t.trim());
      
      return topics.slice(0, 3);
    } catch (error) {
      console.error('[팩트체커] 주제 식별 오류:', error);
      return ['일반'];
    }
  };
  
  genAI.extractClaims = async (text) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `다음 텍스트에서 사실 확인이 필요한 주요 주장들을 추출해주세요:
      
      "${text}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const claims = response.text()
        .split('\n')
        .filter(line => line.trim().length > 0)
        .map(claim => ({
          text: claim.trim(),
          confidence: 0.8
        }));
      
      return claims;
    } catch (error) {
      console.error('[팩트체커] 주장 추출 오류:', error);
      return [{
        text: text.substring(0, 1000),
        confidence: 0.5
      }];
    }
  };
  
  genAI.analyzeFactuality = async (text) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `다음 주장의 사실성을 분석하고, 0에서 1 사이의 신뢰도 점수를 매겨주세요:
      
      "${text}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const analysis = response.text();
      
      return {
        trustScore: 0.7,
        confidence: 0.8,
        analysis: analysis
      };
    } catch (error) {
      console.error('[팩트체커] 사실성 분석 오류:', error);
      return {
        trustScore: 0.5,
        confidence: 0.5,
        analysis: '분석 실패'
      };
    }
  };
  
  genAI.generateSummaryAnalysis = async (factCheckResults, finalTrustScore) => {
    try {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const prompt = `다음 팩트체크 결과들을 바탕으로 종합 분석을 생성해주세요:
      
      신뢰도 점수: ${finalTrustScore}
      검증 결과: ${JSON.stringify(factCheckResults, null, 2)}`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('[팩트체커] 요약 분석 생성 오류:', error);
      return `신뢰도 점수 ${finalTrustScore}점을 기반으로 한 자동 분석입니다.`;
    }
  };
} else {
  logger.warn('Google AI API 키가 설정되지 않았습니다. 관련 기능이 비활성화됩니다.');
}

// SSE 클라이언트 관리
let sseClients = [];

// Redis 캐시 설정
const redis = new Redis(config.redis);

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
  if (score >= 60) return '대체로 사실';
  if (score >= 40) return '부분적으로 사실';
  if (score >= 20) return '대체로 거짓';
  return '거짓';
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
async function extractKeywords(text, maxKeywords = 3) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const prompt = `다음 텍스트에서 가장 중요한 키워드 ${maxKeywords}개를 추출해주세요. 각 키워드는 쉼표로 구분하여 반환해주세요:
    
    "${text}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const keywords = response.text().split(',').map(k => k.trim());
    
    console.log('[팩트체커] 추출된 키워드:', keywords);
    return keywords.slice(0, maxKeywords);
  } catch (error) {
    console.error('[팩트체커] 키워드 추출 오류:', error);
    // 기본 키워드로 텍스트의 첫 3개 단어 사용
    return text.split(' ').slice(0, 3);
  }
}

// Brave Search MCP 클라이언트
const braveSearch = {
  async searchWeb(query, options = {}) {
    return withRetry(async () => {
      try {
        // 핵심 키워드 추출
        const keywords = await extractKeywords(query);
        const optimizedQuery = keywords.join(' ');
        
        console.log('[팩트체커] Brave 검색 쿼리:', optimizedQuery);
        
        try {
          const response = await axios.post('http://localhost:3000/api/brave/search', {
            query: optimizedQuery,
            options: {
              limit: options.limit || 3,
              language: options.language || 'ko',
              country: options.country || 'KR',
              safeSearch: options.safeSearch || true
            }
          });
          
          return response.data.results.map(result => ({
            title: result.title,
            url: result.url,
            snippet: result.description,
            relevance: result.relevance || 0.7
          }));
        } catch (connectionError) {
          console.warn('[팩트체커] Brave 검색 서버 연결 실패, 대체 분석 사용:', connectionError.message);
          
          // 대체 분석: 키워드 기반 신뢰도 평가
          return [{
            title: '키워드 기반 분석',
            url: null,
            snippet: `주요 키워드 "${keywords.join('", "')}"에 대한 자체 분석 결과`,
            relevance: 0.7
          }];
        }
      } catch (error) {
        logError('Brave 검색', error, { query, options });
        return []; // 빈 결과 반환하여 프로세스 계속 진행
      }
    }, { maxRetries: 2 });
  }
};

// 웹 검색 결과를 기반으로 신뢰도 분석
async function analyzeWebSearchResults(claim, searchResults) {
  try {
    // 검색 결과가 없거나 연결 실패한 경우
    if (!searchResults || searchResults.length === 0) {
      console.log('[팩트체커] 웹 검색 결과 없음, AI 분석 가중치 증가');
    return {
        trustScore: 0.5,
        confidence: 0.3,
        analysis: '웹 검색 서비스 일시적 오류로 인해 AI 분석 결과를 주로 참고했습니다.'
      };
    }

    // 검색 결과의 신뢰도 분석
    let totalScore = 0;
    let evidencePoints = [];
    
    for (const result of searchResults) {
      // URL이 없는 경우 (대체 분석 결과) 처리
      if (!result.url) {
        totalScore += 0.5; // 중립적 점수 부여
        evidencePoints.push(`[자체 분석] ${result.snippet}`);
        continue;
      }

      const similarity = calculateSimilarity(claim, result.snippet);
      if (similarity > 0.7) {
        totalScore += 0.8;
        evidencePoints.push(`[신뢰도 높음] ${result.title}: ${result.snippet}`);
      } else if (similarity > 0.5) {
        totalScore += 0.5;
        evidencePoints.push(`[부분 관련] ${result.title}: ${result.snippet}`);
      }
    }

    const averageScore = totalScore / searchResults.length;
    const analysis = evidencePoints.length > 0 
      ? `웹 검색 결과 분석:\n${evidencePoints.join('\n')}`
      : '웹 검색 결과와 주장의 직접적인 연관성을 찾을 수 없습니다.';

    return {
      trustScore: averageScore,
      confidence: evidencePoints.length > 0 ? 0.8 : 0.4,
      analysis
    };
  } catch (error) {
    console.error('[팩트체커] 웹 검색 결과 분석 오류:', error);
    return {
      trustScore: 0.5,
      confidence: 0.3,
      analysis: '웹 검색 결과 분석 중 오류가 발생하여 AI 분석 결과를 주로 참고했습니다.'
    };
  }
}

// 캐시된 검증 결과 조회
async function getCachedVerification(content) {
  try {
    const cacheKey = generateCacheKey('verification', content);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    return null;
  } catch (error) {
    console.error('[팩트체커] 캐시 조회 오류:', error);
    return null;
  }
}

// 검증 결과 캐시 저장
async function cacheVerification(content, result) {
  try {
    const cacheKey = generateCacheKey('verification', content);
    await redis.setex(cacheKey, 3600 * 24, JSON.stringify(result)); // 24시간 캐시
  } catch (error) {
    console.error('[팩트체커] 캐시 저장 오류:', error);
  }
}

// 최적화된 검증 프로세스
async function verifyClaimProcess(claimId, url, title, content) {
  let verification = null;
  
  try {
    console.log('\n[팩트체커] 검증 프로세스 시작 =========');
    console.log('[팩트체커] 검증 대상 ID:', claimId);
    console.log('[팩트체커] URL:', url);
    console.log('[팩트체커] 제목:', title);
    console.log('[팩트체커] MCP 브라우저 추출 본문:', content);
    console.log('================================\n');

    // 1. 캐시 확인
    const cached = await withRetry(
      () => getCachedVerification(content),
      { maxRetries: 2 }
    );
    
    if (cached) {
      console.log('[팩트체커] 캐시된 결과 사용:', claimId);
      await sendVerificationComplete(claimId, cached);
      return { success: true, claimId, cached: true };
    }

    // 2. 검증 레코드 생성 또는 확인
    verification = await Verification.findOne({
      where: { claimId }
    });
    
    if (!verification) {
      verification = await Verification.create({
        claimId,
        url: url || null,
        title,
        content,
        status: 'processing',
        progress: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }

    // 3. 병렬 처리 (각각 재시도 로직 포함)
    console.log('[팩트체커] 분석 시작...');
    const [
      webSearchResults,
      sentiment,
      topics,
      aiAnalysis
    ] = await Promise.all([
      withRetry(() => braveSearch.searchWeb(content))
        .catch(error => {
          console.error('[팩트체커] 웹 검색 실패:', error);
          return []; // 웹 검색 실패 시 빈 결과 반환
        }),
      withRetry(() => genAI.analyzeSentiment(content)),
      withRetry(() => genAI.identifyTopics(content)),
      withRetry(() => genAI.analyzeFactuality(content))
    ]);

    console.log('[팩트체커] 분석 결과:');
    console.log('- 감정 분석:', sentiment);
    console.log('- 주제:', topics);
    console.log('- AI 분석:', aiAnalysis);

    // 4. 웹 검색 결과 분석
    const webAnalysis = await withRetry(
      () => analyzeWebSearchResults(content, webSearchResults)
    );

    // 5. 최종 신뢰도 점수 계산 (웹 검색 실패 시 AI 분석 가중치 증가)
    const weights = webSearchResults.length > 0 
      ? { web: 0.6, ai: 0.4 }
      : { web: 0.3, ai: 0.7 };
    
    const finalTrustScore = (
      webAnalysis.trustScore * weights.web +
      aiAnalysis.trustScore * weights.ai
    );

    console.log('[팩트체커] 최종 신뢰도 점수:', finalTrustScore * 100, '%');

    // 6. 결과 객체 생성
    const result = {
      result: {
        trustScore: finalTrustScore,
        factCheckerAnalysis: `
${webSearchResults.length === 0 ? '[알림] 웹 검색 서비스 일시적 오류로 AI 분석 결과를 주로 참고했습니다.\n\n' : ''}
웹 검색 기반 분석:
${webAnalysis.analysis}

AI 분석:
${aiAnalysis.analysis}
        `,
        analysisDetails: {
          sentiment,
          topics,
          webResults: webSearchResults.map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet
          }))
        }
      }
    };

    // 7. 결과 저장 및 캐시
    verification.trustScore = finalTrustScore;
    verification.factCheckerAnalysis = result.result.factCheckerAnalysis;
    verification.status = 'completed';
    verification.progress = 100;
    verification.updatedAt = new Date();
    
    await Promise.all([
      verification.save(),
      withRetry(() => cacheVerification(content, result))
    ]).catch(error => {
      logError('결과 저장', error, { claimId });
      throw error;
    });

    // 8. 결과 전송
    if (verification.status === 'completed') {
      await sendVerificationComplete(claimId, result);
      console.log('[팩트체커] 검증 완료 =========\n');
    }

    return {
      success: true,
      claimId
    };
    
  } catch (error) {
    console.error('\n[팩트체커] 오류 발생 =========');
    logError('검증 프로세스', error, {
      claimId,
      url,
      title,
      contentLength: content?.length
    });
    
    if (verification) {
      await updateVerificationStatus(claimId, 'error', 0).catch(updateError => {
        logError('상태 업데이트 실패', updateError, { claimId });
      });
    }
    
    return {
      success: false,
      claimId,
      error: '검증 처리 중 오류가 발생했습니다.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    };
  }
}

// 텍스트 신뢰도 점수 계산 함수 (임시 구현)
function calculateTempTrustScore(text) {
  if (!text || text.length < 10) {
    console.log('[팩트체커] 텍스트가 너무 짧아 기본 점수(50) 반환');
    return 50; // 기본값
  }
  
  console.log(`[팩트체커] 신뢰도 계산 시작 - 텍스트 길이: ${text.length}자`);
  let score = 50; // 기본 점수
  
  // 1. 텍스트 길이 분석 (보통 신뢰할 수 있는 내용은 더 자세함)
  if (text.length > 1000) {
    score += 10;
    console.log('[팩트체커] 텍스트 길이 분석: 1000자 초과 (점수 +10)');
  } else if (text.length > 500) {
    score += 5;
    console.log('[팩트체커] 텍스트 길이 분석: 500자 초과 (점수 +5)');
  } else if (text.length < 200) {
    score -= 5;
    console.log('[팩트체커] 텍스트 길이 분석: 200자 미만 (점수 -5)');
  }
  
  // 2. 감정적 표현 분석
  const emotionalWords = [
    '충격', '경악', '믿기 힘든', '절대', '충격적', '완전히', '전혀', 
    '사상 최대', '최초', '유일', '절대로', '절대 불가능', '최악', 
    '최고', '대박', '헐', '대참사', '충공깽', '헉소리', '경악', '충격적'
  ];
  
  let emotionalCount = 0;
  const foundEmotionalWords = [];
  emotionalWords.forEach(word => {
    const regex = new RegExp(word, 'g');
    const matches = text.match(regex);
    if (matches) {
      emotionalCount += matches.length;
      foundEmotionalWords.push(`${word}(${matches.length}회)`);
    }
  });
  
  if (emotionalCount > 0) {
    console.log(`[팩트체커] 감정적 표현 발견: ${foundEmotionalWords.join(', ')}, 총 ${emotionalCount}회`);
  } else {
    console.log('[팩트체커] 감정적 표현 없음');
  }
  
  if (emotionalCount > 5) {
    score -= 15;
    console.log('[팩트체커] 감정적 표현 분석: 5회 초과 (점수 -15)');
  } else if (emotionalCount > 3) {
    score -= 10;
    console.log('[팩트체커] 감정적 표현 분석: 3회 초과 (점수 -10)');
  } else if (emotionalCount > 1) {
    score -= 5;
    console.log('[팩트체커] 감정적 표현 분석: 1회 초과 (점수 -5)');
  }
  
  // 3. 데이터 인용 및 소스 분석
  const dataPatterns = [
    /\d+[.]\d+%/g, // 숫자 + % (e.g. 75.5%)
    /\d+월 \d+일/g, // 날짜 패턴 (e.g. 5월 10일)
    /\'\w+\'|\"\w+\"/g, // 따옴표 인용
    /[\w\s]+에 따르면/g, // '~에 따르면' 패턴
    /연구 결과/g, // 연구 결과 언급
    /전문가|교수|박사|연구원/g // 전문가 언급
  ];
  
  let dataReferenceCount = 0;
  const foundReferences = [];
  dataPatterns.forEach((pattern, index) => {
    const patternNames = ['비율 데이터', '날짜 패턴', '인용구', '인용 출처', '연구 결과', '전문가 언급'];
    const matches = text.match(pattern);
    if (matches) {
      dataReferenceCount += matches.length;
      foundReferences.push(`${patternNames[index]}(${matches.length}회)`);
    }
  });
  
  if (dataReferenceCount > 0) {
    console.log(`[팩트체커] 데이터/인용 발견: ${foundReferences.join(', ')}, 총 ${dataReferenceCount}회`);
  } else {
    console.log('[팩트체커] 데이터/인용 없음');
  }
  
  if (dataReferenceCount > 5) {
    score += 15;
    console.log('[팩트체커] 데이터 참조 분석: 5회 초과 (점수 +15)');
  } else if (dataReferenceCount > 3) {
    score += 10;
    console.log('[팩트체커] 데이터 참조 분석: 3회 초과 (점수 +10)');
  } else if (dataReferenceCount > 1) {
    score += 5;
    console.log('[팩트체커] 데이터 참조 분석: 1회 초과 (점수 +5)');
  }
  
  // 최종 점수 범위 조정 (0-100)
  score = Math.max(0, Math.min(100, score));
  console.log(`[팩트체커] 최종 신뢰도 점수: ${score}/100`);
  
  return score;
}

// 모의 검증 결과 생성 함수
function generateMockVerificationResults(trustScore, url, content) {
  console.log(`[팩트체커] 모의 검증 결과 생성 - 신뢰도 점수: ${trustScore}`);
  
  // 신뢰도 점수에 따른 판정
  let verdict;
  if (trustScore >= 70) {
    verdict = '신뢰할 수 있음';
    console.log('[팩트체커] 판정: 신뢰할 수 있음 (점수 70 이상)');
  } else if (trustScore >= 40) {
    verdict = '부분적으로 사실';
    console.log('[팩트체커] 판정: 부분적으로 사실 (점수 40-69)');
  } else {
    verdict = '신뢰할 수 없음';
    console.log('[팩트체커] 판정: 신뢰할 수 없음 (점수 40 미만)');
  }
  
  // 샘플 소스 생성
  const sources = [];
  
  // 신뢰도에 따라 다른 소스 추가
  if (trustScore >= 60) {
    sources.push({
      title: '텍스트 구조 및 근거 분석',
      url: 'https://factchecker.guide/methodology',
      snippet: '해당 콘텐츠는 구체적인 데이터와 근거를 포함하고 있으며, 감정적 표현보다 사실 중심의 서술이 주를 이룹니다.',
      score: trustScore / 100
    });
  } else if (trustScore >= 40) {
    sources.push({
      title: '텍스트 내용 및 표현 분석',
      url: 'https://factchecker.guide/methodology',
      snippet: '해당 콘텐츠는 일부 사실적 정보를 포함하고 있으나, 객관적 근거가 부족하고 감정적 표현이 일부 발견됩니다.',
      score: trustScore / 100
    });
  } else {
    sources.push({
      title: '신뢰도 위험 요소 분석',
      url: 'https://factchecker.guide/methodology',
      snippet: '해당 콘텐츠는 과장된 표현과 주관적 의견이 많으며, 명확한 출처나 데이터 근거가 부족합니다.',
      score: trustScore / 100
    });
  }
  
  // 최종 결과 객체 반환
  return {
    truthScore: trustScore,
    verdict: verdict,
    sources: sources,
    analysis: {
      emotionalLanguage: (trustScore < 50) ? '높음' : '낮음',
      sourceCitations: (trustScore > 60) ? '충분함' : '부족함',
      factualClaims: Math.round(trustScore / 20),
      misleadingClaims: Math.round((100 - trustScore) / 25)
    },
    timestamp: new Date().toISOString()
  };
}

/**
 * 주장 저장 및 검증 시작
 * @param {Object} claimData - 주장 데이터
 * @returns {Promise<Object>} - 저장된 주장과 검증 결과
 */
async function saveAndVerifyClaim(claimData) {
  try {
    // 1. 주장 저장
    const claim = new Claim({
      text: claimData.text,
      source: claimData.source || { type: 'TEXT' },
      confidence: claimData.confidence || 0.7,
      category: claimData.category || '기타',
      verification: {
        status: 'UNVERIFIED',
        trustScore: 0.5
      }
    });
    
    await claim.save();
    logger.info(`새 주장 저장됨: ${claim._id}`);
    
    // 2. 비동기 검증 시작
    verifyClaimProcess(claim._id, claim.source.url, claim.text).then(async (result) => {
      // 검증 결과 저장
      claim.verification = {
        status: result.status,
        trustScore: result.trustScore,
        trustScore: result.truthScore,
        explanation: result.explanation,
        sources: result.sources
      };
      
      await claim.save();
      logger.info(`주장 ${claim._id} 검증 완료: ${result.status}`);
      
      // 검증 결과 이벤트 전송
      sendVerificationResult(claim, result);
      
      // 상세 검증 결과 저장
      const verificationResult = new VerificationResult({
        claim: claim._id,
        status: result.status,
        trustScore: result.truthScore,
        explanation: result.explanation,
        sources: result.sources,
        processingTime: result.processingTime,
        verificationMethod: 'MULTI_SOURCE'
      });
      
      await verificationResult.save();
    }).catch(error => {
      logger.error(`주장 ${claim._id} 검증 중 오류: ${error.message}`);
    });
    
    return {
      claim,
      message: '주장이 저장되었으며 검증 진행 중입니다.'
    };
  } catch (error) {
    logger.error(`주장 저장 중 오류: ${error.message}`);
    throw error;
  }
}

// 유틸리티 함수들

/**
 * Google 팩트체크 API 상태 매핑
 * @param {string} textualRating - API의 텍스트 평가
 * @returns {string} - 내부 상태 코드
 */
function mapClaimReviewStatus(textualRating) {
  const lowerRating = textualRating.toLowerCase();
  
  if (lowerRating.includes('true') || lowerRating.includes('fact') || lowerRating.includes('correct')) {
    return 'VERIFIED_TRUE';
  } else if (lowerRating.includes('false') || lowerRating.includes('fake') || lowerRating.includes('incorrect')) {
    return 'VERIFIED_FALSE';
  } else if (lowerRating.includes('partially') || lowerRating.includes('mostly') || lowerRating.includes('half')) {
    return 'PARTIALLY_TRUE';
  } else {
    return 'UNVERIFIED';
  }
}

/**
 * Factiverse API 상태 매핑
 * @param {string} verdict - API의 판정
 * @returns {string} - 내부 상태 코드
 */
function mapFactiverseStatus(verdict) {
  // 실제 API 응답에 맞게 수정 필요
  switch (verdict) {
    case 'TRUE':
      return 'VERIFIED_TRUE';
    case 'FALSE':
      return 'VERIFIED_FALSE';
    case 'PARTIALLY_TRUE':
      return 'PARTIALLY_TRUE';
    default:
      return 'UNVERIFIED';
  }
}

/**
 * 신뢰도 점수 계산
 * @param {Array} claimReviews - 검토 결과 배열
 * @returns {number} - 신뢰도 점수 (0-1)
 */
function calculateTrustScore(claimReviews) {
  if (!claimReviews || claimReviews.length === 0) {
    return 0.5;
  }
  
  let totalScore = 0;
  
  claimReviews.forEach(review => {
    const textualRating = review.textualRating.toLowerCase();
    
    if (textualRating.includes('true') || textualRating.includes('fact') || textualRating.includes('correct')) {
      totalScore += 0.9;
    } else if (textualRating.includes('mostly true') || textualRating.includes('mostly correct')) {
      totalScore += 0.7;
    } else if (textualRating.includes('partially') || textualRating.includes('half')) {
      totalScore += 0.5;
    } else if (textualRating.includes('mostly false') || textualRating.includes('mostly incorrect')) {
      totalScore += 0.3;
    } else if (textualRating.includes('false') || textualRating.includes('fake') || textualRating.includes('incorrect')) {
      totalScore += 0.1;
    } else {
      totalScore += 0.5;
    }
  });
  
  return totalScore / claimReviews.length;
}

module.exports = {
  registerSSEClient,
  removeSSEClient,
  sendEventToAll,
  verifyClaimProcess,
  saveAndVerifyClaim,
  calculateTempTrustScore,
  generateMockVerificationResults
}; 