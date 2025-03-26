/**
 * 멀티 API 팩트체킹 통합 모듈
 * 여러 팩트체킹 API를 통합하여 더 정확하고 신뢰성 있는 검증 결과를 제공합니다.
 */
const axios = require('axios');
const Redis = require('ioredis');
const logger = require('../utils/logger');
const config = require('../config');
const { 
  calculateSimilarity, 
  formatTimeInterval 
} = require('../utils/helpers');

// Redis 클라이언트 초기화
const redisClient = new Redis(config.database.redis);

/**
 * 캐싱 설정
 */
let cacheOptions = {
  enabled: config.cache.enabled,
  ttl: config.cache.ttl || 86400 // 기본값 24시간
};

/**
 * 캐싱 옵션 설정 함수
 * @param {Object} options - 캐싱 옵션
 */
function setCacheOptions(options) {
  if (options) {
    cacheOptions = {
      ...cacheOptions,
      ...options
    };
    logger.info('팩트체커 통합 모듈 캐싱 설정 업데이트됨', { cacheOptions });
  }
}

/**
 * API 어댑터 인터페이스
 * 모든 팩트체킹 API 어댑터는 이 인터페이스를 구현해야 합니다.
 */
class APIAdapter {
  constructor(name) {
    this.name = name;
  }

  /**
   * API 인증 및 초기화
   * @returns {Promise<void>}
   */
  async authenticate() {
    throw new Error('authenticate 메서드가 구현되지 않았습니다.');
  }

  /**
   * 주장 검증 쿼리 실행
   * @param {Object} params - 검증 매개변수
   * @returns {Promise<Array>} - 검증 결과 배열
   */
  async query(params) {
    throw new Error('query 메서드가 구현되지 않았습니다.');
  }

  /**
   * API 오류 처리
   * @param {Error} error - 발생한 오류
   * @returns {Object} - 형식화된 오류 응답
   */
  handleError(error) {
    return {
      source: this.name,
      error: true,
      message: error.message,
      status: error.response?.status || 500
    };
  }
}

/**
 * Google Fact Check API 어댑터
 */
class GoogleFactCheckAdapter extends APIAdapter {
  constructor() {
    super('google');
    this.apiKey = config.api.googleFactCheck.apiKey;
    this.apiUrl = config.api.googleFactCheck.apiUrl;
  }

  async authenticate() {
    // 키 기반 인증은 별도 인증 과정이 필요 없음
    return;
  }

  async query(params) {
    const { claimText, languageCode = 'ko', maxAgeDays = 30, pageSize = 10 } = params;
    
    try {
      // API 요청 URL 구성
      const apiUrl = `${this.apiUrl}/claims:search`;
      const queryParams = new URLSearchParams({
        key: this.apiKey,
        query: claimText,
        languageCode,
        maxAgeDays,
        pageSize
      });
      
      // API 호출
      const response = await axios.get(`${apiUrl}?${queryParams.toString()}`);
      
      // 응답 처리
      if (!response.data || !response.data.claims || response.data.claims.length === 0) {
        logger.info(`[${this.name}] 주장 "${claimText.substring(0, 30)}..."에 대한 결과 없음`);
        return [];
      }
      
      // 결과 처리 및 반환
      return this.processResponse(response.data.claims, claimText);
      
    } catch (error) {
      logger.error(`[${this.name}] API 호출 오류: ${error.message}`);
      return [];
    }
  }
  
  /**
   * Google Fact Check API 응답 처리
   * @param {Array} claims - API 응답의 claims 배열
   * @param {string} originalClaimText - 원본 주장 텍스트
   * @returns {Array} - 처리된 검증 결과 배열
   */
  processResponse(claims, originalClaimText) {
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return [];
    }
    
    const results = [];
    
    // 각 클레임 처리
    claims.forEach(claim => {
      // 유사도 계산
      const similarity = calculateSimilarity(originalClaimText, claim.text);
      
      // 유사도가 기준치 이상인 경우만 처리
      if (similarity >= 0.5) {
        // 클레임 리뷰가 있는 경우만 처리
        if (claim.claimReview && claim.claimReview.length > 0) {
          claim.claimReview.forEach(review => {
            // 신뢰도 점수 매핑
            const trustScore = this.mapRatingToTrustScore(review.textualRating);
            
            results.push({
              source: this.name,
              claimText: claim.text,
              similarity,
              trustScore,
              status: this.mapRatingToStatus(review.textualRating),
              explanation: review.textualRating,
              publisher: review.publisher.name,
              publishDate: review.reviewDate,
              url: review.url
            });
          });
        }
      }
    });
    
    return results;
  }
  
  /**
   * 텍스트 평가를 신뢰도 점수로 매핑
   * @param {string} rating - 텍스트 평가
   * @returns {number} - 0과 1 사이의 신뢰도 점수
   */
  mapRatingToTrustScore(rating) {
    if (!rating) return 0.5;
    
    const lowerRating = rating.toLowerCase();
    
    // "true", "correct", "accurate" 등의 단어가 포함되어 있으면 높은 점수
    if (lowerRating.includes('true') || 
        lowerRating.includes('correct') || 
        lowerRating.includes('accurate') ||
        lowerRating.includes('팩트') ||
        lowerRating.includes('사실')) {
      return 0.9;
    }
    
    // "false", "incorrect", "fake" 등의 단어가 포함되어 있으면 낮은 점수
    if (lowerRating.includes('false') || 
        lowerRating.includes('incorrect') || 
        lowerRating.includes('fake') ||
        lowerRating.includes('거짓') ||
        lowerRating.includes('오류')) {
      return 0.1;
    }
    
    // "partly", "half", "partially" 등의 단어가 포함되어 있으면 중간 점수
    if (lowerRating.includes('partly') || 
        lowerRating.includes('half') || 
        lowerRating.includes('partially') ||
        lowerRating.includes('일부') ||
        lowerRating.includes('부분')) {
      
      // "partly true"는 0.6, "partly false"는 0.4
      if (lowerRating.includes('true') || lowerRating.includes('사실')) {
        return 0.6;
      } else if (lowerRating.includes('false') || lowerRating.includes('거짓')) {
        return 0.4;
      }
      
      return 0.5;
    }
    
    return 0.5; // 기본값
  }
  
  /**
   * 텍스트 평가를 상태로 매핑
   * @param {string} rating - 텍스트 평가
   * @returns {string} - 상태
   */
  mapRatingToStatus(rating) {
    if (!rating) return 'INCONCLUSIVE';
    
    const lowerRating = rating.toLowerCase();
    
    if (lowerRating.includes('true') || 
        lowerRating.includes('correct') || 
        lowerRating.includes('accurate') ||
        lowerRating.includes('팩트') ||
        lowerRating.includes('사실')) {
      return 'VERIFIED_TRUE';
    }
    
    if (lowerRating.includes('false') || 
        lowerRating.includes('incorrect') || 
        lowerRating.includes('fake') ||
        lowerRating.includes('거짓') ||
        lowerRating.includes('오류')) {
      return 'VERIFIED_FALSE';
    }
    
    if (lowerRating.includes('partly') || 
        lowerRating.includes('half') || 
        lowerRating.includes('partially') ||
        lowerRating.includes('일부') ||
        lowerRating.includes('부분')) {
      
      if (lowerRating.includes('true') || lowerRating.includes('사실')) {
        return 'PARTIALLY_TRUE';
      } else if (lowerRating.includes('false') || lowerRating.includes('거짓')) {
        return 'PARTIALLY_FALSE';
      }
      
      return 'MIXED';
    }
    
    return 'INCONCLUSIVE';
  }
}

/**
 * Factiverse API 어댑터
 */
class FactiverseAdapter extends APIAdapter {
  constructor() {
    super('factiverse');
    this.apiKey = config.api.factiverse.apiKey;
    this.apiUrl = config.api.factiverse.apiUrl;
  }

  async authenticate() {
    // Factiverse API 인증
    try {
      const response = await axios.post(`${this.apiUrl}/auth`, {
        apiKey: this.apiKey
      });
      
      this.authToken = response.data.token;
      this.authExpiry = Date.now() + (response.data.expiresIn * 1000);
      
    } catch (error) {
      logger.error(`[${this.name}] 인증 오류: ${error.message}`);
      throw new Error(`Factiverse API 인증 실패: ${error.message}`);
    }
  }

  async query(params) {
    const { claimText, language = 'ko' } = params;
    
    // 토큰이 만료되었거나 없으면 재인증
    if (!this.authToken || Date.now() > this.authExpiry) {
      await this.authenticate();
    }
    
    try {
      const response = await axios.post(`${this.apiUrl}/check`, {
        claim: claimText,
        language: language
      }, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.data || !response.data.results) {
        logger.info(`[${this.name}] 주장 "${claimText.substring(0, 30)}..."에 대한 결과 없음`);
        return [];
      }
      
      return this.processResponse(response.data.results, claimText);
      
    } catch (error) {
      logger.error(`[${this.name}] API 호출 오류: ${error.message}`);
      // 토큰 만료로 인한 오류인 경우 재시도
      if (error.response && error.response.status === 401) {
        logger.info(`[${this.name}] 토큰 만료, 재인증 시도`);
        await this.authenticate();
        return this.query(params);
      }
      
      return [];
    }
  }
  
  /**
   * Factiverse API 응답 처리
   * @param {Array} results - API 응답의 results 배열
   * @param {string} originalClaimText - 원본 주장 텍스트
   * @returns {Array} - 처리된 검증 결과 배열
   */
  processResponse(results, originalClaimText) {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return [];
    }
    
    return results.map(result => {
      // 유사도 계산
      const similarity = calculateSimilarity(originalClaimText, result.claimText);
      
      return {
        source: this.name,
        claimText: result.claimText,
        similarity,
        trustScore: result.truthScore / 100, // Factiverse는 0-100 범위를 사용
        status: this.mapScoreToStatus(result.truthScore),
        explanation: result.explanation,
        publisher: result.factChecker,
        publishDate: result.publishDate,
        url: result.sourceUrl
      };
    });
  }
  
  /**
   * 점수를 상태로 매핑
   * @param {number} score - 0-100 사이의 점수
   * @returns {string} - 상태
   */
  mapScoreToStatus(score) {
    if (score >= 80) {
      return 'VERIFIED_TRUE';
    } else if (score <= 20) {
      return 'VERIFIED_FALSE';
    } else if (score > 50) {
      return 'PARTIALLY_TRUE';
    } else if (score < 50) {
      return 'PARTIALLY_FALSE';
    } else {
      return 'INCONCLUSIVE';
    }
  }
}

/**
 * BigKinds API 어댑터
 */
class BigkindsAdapter extends APIAdapter {
  constructor() {
    super('bigkinds');
    this.apiKey = config.api.bigkinds.apiKey;
    this.apiUrl = config.api.bigkinds.apiUrl;
  }

  async authenticate() {
    // BigKinds API 인증
    try {
      const response = await axios.post(`${this.apiUrl}/auth`, {
        apiKey: this.apiKey
      });
      
      this.authToken = response.data.token;
      this.authExpiry = Date.now() + (response.data.expiresIn * 1000);
      
    } catch (error) {
      logger.error(`[${this.name}] 인증 오류: ${error.message}`);
      throw new Error(`BigKinds API 인증 실패: ${error.message}`);
    }
  }

  async query(params) {
    const { claimText, startDate, endDate, maxResults = 10 } = params;
    
    // 토큰이 만료되었거나 없으면 재인증
    if (!this.authToken || Date.now() > this.authExpiry) {
      await this.authenticate();
    }
    
    // 기본 날짜 범위 설정 (현재부터 1년 전까지)
    const endDateObj = endDate ? new Date(endDate) : new Date();
    const startDateObj = startDate ? new Date(startDate) : new Date();
    startDateObj.setFullYear(startDateObj.getFullYear() - 1);
    
    const startDateStr = startDateObj.toISOString().split('T')[0];
    const endDateStr = endDateObj.toISOString().split('T')[0];
    
    try {
      const response = await axios.post(`${this.apiUrl}/search`, {
        query: claimText,
        startDate: startDateStr,
        endDate: endDateStr,
        size: maxResults
      }, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.data || !response.data.documents || response.data.documents.length === 0) {
        logger.info(`[${this.name}] 주장 "${claimText.substring(0, 30)}..."에 대한 결과 없음`);
        return [];
      }
      
      return this.processResponse(response.data.documents, claimText);
      
    } catch (error) {
      logger.error(`[${this.name}] API 호출 오류: ${error.message}`);
      // 토큰 만료로 인한 오류인 경우 재시도
      if (error.response && error.response.status === 401) {
        logger.info(`[${this.name}] 토큰 만료, 재인증 시도`);
        await this.authenticate();
        return this.query(params);
      }
      
      return [];
    }
  }
  
  /**
   * BigKinds API 응답 처리
   * @param {Array} documents - API 응답의 documents 배열
   * @param {string} originalClaimText - 원본 주장 텍스트
   * @returns {Array} - 처리된 검증 결과 배열
   */
  processResponse(documents, originalClaimText) {
    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return [];
    }
    
    // AI로 각 문서의 신뢰도를 평가해야 하지만
    // 여기서는 간단한 구현을 위해 일치도에 기반한 신뢰도 계산
    return documents.map(doc => {
      // 유사도 계산
      const contentText = doc.title + " " + doc.content;
      const similarity = calculateSimilarity(originalClaimText, contentText);
      
      // 신뢰도는 유사도 + 신뢰성 지표를 통합해서 계산
      let trustScore = similarity;
      
      // 기본적으로 주요 언론사는 신뢰도 가중치 높임
      const majorNewsSources = ['연합뉴스', '중앙일보', '동아일보', '조선일보', '한겨레', '경향신문'];
      if (majorNewsSources.includes(doc.provider)) {
        trustScore = Math.min(trustScore + 0.2, 1.0);
      }
      
      return {
        source: this.name,
        claimText: doc.title,
        similarity,
        trustScore,
        status: this.mapScoreToStatus(trustScore),
        explanation: doc.content.substring(0, 150) + "...",
        publisher: doc.provider,
        publishDate: doc.date,
        url: doc.url
      };
    });
  }
  
  /**
   * 점수를 상태로 매핑
   * @param {number} score - 0-1 사이의 점수
   * @returns {string} - 상태
   */
  mapScoreToStatus(score) {
    if (score >= 0.8) {
      return 'VERIFIED_TRUE';
    } else if (score <= 0.2) {
      return 'VERIFIED_FALSE';
    } else if (score > 0.5) {
      return 'PARTIALLY_TRUE';
    } else if (score < 0.5) {
      return 'PARTIALLY_FALSE';
    } else {
      return 'INCONCLUSIVE';
    }
  }
}

/**
 * API 오류 처리 클래스
 */
class APIErrorHandler {
  /**
   * 지수 백오프 전략으로 함수 재시도
   * @param {Function} fn - 실행할 함수
   * @param {number} maxRetries - 최대 재시도 횟수
   * @returns {Promise<any>} - 함수 실행 결과
   */
  async retryWithBackoff(fn, maxRetries = 3) {
    let retries = 0;
    
    while (true) {
      try {
        return await fn();
      } catch (error) {
        retries++;
        
        if (retries > maxRetries) {
          throw error;
        }
        
        // 지수 백오프 (1초, 2초, 4초, ...)
        const delay = Math.pow(2, retries - 1) * 1000;
        logger.info(`재시도 ${retries}/${maxRetries}, ${delay}ms 후 재시도...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  /**
   * API 속도 제한 처리
   * @param {Object} response - API 응답
   */
  handleRateLimiting(response) {
    if (response.status === 429) {
      // 요청 제한에 걸렸을 때
      const retryAfter = response.headers['retry-after'] || 60;
      logger.warn(`API 속도 제한 도달, ${retryAfter}초 후 재시도 가능`);
      return retryAfter;
    }
    
    return 0;
  }
  
  /**
   * 주 API 실패 시 대체 API 활성화
   * @param {APIAdapter} primaryAPI - 주 API 어댑터
   * @returns {APIAdapter} - 대체 API 어댑터
   */
  activateFallback(primaryAPI) {
    if (primaryAPI.name === 'google') {
      logger.info('Google Fact Check API 실패, Factiverse API로 대체');
      return new FactiverseAdapter();
    } else if (primaryAPI.name === 'factiverse') {
      logger.info('Factiverse API 실패, BigKinds API로 대체');
      return new BigkindsAdapter();
    } else if (primaryAPI.name === 'bigkinds') {
      logger.info('BigKinds API 실패, Google Fact Check API로 대체');
      return new GoogleFactCheckAdapter();
    }
    
    // 기본 대체 API
    return new GoogleFactCheckAdapter();
  }
}

/**
 * 멀티 API 팩트체크 결과 통합기
 */
class ResultIntegrator {
  /**
   * 여러 소스의 검증 결과를 통합하여 신뢰도 점수 계산
   * @param {Array} results - 여러 소스에서 얻은 검증 결과 배열
   * @returns {Object} - 통합된 검증 결과 및 신뢰도 점수
   */
  integrate(results) {
    if (!results || !Array.isArray(results) || results.length === 0) {
      return {
        trustScore: 0.5, // 기본값: 중립
        status: 'UNVERIFIED',
        explanation: '검증 결과를 찾을 수 없습니다.',
        sources: []
      };
    }
    
    // 결과 소스별 가중치 정의
    const sourceWeights = {
      'google': 0.5,
      'factiverse': 0.3,
      'bigkinds': 0.2
    };
    
    // 시간 가중치 계산 (최신 결과에 더 높은 가중치 부여)
    const calculateTimeWeight = (publishDate) => {
      if (!publishDate) return 0.5;
      
      const now = new Date();
      const published = new Date(publishDate);
      const daysDiff = Math.floor((now - published) / (1000 * 60 * 60 * 24));
      
      // 30일 이내: 0.8 ~ 1.0, 30일 이상: 0.5 ~ 0.8
      return daysDiff <= 30 ? 1.0 - (daysDiff / 150) : 0.8 - (daysDiff / 300);
    };
    
    // 모든 결과의 평가를 집계
    let totalScore = 0;
    let totalWeight = 0;
    const combinedSources = [];
    let bestExplanation = '';
    let maxExplanationLength = 0;
    
    results.forEach(result => {
      // 소스 정보 추출
      const source = result.source || 'unknown';
      const sourceWeight = sourceWeights[source] || 0.2;
      
      // 시간 가중치 계산
      const timeWeight = calculateTimeWeight(result.publishDate);
      
      // 최종 가중치
      const weight = sourceWeight * timeWeight;
      
      // 가중치가 적용된 점수 합산
      totalScore += (result.trustScore || 0.5) * weight;
      totalWeight += weight;
      
      // 가장 상세한 설명 선택
      if (result.explanation && result.explanation.length > maxExplanationLength) {
        bestExplanation = result.explanation;
        maxExplanationLength = result.explanation.length;
      }
      
      // 소스 정보 추가
      if (result.source && result.url) {
        combinedSources.push({
          name: result.publisher || result.source,
          url: result.url,
          publishDate: result.publishDate
        });
      }
    });
    
    // 최종 신뢰도 점수 계산 (0-1 사이)
    const finalTrustScore = totalWeight > 0 ? totalScore / totalWeight : 0.5;
    
    // 상태 결정
    let status;
    if (finalTrustScore >= 0.8) {
      status = 'VERIFIED_TRUE';
    } else if (finalTrustScore <= 0.2) {
      status = 'VERIFIED_FALSE';
    } else if (finalTrustScore > 0.5) {
      status = 'PARTIALLY_TRUE';
    } else if (finalTrustScore < 0.5) {
      status = 'PARTIALLY_FALSE';
    } else {
      status = 'INCONCLUSIVE';
    }
    
    return {
      trustScore: finalTrustScore,
      status,
      explanation: bestExplanation || `이 주장의 신뢰도 점수는 ${Math.round(finalTrustScore * 100)}%입니다.`,
      sources: combinedSources
    };
  }
  
  /**
   * 통합된 검증 결과에 컨텍스트 정보 추가
   * @param {Object} result - 통합된 검증 결과
   * @param {string} claimText - 원본 주장 텍스트
   * @returns {Object} - 컨텍스트 정보가 추가된 결과
   */
  async addContextInformation(result, claimText) {
    // 아직 컨텍스트 정보가 있으면 반환
    if (result.context) {
      return result;
    }
    
    try {
      // 여기서 추가 컨텍스트 정보를 수집하는 로직 구현
      // 예: 관련 뉴스, 트렌드, 시간대별 주장 변화 등
      
      // 간단한 예시 구현
      const contextInfo = {
        relatedTopics: ['정치', '경제', '사회'],
        timeDistribution: {
          past24h: 5,
          past7d: 15,
          past30d: 42
        },
        sentiment: {
          positive: 0.3,
          neutral: 0.5,
          negative: 0.2
        }
      };
      
      return {
        ...result,
        context: contextInfo
      };
      
    } catch (error) {
      logger.error(`컨텍스트 정보 수집 중 오류: ${error.message}`);
      return result;
    }
  }
}

/**
 * 멀티 API 팩트체킹 통합 관리자
 */
class MultiAPIFactChecker {
  constructor() {
    // 사용할 API 어댑터 초기화
    this.adapters = {
      google: new GoogleFactCheckAdapter(),
      factiverse: new FactiverseAdapter(),
      bigkinds: new BigkindsAdapter()
    };
    
    this.errorHandler = new APIErrorHandler();
    this.resultIntegrator = new ResultIntegrator();
    
    // Redis 캐싱 활성화 여부
    this.cachingEnabled = config.features.caching || false;
    this.cacheTTL = 24 * 60 * 60; // 24시간
  }
  
  /**
   * 주장 검증 캐시 키 생성
   * @param {string} claimText - 검증할 주장 텍스트
   * @param {string} language - 언어 코드
   * @returns {string} - 캐시 키
   */
  getCacheKey(claimText, language = 'ko') {
    return `factcheck:${language}:${claimText}`;
  }
  
  /**
   * 단일 주장 검증
   * @param {string} claimText - 검증할 주장 텍스트
   * @param {Object} options - 검증 옵션
   * @returns {Promise<Object>} - 검증 결과
   */
  async verifyClaim(claimText, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.info(`주장 검증 시작: "${claimText.substring(0, 50)}..."`);
      
      // 캐시 확인
      if (this.cachingEnabled) {
        const cacheKey = this.getCacheKey(claimText, options.languageCode);
        const cachedResult = await redisClient.get(cacheKey);
        
        if (cachedResult) {
          logger.info(`캐시에서 결과 검색: ${cacheKey}`);
          return {
            ...JSON.parse(cachedResult),
            fromCache: true,
            processingTime: formatTimeInterval(Date.now() - startTime)
          };
        }
      }
      
      // API별 병렬 검증 실행
      const apiResults = await this.verifyWithMultipleAPIs(claimText, options);
      
      // 모든 API 결과 통합
      const allResults = apiResults.flat();
      
      // 결과 통합 및 신뢰도 계산
      const integratedResult = this.resultIntegrator.integrate(allResults);
      
      // 컨텍스트 정보 추가
      const resultWithContext = await this.resultIntegrator.addContextInformation(
        integratedResult, 
        claimText
      );
      
      // 최종 결과 구성
      const finalResult = {
        claim: claimText,
        verification: resultWithContext,
        rawResults: allResults,
        processingTime: formatTimeInterval(Date.now() - startTime),
        timestamp: new Date().toISOString()
      };
      
      // 결과 캐싱
      if (this.cachingEnabled) {
        const cacheKey = this.getCacheKey(claimText, options.languageCode);
        await redisClient.set(cacheKey, JSON.stringify(finalResult), 'EX', this.cacheTTL);
        logger.info(`검증 결과 캐싱: ${cacheKey}`);
      }
      
      return finalResult;
      
    } catch (error) {
      logger.error(`주장 검증 프로세스 오류: ${error.message}`);
      return {
        claim: claimText,
        verification: {
          trustScore: 0.5,
          status: 'ERROR',
          explanation: `검증 중 오류가 발생했습니다: ${error.message}`,
          sources: []
        },
        processingTime: formatTimeInterval(Date.now() - startTime),
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 여러 API로 주장 검증
   * @param {string} claimText - 검증할 주장 텍스트
   * @param {Object} options - 검증 옵션
   * @returns {Promise<Array<Array>>} - API별 검증 결과 배열
   */
  async verifyWithMultipleAPIs(claimText, options = {}) {
    // 사용할 API 어댑터 선택 (FireCrawl 비활성화)
    let adaptersToUse;
    
    if (options.apis) {
      // FireCrawl을 제외한 지정된 API만 사용
      adaptersToUse = options.apis
        .filter(api => api !== 'firecrawl')
        .map(api => this.adapters[api])
        .filter(Boolean);
    } else {
      // 기본적으로 FireCrawl을 제외한 모든 API 사용
      adaptersToUse = Object.entries(this.adapters)
        .filter(([key]) => key !== 'firecrawl')
        .map(([_, adapter]) => adapter);
    }
    
    // 브레이브와 Tavily에 더 높은 우선순위 부여 (사용 가능한 경우)
    if (!options.apis || options.apis.includes('brave_search') || options.apis.includes('tavily')) {
      logger.info('브레이브 검색과 Tavily API를 우선적으로 사용하여 검증합니다.');
    }
    
    if (adaptersToUse.length === 0) {
      throw new Error('사용 가능한 API 어댑터가 없습니다.');
    }
    
    // API별 병렬 쿼리 실행
    const apiPromises = adaptersToUse.map(async (adapter) => {
      try {
        return await this.errorHandler.retryWithBackoff(async () => {
          return adapter.query({
            claimText,
            languageCode: options.languageCode || 'ko',
            maxAgeDays: options.maxAgeDays || 30,
            maxResults: options.maxResults || 10
          });
        });
      } catch (error) {
        logger.error(`[${adapter.name}] 검증 실패: ${error.message}`);
        
        // 폴백 API 사용 시도
        try {
          const fallbackAdapter = this.errorHandler.activateFallback(adapter);
          return await fallbackAdapter.query({
            claimText,
            languageCode: options.languageCode || 'ko'
          });
        } catch (fallbackError) {
          logger.error(`폴백 API도 실패: ${fallbackError.message}`);
          return [];
        }
      }
    });
    
    // 모든 API 결과 대기
    return await Promise.all(apiPromises);
  }
  
  /**
   * 여러 주장 일괄 검증
   * @param {Array<string>} claims - 검증할 주장 텍스트 배열
   * @param {Object} options - 검증 옵션
   * @returns {Promise<Array<Object>>} - 검증 결과 배열
   */
  async verifyClaimBatch(claims, options = {}) {
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return [];
    }
    
    // 주장별 병렬 검증 실행
    const verificationPromises = claims.map(async (claim) => {
      return this.verifyClaim(claim, options);
    });
    
    // 모든 검증 결과 대기
    return await Promise.all(verificationPromises);
  }
}

// 멀티 API 팩트체커 인스턴스 생성
const multiApiFactChecker = new MultiAPIFactChecker();

module.exports = {
  verifyClaim: new MultiAPIFactChecker().verifyClaim.bind(new MultiAPIFactChecker()),
  verifyClaimBatch: new MultiAPIFactChecker().verifyClaimBatch.bind(new MultiAPIFactChecker()),
  setCacheOptions,
  // API 테스트용 및 고급 사용을 위한 클래스 내보내기
  MultiAPIFactChecker,
  GoogleFactCheckAdapter,
  FactiverseAdapter,
  BigkindsAdapter,
  APIErrorHandler,
  ResultIntegrator
}; 