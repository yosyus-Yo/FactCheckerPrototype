const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { formatApiError, formatTimeInterval } = require('../utils/helpers');
const services = require('../services');
const { factChecker, factCheckerIntegration, performanceMonitor } = require('../services');
const config = require('../config');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const url = require('url');
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { checkAuth } = require('../utils/authMiddleware');
const { Verification, isMongoConnected } = require('../models/verification');
const contentExtractor = require('../utils/contentExtractor');
const { ContentRecognitionService } = require('../services/contentRecognition');
const { detectClaims, detectClaimsAndSearch } = require('../services/claimDetection');

// 진행 중인 요청을 추적하는 Map 객체 (임시 메모리 저장)
const processingRequests = new Map();

// 로깅 컨텍스트 생성 함수
function createLoggingContext(req) {
  return {
    requestId: req.id,
    method: req.method,
    path: req.path,
    timestamp: new Date().toISOString()
  };
}

// 콘텐츠 로깅을 위한 헬퍼 함수
function logContent(context, type, content, metadata = {}) {
  if (!content) return;
  
  const contentPreview = typeof content === 'string' 
    ? content.substring(0, 200) + (content.length > 200 ? '...' : '')
    : JSON.stringify(content).substring(0, 200) + '...';
  
  logger.info(`[${type}] 콘텐츠 처리`, {
    ...context,
    contentType: type,
    contentPreview,
    contentLength: typeof content === 'string' ? content.length : JSON.stringify(content).length,
    ...metadata
  });
}

// 검증 결과 로깅을 위한 헬퍼 함수
function logVerificationResult(context, result, metadata = {}) {
  logger.info('검증 결과', {
    ...context,
    trustScore: result.trustScore,
    verdict: result.verdict,
    claimsCount: result.verifiedClaims?.length || 0,
    processingTime: metadata.processingTime,
    ...metadata
  });
}

// 에러 로깅을 위한 헬퍼 함수
function logError(context, error, metadata = {}) {
  logger.error('에러 발생', {
    ...context,
    error: {
      message: error.message,
      stack: error.stack,
      code: error.code
    },
    ...metadata
  });
}

/**
 * URL과 콘텐츠를 기반으로 고유 식별자 생성
 * @param {string} url - 검증할 웹페이지 URL
 * @param {string} content - 검증할 콘텐츠
 * @returns {string} - 고유 식별자
 */
function generateClaimId(url, content) {
  const crypto = require('crypto');
  // URL 정규화 (프로토콜, www, 쿼리 파라미터 등 정리)
  let normalizedUrl = url || '';
  try {
    if (normalizedUrl) {
      const urlObj = new URL(normalizedUrl);
      normalizedUrl = `${urlObj.hostname}${urlObj.pathname}`;
    }
  } catch (e) {
    console.warn('URL 정규화 실패:', e.message);
  }
  
  // 콘텐츠 해시 생성 (처음 100자만 사용하여 안정적 ID 생성)
  const contentSample = content ? content.substring(0, 100).trim() : '';
  
  // URL과 콘텐츠 샘플을 결합하여 해시 생성
  const hashInput = `${normalizedUrl}_${contentSample}`;
  const hash = crypto.createHash('md5').update(hashInput).digest('hex');
  
  return hash;
}

// 성능 모니터링 미들웨어
const performanceMiddleware = (req, res, next) => {
  // 요청 시작 시간 기록
  const start = Date.now();
  
  // 응답 전송 메서드 오버라이드
  const originalSend = res.send;
  res.send = function(body) {
    // 응답 완료 시간 계산
    const duration = Date.now() - start;
    
    // API 메트릭 기록
    performanceMonitor.recordApiMetrics(
      req.originalUrl || req.url,
      duration,
      res.statusCode < 400
    );
    
    // 성능 로깅
    if (duration > config.performance.timeout.api) {
      logger.warn(`성능 저하: ${req.method} ${req.originalUrl || req.url} - ${duration}ms`);
    }
    
    // 원본 send 메서드 호출
    return originalSend.call(this, body);
  };
  
  next();
};

// 모든 API 요청에 성능 모니터링 미들웨어 적용
router.use(performanceMiddleware);

// 속도 제한 미들웨어 (요청 제한이 필요한 경우에만 활성화)
if (config.performance.rateLimiting.enabled) {
  const rateLimit = require('express-rate-limit');
  
  const apiLimiter = rateLimit({
    windowMs: config.performance.rateLimiting.windowMs,
    max: config.performance.rateLimiting.maxRequests,
    message: {
      error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.'
    },
    standardHeaders: true,
    legacyHeaders: false
  });
  
  router.use(apiLimiter);
}

// 다양한 엔드포인트별 속도 제한 설정
const limiter = (type) => {
  const rateLimit = require('express-rate-limit');
  
  const limits = {
    // 표준 API 요청 제한 (일반적인 API 요청)
    standard: {
      windowMs: 1 * 60 * 1000, // 1분
      max: 30 // 1분당 최대 30회
    },
    // 자원 집약적 작업 제한 (예: 검증 요청)
    intensive: {
      windowMs: 5 * 60 * 1000, // 5분
      max: 10 // 5분당 최대 10회
    },
    // 민감 작업 제한 (예: 인증 관련)
    sensitive: {
      windowMs: 15 * 60 * 1000, // 15분
      max: 5 // 15분당 최대 5회
    }
  };
  
  const config = limits[type] || limits.standard;
  
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    message: {
      error: '너무 많은 요청이 발생했습니다. 잠시 후 다시 시도해주세요.'
    },
    standardHeaders: true,
    legacyHeaders: false
  });
};

/**
 * @route   GET /api/health
 * @desc    API 상태 확인
 * @access  Public
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: config.app.env
  });
});

/**
 * @route   POST /api/analyze
 * @desc    미디어 콘텐츠 분석 및 팩트체킹 요청
 * @access  Public
 */
router.post('/analyze', async (req, res) => {
  try {
    const { content, contentType = 'TEXT' } = req.body;
    
    if (!content) {
      return res.status(400).json({
        error: true,
        message: '분석할 콘텐츠를 제공해주세요.'
      });
    }
    
    const startTime = Date.now();
    let result;
    
    // 콘텐츠 타입에 따른 처리
    if (contentType === 'TEXT') {
      // 텍스트 콘텐츠 처리
      const claims = await services.contentRecognition.extractClaimsFromText(content);
      
      // 클레임이 있는 경우 첫 번째 클레임 검증 (데모 목적)
      if (claims.length > 0) {
        const firstClaim = claims[0];
        const savedClaim = await services.factChecker.saveAndVerifyClaim(firstClaim);
        
        result = {
          success: true,
          message: '콘텐츠 분석이 완료되었습니다',
          result: {
            claims: claims,
            savedClaim: savedClaim,
            processingTime: formatTimeInterval(Date.now() - startTime)
          }
        };
      } else {
        result = {
          success: true,
          message: '검증할 주장을 찾을 수 없습니다',
          result: {
            claims: [],
            processingTime: formatTimeInterval(Date.now() - startTime)
          }
        };
      }
    } else if (contentType === 'AUDIO') {
      // 오디오 콘텐츠 처리 - 임시 구현
      result = {
        success: true,
        message: '오디오 분석 기능은 현재 개발 중입니다',
        result: {
          processingTime: formatTimeInterval(Date.now() - startTime)
        }
      };
    } else if (contentType === 'VIDEO') {
      // 비디오 콘텐츠 처리 - 임시 구현
      result = {
        success: true,
        message: '비디오 분석 기능은 현재 개발 중입니다',
        result: {
          processingTime: formatTimeInterval(Date.now() - startTime)
        }
      };
    } else {
      return res.status(400).json({
        error: true,
        message: '지원되지 않는 콘텐츠 타입입니다. TEXT, AUDIO, VIDEO 중 하나를 사용해주세요.'
      });
    }
    
    res.json(result);
  } catch (error) {
    logger.error(`분석 요청 처리 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   GET /api/claims/:id
 * @desc    특정 주장의 검증 결과 조회
 * @access  Public
 */
router.get('/claims/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const Claim = require('../models/claim');
    
    const claim = await Claim.findById(id);
    
    if (!claim) {
      return res.status(404).json({
        error: true,
        message: '해당 ID의 주장을 찾을 수 없습니다.'
      });
    }
    
    res.json(claim);
  } catch (error) {
    logger.error(`주장 조회 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   GET /api/facts/stream
 * @desc    팩트체킹 결과 스트림 (SSE)
 * @access  Public
 */
router.get('/facts/stream', (req, res) => {
  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // SSE 연결 초기화 메시지
  res.write('data: {"type":"connected","message":"SSE 연결이 설정되었습니다."}\n\n');
  
  // 클라이언트 ID 생성
  const clientId = Date.now();
  
  // SSE 클라이언트 등록
  services.factChecker.registerSSEClient({
    id: clientId,
    response: res
  });
  
  // 연결 종료 시 클라이언트 제거
  req.on('close', () => {
    services.factChecker.removeSSEClient(clientId);
  });
});

/**
 * @route   GET /api/ar/config
 * @desc    AR 시각화 설정 조회
 * @access  Public
 */
router.get('/ar/config', (req, res) => {
  try {
    const arConfig = services.arVisualization.createARSceneConfig();
    const arAssets = services.arVisualization.createWebXRAssets();
    
    res.json({
      success: true,
      config: arConfig,
      assets: arAssets
    });
  } catch (error) {
    logger.error(`AR 설정 조회 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/ar/visualize
 * @desc    AR 시각화 데이터 생성
 * @access  Public
 */
router.post('/ar/visualize', async (req, res) => {
  try {
    const { verificationResult } = req.body;
    
    if (!verificationResult) {
      return res.status(400).json({
        error: true,
        message: '시각화할 검증 결과를 제공해주세요.'
      });
    }
    
    const visualizationData = services.arVisualization.generateVisualizationData(verificationResult);
    
    res.json({
      success: true,
      visualizationData
    });
  } catch (error) {
    logger.error(`AR 시각화 데이터 생성 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/detect-claims
 * @desc    텍스트에서 주장 감지 및 분류
 * @access  Public
 */
router.post('/detect-claims', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text) {
      return res.status(400).json({
        error: true,
        message: '분석할 텍스트를 제공해주세요.'
      });
    }
    
    const startTime = Date.now();
    
    // 주장 감지 모듈 사용
    const detectedClaims = await services.claimDetection.detectClaims(text);
    
    // 결과 요약 생성
    const summary = services.claimDetection.summarizeClaimDetection(detectedClaims);
    
    res.json({
      success: true,
      message: `${detectedClaims.length}개의 주장이 감지되었습니다`,
      result: {
        claims: detectedClaims,
        summary: summary,
        processingTime: formatTimeInterval(Date.now() - startTime)
      }
    });
  } catch (error) {
    logger.error(`주장 감지 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/stream-analyze
 * @desc    실시간 미디어 스트림 분석 및 팩트체킹
 * @access  Public
 */
router.post('/stream-analyze', async (req, res) => {
  try {
    const { mediaUrl, streamType = 'LIVE', language = 'ko' } = req.body;
    
    if (!mediaUrl) {
      return res.status(400).json({
        error: true,
        message: '분석할 미디어 스트림 URL을 제공해주세요.'
      });
    }
    
    // 분석 세션 ID 생성
    const sessionId = `stream_${Date.now()}`;
    const startTime = Date.now();
    
    // 비동기 분석 시작 (실제 처리는 백그라운드에서 진행)
    // 여기서는 결과를 SSE를 통해 전송하므로 즉시 응답
    
    // 분석 시작 알림
    services.factChecker.sendEventToAll({
      eventType: 'stream_analysis_started',
      sessionId: sessionId,
      mediaUrl: mediaUrl,
      streamType: streamType,
      timestamp: new Date().toISOString()
    });
    
    // 백그라운드에서 스트림 분석 시작
    processMediaStream(sessionId, mediaUrl, streamType, language);
    
    res.json({
      success: true,
      message: '실시간 미디어 스트림 분석이 시작되었습니다',
      result: {
        sessionId: sessionId,
        streamType: streamType,
        language: language,
        startTime: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error(`스트림 분석 요청 처리 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * 미디어 스트림 처리 함수 (백그라운드 프로세스)
 * @param {string} sessionId - 분석 세션 ID
 * @param {string} mediaUrl - 미디어 스트림 URL
 * @param {string} streamType - 스트림 유형 (LIVE, VOD)
 * @param {string} language - 언어 코드
 */
async function processMediaStream(sessionId, mediaUrl, streamType, language) {
  try {
    // 실제 구현에서는 여기에 미디어 스트림 처리 로직 구현
    // 지금은 간단한 예시만 제공
    
    // 1. 분석 준비 중 이벤트 전송
    services.factChecker.sendEventToAll({
      eventType: 'stream_analysis_progress',
      sessionId: sessionId,
      progress: 10,
      status: '스트림 연결 중...',
      timestamp: new Date().toISOString()
    });
    
    // 실제 구현에서는 이 부분에 스트림 연결 및 처리 로직 추가
    
    // 임시 딜레이 (실제 구현에서는 제거)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 2. 스트림 처리 진행 이벤트
    services.factChecker.sendEventToAll({
      eventType: 'stream_analysis_progress',
      sessionId: sessionId,
      progress: 50,
      status: '트랜스크립트 생성 중...',
      timestamp: new Date().toISOString()
    });
    
    // 임시 딜레이 (실제 구현에서는 제거)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 3. 처리 완료 이벤트 (또는 주기적 업데이트)
    services.factChecker.sendEventToAll({
      eventType: 'stream_analysis_result',
      sessionId: sessionId,
      result: {
        transcript: '이것은 임시 트랜스크립트입니다.',
        claims: [
          {
            text: '이것은 스트림에서 감지된 임시 주장입니다.',
            confidence: 0.8,
            type: '사실적 주장',
            timestamp: new Date().toISOString()
          }
        ]
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`미디어 스트림 처리 중 오류: ${error.message}`);
    
    // 오류 이벤트 전송
    services.factChecker.sendEventToAll({
      eventType: 'stream_analysis_error',
      sessionId: sessionId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * @route   GET /api/claim-types
 * @desc    지원되는 주장 유형 목록 조회
 * @access  Public
 */
router.get('/claim-types', (req, res) => {
  try {
    const claimTypes = services.claimDetection.CLAIM_TYPES;
    
    res.json({
      success: true,
      result: {
        types: claimTypes
      }
    });
  } catch (error) {
    logger.error(`주장 유형 조회 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/verify-claim
 * @desc    주장 검증
 * @access  Public
 */
router.post('/verify-claim', async (req, res) => {
  try {
    const { claim, language = 'ko' } = req.body;
    
    if (!claim) {
      return res.status(400).json({
        error: true,
        message: '검증할 주장을 제공해주세요.'
      });
    }
    
    const startTime = Date.now();
    
    // 팩트체킹 모듈 사용
    const verificationResult = await services.factChecker.verifyClaimProcess(claim, {
      languageCode: language
    });
    
    res.json({
      success: true,
      message: '주장 검증이 완료되었습니다.',
      result: verificationResult,
      processingTime: formatTimeInterval(Date.now() - startTime)
    });
  } catch (error) {
    logger.error(`주장 검증 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/verify-claim-multi
 * @desc    멀티 API 통합 주장 검증
 * @access  Public
 */
router.post('/verify-claim-multi', async (req, res) => {
  try {
    const { claim, language = 'ko', apis } = req.body;
    
    if (!claim) {
      return res.status(400).json({
        error: true,
        message: '검증할 주장을 제공해주세요.'
      });
    }
    
    const startTime = Date.now();
    
    // 멀티 API 통합 팩트체킹 모듈 사용
    const verificationResult = await services.factCheckerIntegration.verifyClaim(claim, {
      languageCode: language,
      apis: apis // 옵션: 'google', 'factiverse', 'bigkinds' 중 선택적으로 지정
    });
    
    res.json({
      success: true,
      message: '멀티 API 통합 주장 검증이 완료되었습니다.',
      result: verificationResult,
      processingTime: formatTimeInterval(Date.now() - startTime)
    });
  } catch (error) {
    logger.error(`멀티 API 통합 주장 검증 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   POST /api/verify-claims-batch
 * @desc    여러 주장 일괄 검증
 * @access  Public
 */
router.post('/verify-claims-batch', async (req, res) => {
  try {
    const { claims, language = 'ko', apis } = req.body;
    
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return res.status(400).json({
        error: true,
        message: '검증할 주장 배열을 제공해주세요.'
      });
    }
    
    const startTime = Date.now();
    
    // 멀티 API 통합 팩트체킹 모듈 사용 (배치 처리)
    const verificationResults = await services.factCheckerIntegration.verifyClaimBatch(claims, {
      languageCode: language,
      apis: apis
    });
    
    res.json({
      success: true,
      message: `${claims.length}개 주장에 대한 일괄 검증이 완료되었습니다.`,
      results: verificationResults,
      processingTime: formatTimeInterval(Date.now() - startTime)
    });
  } catch (error) {
    logger.error(`일괄 주장 검증 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route GET /api/metrics
 * @description 성능 지표 조회
 * @access Private (실제 구현시 인증 미들웨어 추가 필요)
 */
router.get('/metrics', (req, res) => {
  try {
    const metrics = performanceMonitor.getMetricsSummary();
    res.json(metrics);
  } catch (error) {
    logger.error(`성능 지표 조회 오류: ${error.message}`, { stack: error.stack });
    res.status(500).json({ error: '성능 지표 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @route GET /api/metrics/api
 * @description API 성능 지표 조회
 * @access Private (실제 구현시 인증 미들웨어 추가 필요)
 */
router.get('/metrics/api', (req, res) => {
  try {
    const metrics = performanceMonitor.getMetricsSummary();
    res.json(metrics.api);
  } catch (error) {
    logger.error(`API 성능 지표 조회 오류: ${error.message}`, { stack: error.stack });
    res.status(500).json({ error: 'API 성능 지표 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @route GET /api/metrics/system
 * @description 시스템 성능 지표 조회
 * @access Private (실제 구현시 인증 미들웨어 추가 필요)
 */
router.get('/metrics/system', (req, res) => {
  try {
    const metrics = performanceMonitor.getMetricsSummary();
    res.json({
      system: metrics.system,
      process: metrics.process
    });
  } catch (error) {
    logger.error(`시스템 성능 지표 조회 오류: ${error.message}`, { stack: error.stack });
    res.status(500).json({ error: '시스템 성능 지표 조회 중 오류가 발생했습니다.' });
  }
});

/**
 * @route   POST /api/frames/analyze
 * @desc    화면 캡처된 이미지 프레임 분석
 * @access  Public
 */
router.post('/frames/analyze', async (req, res) => {
  try {
    // 요청 시작 시간
    const startTime = Date.now();
    
    // 요청 데이터 확인
    const { imageData } = req.body;
    
    if (!imageData) {
      return res.status(400).json({
        success: false,
        message: '이미지 데이터가 제공되지 않았습니다'
      });
    }
    
    // base64 데이터인지 확인
    if (!imageData.startsWith('data:image/') && !imageData.startsWith('data:application/octet-stream;base64,')) {
      return res.status(400).json({
        success: false,
        message: '유효하지 않은 이미지 형식입니다'
      });
    }
    
    try {
      // 이미지 분석 서비스 호출
      const result = await services.frameAnalysis.analyze(imageData);
      
      // 처리 완료 시간 계산
      const processingTime = Date.now() - startTime;
      
      // 성능 메트릭 기록
      performanceMonitor.recordApiMetrics(
        '/api/frames/analyze',
        processingTime,
        true
      );
      
      if (processingTime > config.performance.timeout.api) {
        logger.warn(`이미지 프레임 분석 성능 저하: ${processingTime}ms`);
      }
      
      // 결과 반환
      res.json({
        success: true,
        message: '이미지 프레임 분석이 완료되었습니다',
        claims: result.claims || [],
        processingTime: formatTimeInterval(processingTime)
      });
    } catch (analyzeError) {
      logger.error(`이미지 분석 처리 중 오류: ${analyzeError.message}`);
      
      // 처리 완료 시간 계산
      const processingTime = Date.now() - startTime;
      
      // 성능 메트릭 기록 (오류)
      performanceMonitor.recordApiMetrics(
        '/api/frames/analyze',
        processingTime,
        false
      );
      
      return res.status(500).json({
        success: false,
        message: `이미지 분석 처리 중 오류가 발생했습니다: ${analyzeError.message}`
      });
    }
  } catch (error) {
    logger.error(`이미지 프레임 분석 요청 처리 중 오류 발생: ${error.message}`);
    res.status(500).json(formatApiError(error));
  }
});

/**
 * @route   GET /api/status
 * @desc    서버 상태 확인 API
 * @access  Public
 */
router.get('/status', (req, res) => {
  const dbStatus = isMongoConnected() ? 'connected' : 'disconnected';
  
  // 캐시 헤더 설정 (최대 15초)
  res.set({
    'Cache-Control': 'public, max-age=15',
    'Expires': new Date(Date.now() + 15000).toUTCString()
  });
  
  res.json({
    status: 'online',
    time: new Date().toISOString(),
    database: dbStatus,
    services: {
      factChecker: 'available',
      contentAnalysis: 'available'
    }
  });
});

/**
 * 뉴스 콘텐츠 검증 요청 엔드포인트
 * 뉴스 기사의 내용을 분석하고 주요 주장을 검증합니다.
 */
router.post('/verify', async (req, res) => {
  try {
    console.log('[API] 검증 요청 수신:', req.body);
    
    // 파라미터 추출
    const { url, content } = req.body;
    
    // URL 또는 콘텐츠 중 하나는 필수
    if (!url && !content) {
      return res.status(400).json({
        error: true,
        message: "URL 또는 콘텐츠가 필요합니다."
      });
    }
    
    // 클레임 ID 생성
    const claimId = generateClaimId(url, content);
    console.log(`[API] 생성된 클레임 ID: ${claimId}`);
    
    // 기존 검증 결과 확인 (최신 검증 결과가 있고 완료 상태인 경우)
    const existingVerification = await Verification.findOne({ 
      claimId, 
      status: 'completed',
      completed: { $exists: true }
    }).sort({ created: -1 }).exec();
    
    // 생성된지 1시간(3600000ms) 이내의 완료된 검증 결과가 있으면 반환
    if (existingVerification && (Date.now() - new Date(existingVerification.completed).getTime()) < 3600000) {
      console.log(`[API] 캐시된 검증 결과 반환:`, existingVerification.results);
      
      return res.json({
        success: true,
        verification: {
          id: existingVerification._id,
          claimId: existingVerification.claimId,
          status: existingVerification.status,
          progress: 100,
          created: existingVerification.created,
          completed: existingVerification.completed,
          results: existingVerification.results
        },
        message: "기존 검증 결과가 반환되었습니다."
      });
    }
    
    // 처리 중인 검증이 있는지 확인 (3분 이내 시작된 경우)
    const inProgressVerification = await Verification.findOne({
      claimId,
      status: { $in: ['processing', 'analyzing'] },
      created: { $gt: new Date(Date.now() - 180000) } // 3분 이내 생성된 요청
    }).sort({ created: -1 }).exec();
    
    if (inProgressVerification) {
      console.log(`[API] 이미 처리 중인 검증 요청 반환:`, inProgressVerification._id);
      
      return res.json({
        success: true,
        verification: {
          id: inProgressVerification._id,
          claimId: inProgressVerification.claimId,
          status: inProgressVerification.status,
          progress: inProgressVerification.progress,
          created: inProgressVerification.created
        },
        message: "이미 처리 중인 검증 요청입니다."
      });
    }
    
    // 콘텐츠 처리
    let processedContent = content;
    
    // 콘텐츠가 없거나 짧은 경우 URL에서 추출 시도
    if ((!processedContent || processedContent.length < 100) && url) {
      try {
        console.log(`[API] URL에서 콘텐츠 추출 시도: ${url}`);
        const extractedData = await contentExtractor.extractFromUrl(url);
        
        if (extractedData) {
          // 추출된 콘텐츠 활용 - 객체 구조 확인
          const extractedContent = extractedData.content;
          const extractedTitle = extractedData.title || title;
          
          console.log(`[API] URL에서 콘텐츠 추출 성공 (${extractedContent.length} 자)`);
          
          // 추출된 콘텐츠가 있고 기존 콘텐츠보다 길면 대체
          if (extractedContent && extractedContent.length > (processedContent?.length || 0)) {
            processedContent = extractedContent;
            // 제목도 함께 업데이트
            if (extractedTitle && (!title || extractedTitle.length > title.length)) {
              title = extractedTitle;
              console.log(`[API] 제목 업데이트: ${title.substring(0, 40)}${title.length > 40 ? '...' : ''}`);
            }
          }
        }
      } catch (extractError) {
        console.error('[API] 콘텐츠 추출 오류:', extractError.message);
      }
    }
    
    if (!processedContent || processedContent.length < 50) {
      return res.status(400).json({
        error: true,
        message: "검증할 콘텐츠가 충분하지 않습니다."
      });
    }
    
    // 비동기적으로 검증 수행
    const verification = await services.factChecker.verifyClaimProcess(claimId, url, processedContent);
    
    // 검증 요청 정보 반환
    return res.json({
      success: true,
      verification: {
        id: verification._id,
        claimId: verification.claimId,
        status: verification.status,
        progress: verification.progress,
        created: verification.created,
        message: "검증 요청이 성공적으로 접수되었습니다."
      }
    });
    
  } catch (error) {
    console.error('[API] 검증 요청 처리 오류:', error);
    
    res.status(500).json({
      error: true,
      message: `검증 요청 처리 중 오류가 발생했습니다: ${error.message}`
    });
  }
});

/**
 * 검증 상태 확인 엔드포인트
 */
router.get('/verify/status/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    console.log(`[API] 검증 상태 요청 - 클레임 ID: ${claimId}`);
    
    if (!claimId) {
      return res.status(400).json({
        error: true,
        message: "클레임 ID가 필요합니다."
      });
    }
    
    // 해당 클레임 ID의 가장 최근 검증 상태 조회
    const verificationResults = await Verification.findOne({ claimId }).sort({ created: -1 }).exec();
    
    if (!verificationResults) {
      return res.status(404).json({
        error: true,
        message: "해당 클레임에 대한 검증 결과를 찾을 수 없습니다."
      });
    }
    
    // 검증 상태 및 결과 반환
    const response = {
      success: true,
      verification: {
        id: verificationResults._id,
        claimId: verificationResults.claimId,
        status: verificationResults.status,
        progress: verificationResults.progress || 0,
        created: verificationResults.created
      }
    };
    
    // 완료된 검증인 경우 결과 포함
    if (verificationResults.status === 'completed') {
      response.verification.completed = verificationResults.completed;
      
      // results가 없거나 빈 객체인 경우 확인
      if (!verificationResults.results || 
          Object.keys(verificationResults.results).length === 0) {
        console.log(`[API] 경고: 완료된 검증에 결과가 없습니다 - 클레임 ID: ${claimId}`);
        
        // 임시 신뢰도 점수 계산해서 결과 생성
        const tempTrustScore = factChecker.calculateTempTrustScore(verificationResults.content);
        response.verification.results = factChecker.generateMockVerificationResults(tempTrustScore);
        
        // 로그 추가
        console.log(`[API] 검증 결과 없음: 임시 결과 생성됨 - 클레임 ID: ${claimId}, 신뢰도: ${tempTrustScore}`);
      } else {
        response.verification.results = verificationResults.results;
        console.log(`[API] 검증 결과 반환 - 클레임 ID: ${claimId}, 상태: ${verificationResults.status}`);
      }
    } else if (verificationResults.status === 'analyzing' || verificationResults.status === 'processing') {
      console.log(`[API] 검증 진행 중 - 클레임 ID: ${claimId}, 진행률: ${verificationResults.progress}%`);
      
      // 오래된 검증 요청인 경우 (10분 이상)
      const requestAge = Date.now() - new Date(verificationResults.created).getTime();
      if (requestAge > 600000) { // 10분(600초)
        console.log(`[API] 경고: 오래된 검증 요청 (${Math.round(requestAge/1000/60)}분) - 임시 결과 생성`);
        
        // 검증이 지연되는 경우 임시 결과 제공
        const tempTrustScore = factChecker.calculateTempTrustScore(verificationResults.content);
        response.verification.results = factChecker.generateMockVerificationResults(tempTrustScore);
        response.verification.status = 'completed'; // 상태를 완료로 변경
        response.verification.progress = 100;
        
        // DB에 상태 업데이트
        try {
          await Verification.updateOne(
            { _id: verificationResults._id },
            { 
              $set: { 
                status: 'completed',
                progress: 100,
                completed: new Date(),
                results: response.verification.results
              }
            }
          );
          console.log(`[API] 오래된 요청의 상태가 업데이트되었습니다 - 클레임 ID: ${claimId}`);
        } catch (updateError) {
          console.error(`[API] 검증 상태 업데이트 오류:`, updateError);
        }
      }
    }
    // 오류 발생한 경우 오류 메시지 포함
    else if (verificationResults.status === 'error') {
      response.verification.error = verificationResults.error || '검증 과정에서 오류가 발생했습니다';
      response.verification.message = '검증 과정에서 오류가 발생했습니다';
      
      console.log(`[API] 오류 상태 검증 반환:`, {
        status: 'error',
        error: response.verification.error
      });
    }
    // 기타 상태
    else {
      response.verification.message = `알 수 없는 검증 상태: ${verificationResults.status}`;
      console.log(`[API] 알 수 없는 검증 상태 반환:`, verificationResults.status);
    }
    
    return res.json(response);
    
  } catch (error) {
    console.error('[API] 검증 상태 확인 오류:', error);
    
    res.status(500).json({
      error: true,
      message: `검증 상태 확인 중 오류가 발생했습니다: ${error.message}`
    });
  }
});

/**
 * @route   POST /api/verify-news
 * @desc    뉴스 콘텐츠의 주장을 검증하는 엔드포인트 (백그라운드 스크립트에서 사용)
 * @access  Public
 */
router.post('/verify-news', async (req, res) => {
  try {
    logger.info('[API] /verify-news 요청 수신', { service: 'api' });
    console.log(`[API] /verify-news 요청 데이터:`, {
      url: req.body.url || '(없음)', 
      content: req.body.content ? `${req.body.content.length}자` : '(없음)',
      title: req.body.title || '(없음)',
      has_url: !!req.body.url,
      has_content: !!req.body.content,
      has_title: !!req.body.title,
      client_id: req.body.clientId || '(없음)'
    });
    
    const startTime = Date.now();
    let title = req.body.title || '';
    let content = req.body.content || '';
    let url = req.body.url || '';
    const clientId = req.body.clientId;

    if (!url && !content) {
      const errorMsg = 'URL 또는 검증할 콘텐츠가 필요합니다.';
      logger.warn(`[API] /verify-news 요청 실패: ${errorMsg}`, { service: 'api' });
      return res.status(400).json({ success: false, error: errorMsg });
    }

    // URL이 제공되었지만 내용이 없는 경우, URL에서 내용 추출
    if (url && !content) {
      console.log(`[API] URL에서 콘텐츠 추출 시작: ${url}`);
      try {
        // URL에서 내용 추출
        const extractionStartTime = Date.now();
        const extracted = await contentExtractor.extractFromUrl(url);
        const extractionTime = Date.now() - extractionStartTime;
        
        content = extracted.content || '';
        
        // 추출된 제목이 있고, 기존 제목보다 길면 업데이트
        if (extracted.title && (!title || extracted.title.length > title.length)) {
          console.log(`[API] 제목 업데이트: "${title}" -> "${extracted.title}"`);
          title = extracted.title;
        }
        
        console.log(`[API] URL에서 콘텐츠 추출 완료: 제목 ${title.length}자, 본문 ${content.length}자 (소요 시간: ${extractionTime}ms)`);
      } catch (extractError) {
        console.error(`[API] URL에서 콘텐츠 추출 실패:`, extractError);
        logger.error(`[API] URL에서 콘텐츠 추출 실패: ${extractError.message}`, { 
          service: 'api',
          url,
          error: extractError
        });
        
        return res.status(400).json({ 
          success: false, 
          error: `URL에서 콘텐츠를 추출할 수 없습니다: ${extractError.message}` 
        });
      }
    }
    
    // 콘텐츠가 충분한지 확인
    if (content.length < 100) {
      const errorMsg = `콘텐츠가 너무 짧습니다 (${content.length}자). 최소 100자 이상 필요합니다.`;
      console.warn(`[API] 콘텐츠 길이 불충분: ${content.length}자`);
      logger.warn(`[API] /verify-news 요청 실패: ${errorMsg}`, { service: 'api' });
      return res.status(400).json({ success: false, error: errorMsg, contentLength: content.length });
    }
    
    // 제목이 없으면 URL에서 추출 또는 기본값 사용
    if (!title) {
      title = url ? url.split('/').pop() || '제목 없음' : '제목 없음';
      console.log(`[API] 제목이 없어 기본값 사용: "${title}"`);
    }

    console.log(`[API] 검증 요청 준비 완료: 제목 ${title.length}자, 본문 ${content.length}자`);
    // 클레임 아이디 생성
    const claimId = generateClaimId(url, content);
    console.log(`[API] 클레임 ID 생성: ${claimId}`);

    // 이미 동일한 클레임 ID로 검증이 진행 중인지 확인
    const existingVerification = await Verification.findOne({
      where: { claimId: claimId }
    });

    if (existingVerification) {
      console.log(`[API] 기존 검증 레코드 발견: ${claimId}, 상태: ${existingVerification.status}`);
      // 클라이언트 ID를 추가하고 저장
      if (clientId && !existingVerification.clientIds.includes(clientId)) {
        existingVerification.clientIds = [...existingVerification.clientIds, clientId];
        await existingVerification.save();
        console.log(`[API] 클라이언트 ID 추가: ${clientId} (총 ${existingVerification.clientIds.length}개)`);
      }
    } else {
      console.log(`[API] 새 검증 레코드 생성: ${claimId}`);
      // 새 검증 레코드 생성
      await Verification.create({
        claimId,
        url: url || null,
        title,
        content,
        status: 'pending',
        progress: 0,
        clientIds: clientId ? [clientId] : [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      console.log(`[API] 새 검증 레코드 저장 완료: ${claimId}`);
    }

    // 백그라운드에서 검증 프로세스 시작
    factChecker.verifyClaimProcess(claimId, url, title, content)
      .catch(err => {
        console.error(`[API] 검증 프로세스 시작 중 오류:`, err);
        logger.error(`[API] 검증 프로세스 시작 실패: ${err.message}`, { service: 'api', error: err });
      });

    const totalTime = Date.now() - startTime;
    console.log(`[API] /verify-news 요청 처리 완료: ${totalTime}ms`);
    logger.info(`[API] 검증 요청 성공 처리: ${claimId}, 소요 시간: ${totalTime}ms`, { service: 'api' });
    
    return res.json({ 
      success: true, 
      message: '검증 요청이 성공적으로 등록되었습니다.', 
      claimId,
      processingTime: totalTime
    });
  } catch (error) {
    console.error(`[API] /verify-news 처리 중 예외 발생:`, error);
    logger.error(`[API] /verify-news 처리 중 오류: ${error.message}`, { service: 'api', error });
    return res.status(500).json({ 
      success: false, 
      error: `서버 오류: ${error.message}` 
    });
  }
});

/**
 * @route   POST /api/verify/enhanced
 * @desc    향상된 URL 콘텐츠 검증
 * @access  Public
 */
router.post('/verify/enhanced', async (req, res) => {
  const context = createLoggingContext(req);
  const startTime = Date.now();
  
  try {
    const { url, content, forceRefresh } = req.body;
    
    if (!url && !content) {
      return res.status(400).json({
        success: false,
        error: 'URL 또는 콘텐츠를 제공해주세요.'
      });
    }
    
    // 캐시 키 생성
    const cacheKey = generateClaimId(url, content);
    
    // 이미 처리 중인 요청인지 확인
    if (processingRequests.has(cacheKey)) {
      logger.info('중복 요청 감지', { ...context, cacheKey });
      return res.status(202).json({
        success: true,
        message: '이미 처리 중인 요청입니다.',
        requestId: cacheKey
      });
    }
    
    // forceRefresh가 true가 아닐 경우에만 캐시를 확인
    if (!forceRefresh && isMongoConnected()) {
      const cachedResult = await Verification.findOne({ claimId: cacheKey });
      if (cachedResult) {
        logger.info('캐시된 결과 반환', { 
          ...context,
          cacheKey,
          cachedAt: cachedResult.verifiedAt
        });
        return res.json({
          success: true,
          cached: true,
          processingTime: '1ms',
          result: cachedResult
        });
      }
    } else if (forceRefresh) {
      logger.info('강제 새로고침 요청 - 캐시 무시', { ...context, cacheKey });
    }
    
    // 처리 중인 요청으로 등록
    processingRequests.set(cacheKey, Date.now());
    
    // URL 콘텐츠 검증 실행
    logger.info('검증 프로세스 시작', { ...context, url, forceRefresh: !!forceRefresh });
    
    const result = await factChecker.enhancedVerifyContent(url, content);
    
    // 추출된 콘텐츠 로깅
    if (result.extractedContent) {
      logContent(context, 'EXTRACTED', result.extractedContent, {
        url,
        extractionMethod: result.metadata?.extractionMethod
      });
    }
    
    // 검증 결과 로깅
    logVerificationResult(context, result, {
      processingTime: Date.now() - startTime,
      url
    });
    
    // 결과 캐싱
    if (isMongoConnected()) {
      // 기존 검증 결과가 있으면 업데이트, 없으면 새로 생성
      if (forceRefresh) {
        await Verification.findOneAndUpdate(
          { claimId: cacheKey },
          { 
            ...result,
            verifiedAt: new Date() 
          },
          { upsert: true, new: true }
        );
        logger.info('기존 캐시 업데이트', { ...context, cacheKey });
      } else {
        const verification = new Verification({
          claimId: cacheKey,
          ...result,
          verifiedAt: new Date()
        });
        await verification.save();
      }
    }
    
    // 처리 중인 요청에서 제거
    processingRequests.delete(cacheKey);
    
    return res.json({
      success: true,
      cached: false,
      processingTime: formatTimeInterval(Date.now() - startTime),
      result
    });
    
  } catch (error) {
    // 에러 로깅
    logError(context, error, {
      url: req.body.url,
      processingTime: Date.now() - startTime
    });
    
    // 처리 중인 요청에서 제거
    if (req.body.url || req.body.content) {
      const cacheKey = generateClaimId(req.body.url, req.body.content);
      processingRequests.delete(cacheKey);
    }
    
    return res.status(500).json({
      success: false,
      error: formatApiError(error)
    });
  }
});

/**
 * @route   POST /api/extract-and-analyze
 * @desc    URL에서 본문 추출, 요약, 주장 검증을 한번에 수행
 * @access  Public
 */
router.post('/extract-and-analyze', limiter('standard'), async (req, res) => {
  try {
    const { url } = req.body;
    
    // URL은 필수
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL을 제공해야 합니다.'
      });
    }
    
    logger.info(`[API] 콘텐츠 추출 및 분석 요청: URL=${url}`);
    
    // URL 유효성 검사
    let validUrl;
    try {
      const urlObj = new URL(url);
      validUrl = urlObj.toString();
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: '유효하지 않은 URL 형식입니다.'
      });
    }
    
    // 캐시 키 생성
    const cacheKey = `extract:${generateClaimId(validUrl, '')}`;
    
    // 캐시 확인
    const cachedResult = await getCachedVerification(cacheKey);
    if (cachedResult) {
      logger.info(`[API] 캐시된 추출 결과 반환: ${cacheKey}`);
      return res.json({
        success: true,
        cached: true,
        result: cachedResult
      });
    }
    
    // 측정 시작
    const startTime = Date.now();
    
    // 1. 콘텐츠 추출
    let extractedContent = null;
    let title = '';
    let content = '';
    
    // FireCrawl 시도
    try {
      logger.info(`[API] FireCrawl로 콘텐츠 추출 시도: ${validUrl}`);
      const extractResult = await factChecker.extractContentWithFireCrawl(validUrl);
      
      if (extractResult && extractResult.success) {
        extractedContent = extractResult;
        title = extractResult.title || '';
        content = extractResult.content || '';
        logger.info(`[API] FireCrawl 추출 성공: 내용 길이=${content.length}자`);
      } else {
        logger.warn(`[API] FireCrawl 추출 실패: ${extractResult?.error || '알 수 없는 오류'}`);
      }
    } catch (extractError) {
      logger.error(`[API] FireCrawl 추출 오류: ${extractError.message}`);
    }
    
    // FireCrawl 실패 시 contentExtractor 시도
    if (!extractedContent || !extractedContent.success || content.length < 100) {
      try {
        logger.info(`[API] contentExtractor로 콘텐츠 추출 시도: ${validUrl}`);
        const contentExtractor = require('../utils/contentExtractor');
        const extracted = await contentExtractor.extractFromUrl(validUrl);
        
        if (extracted && extracted.title && extracted.content) {
          title = extracted.title;
          content = extracted.content;
          logger.info(`[API] contentExtractor 추출 성공: 내용 길이=${content.length}자`);
        } else {
          logger.warn(`[API] contentExtractor 추출 실패`);
        }
      } catch (extractorError) {
        logger.error(`[API] contentExtractor 오류: ${extractorError.message}`);
      }
    }
    
    // 추출 실패 시 오류 반환
    if (!content || content.length < 100) {
      return res.status(400).json({
        success: false,
        error: '콘텐츠를 추출할 수 없거나 추출된 내용이 너무 짧습니다.',
        extractError: extractedContent?.error || '알 수 없는 오류'
      });
    }
    
    // 2. 콘텐츠 분석 (요약, 주장 추출, 주제 식별)
    logger.info(`[API] AI 콘텐츠 분석 시작: 내용 길이=${content.length}자`);
    const analysis = await factChecker.analyzeContentWithAI(content);
    logger.info(`[API] AI 콘텐츠 분석 완료: 요약=${analysis.summary?.length || 0}자, 주장=${analysis.mainClaims?.length || 0}개, 주제=${analysis.topics?.length || 0}개`);
    
    // 3. 주요 주장 검증 (최대 3개)
    const claimsToVerify = analysis.mainClaims.slice(0, 3);
    logger.info(`[API] 주장 검증 시작: ${claimsToVerify.length}개 주장`);
    
    const verificationPromises = claimsToVerify.map(async (claim, index) => {
      try {
        const factCheckerIntegration = require('../services/factCheckerIntegration');
        const verificationResult = await factCheckerIntegration.verifyClaim(claim.text, {
          languageCode: 'ko',
          maxResults: 3
        });
        
        logger.info(`[API] 주장 ${index+1}/${claimsToVerify.length} 검증 완료: 신뢰도=${verificationResult.verification.trustScore}`);
        
        return {
          claim: claim.text,
          trustScore: verificationResult.verification.trustScore,
          status: verificationResult.verification.status,
          explanation: verificationResult.verification.explanation,
          sources: (verificationResult.verification.sources || []).slice(0, 3)
        };
      } catch (verifyError) {
        logger.warn(`[API] 주장 검증 오류: ${verifyError.message}`);
        return {
          claim: claim.text,
          trustScore: 0.5,
          status: 'UNKNOWN',
          explanation: '검증 중 오류가 발생했습니다.',
          sources: []
        };
      }
    });
    
    // 주장 검증 결과 수집
    const verifiedClaims = await Promise.all(verificationPromises);
    
    // 소요 시간 측정
    const endTime = Date.now();
    const processingTime = endTime - startTime;
    
    // 결과 구성
    const result = {
      url: validUrl,
      title,
      content: content.substring(0, 2000) + (content.length > 2000 ? '...' : ''), // 응답 크기 제한
      summary: analysis.summary,
      topics: analysis.topics,
      verifiedClaims,
      metadata: {
        extractedAt: new Date().toISOString(),
        contentLength: content.length,
        extractionMethod: extractedContent?.success ? 'FireCrawl' : 'contentExtractor',
        processingTime: `${processingTime}ms`
      }
    };
    
    // 결과 캐싱 (1시간)
    await cacheVerification(cacheKey, result, 3600);
    
    // 응답 전송
    logger.info(`[API] 추출 및 분석 완료: 소요시간=${processingTime}ms`);
    
    return res.json({
      success: true,
      cached: false,
      processingTime: `${processingTime}ms`,
      result
    });
  } catch (error) {
    logger.error(`[API] 추출 및 분석 중 오류: ${error.message}`);
    
    return res.status(500).json({
      success: false,
      error: `처리 중 오류가 발생했습니다: ${error.message}`
    });
  }
});

/**
 * Redis에서 캐시된 검증 결과 가져오기
 * @param {string} key - 캐시 키
 * @returns {Promise<Object|null>} - 캐시된 결과 또는 null
 */
async function getCachedVerification(key) {
  try {
    if (!global.redisClient) return null;
    
    const cached = await global.redisClient.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    logger.error(`캐시 조회 오류: ${error.message}`, { service: 'factchecker' });
    return null;
  }
}

/**
 * Redis에 검증 결과 캐싱
 * @param {string} key - 캐시 키
 * @param {Object} result - 캐싱할 결과
 * @param {number} ttl - 캐시 유효 시간(초), 기본 30분
 * @returns {Promise<boolean>} - 성공 여부
 */
async function cacheVerification(key, result, ttl = 1800) {
  try {
    if (!global.redisClient) return false;
    
    await global.redisClient.set(key, JSON.stringify(result), 'EX', ttl);
    return true;
  } catch (error) {
    logger.error(`캐시 저장 오류: ${error.message}`, { service: 'factchecker' });
    return false;
  }
}

/**
 * @route   GET /api/sse
 * @desc    서버 이벤트 스트림 연결
 * @access  Public
 */
router.get('/sse', (req, res) => {
  const clientId = req.query.clientId || Date.now().toString();
  
  // SSE 헤더 설정
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  
  // 클라이언트에게 연결 성공 메시지 전송
  res.write(`data: {"type": "connected", "clientId": "${clientId}"}\n\n`);
  
  console.log(`[SSE] 클라이언트 연결됨: ${clientId}`);
  
  // SSE 클라이언트 등록
  factChecker.registerSSEClient({
    id: clientId,
    response: res
  });
  
  // 연결 종료 시 클라이언트 제거
  req.on('close', () => {
    console.log(`[SSE] 클라이언트 연결 종료: ${clientId}`);
    factChecker.removeSSEClient(clientId);
  });
});

/**
 * @swagger
 * /api/verify/summary:
 *   post:
 *     summary: 요약문에서 핵심 키워드를 추출하고 팩트체크 수행
 *     description: 요약문에서 핵심 키워드를 추출하고 해당 키워드에 대한 팩트체크를 수행합니다.
 *     tags: [FactCheck]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - summary
 *             properties:
 *               summary:
 *                 type: string
 *                 description: 검증할 요약문
 *               url:
 *                 type: string
 *                 description: 요약문의 출처 URL (선택사항)
 *     responses:
 *       200:
 *         description: 팩트체크 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 keyword:
 *                   type: string
 *                 verdict:
 *                   type: string
 *                   enum: [true, mostly_true, partially_true, unverified, mostly_false, false, error]
 *                 trustScore:
 *                   type: number
 *                   format: float
 *                 explanation:
 *                   type: string
 *                 sources:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/verify/summary', async (req, res) => {
  try {
    const { summary, url } = req.body;
    
    // 요약문 검증
    if (!summary || typeof summary !== 'string' || summary.length < 10) {
      return res.status(400).json({
        success: false,
        error: '유효한 요약문을 제공해주세요 (최소 10자 이상)'
      });
    }
    
    // 로깅
    logger.info(`[API] 요약문 팩트체크 요청 - 길이: ${summary.length}자`, { service: 'factchecker' });
    
    // ContentRecognitionService 인스턴스 생성
    const contentService = new ContentRecognitionService();
    
    // 요약에서 핵심 키워드 추출 및 검증
    const result = await contentService.extractAndVerifyFromSummary(summary);
    
    // 결과에 URL 정보 추가 (제공된 경우)
    if (url) {
      result.sourceUrl = url;
    }
    
    // API 응답 반환
    return res.json(result);
  } catch (error) {
    logger.error(`[API] 요약문 팩트체크 오류: ${error.message}`, { service: 'factchecker' });
    
    return res.status(500).json({
      success: false,
      error: '요약문 검증 중 오류가 발생했습니다',
      details: error.message
    });
  }
});

/**
 * @swagger
 * /api/content/summarize:
 *   post:
 *     summary: 콘텐츠 요약 생성
 *     description: 제목과 내용을 바탕으로 요약문을 생성합니다.
 *     tags: [Content]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - content
 *             properties:
 *               title:
 *                 type: string
 *                 description: 콘텐츠 제목
 *               content:
 *                 type: string
 *                 description: 요약할 콘텐츠 본문
 *               url:
 *                 type: string
 *                 description: 콘텐츠 출처 URL
 *     responses:
 *       200:
 *         description: 요약 결과
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 summary:
 *                   type: string
 *                 topics:
 *                   type: array
 *                   items:
 *                     type: string
 *       400:
 *         description: 잘못된 요청
 *       500:
 *         description: 서버 오류
 */
router.post('/content/summarize', async (req, res) => {
  try {
    const { content, title, url } = req.body;
    
    // 콘텐츠 검증
    if (!content || typeof content !== 'string' || content.length < 50) {
      return res.status(400).json({
        success: false,
        error: '유효한 콘텐츠를 제공해주세요 (최소 50자 이상)'
      });
    }
    
    // 로깅
    logger.info(`[API] 콘텐츠 요약 요청 - 길이: ${content.length}자, 제목 여부: ${!!title}`, { service: 'factchecker' });
    
    // ContentRecognitionService 인스턴스 생성
    const contentService = new ContentRecognitionService();
    
    // 요약 생성
    const summary = await contentService.generateSummary(content);
    
    // 주제어 추출 (선택적)
    const topics = await contentService.extractTopics(content);
    
    // API 응답 반환
    return res.json({
      success: true,
      summary,
      topics,
      url
    });
  } catch (error) {
    logger.error(`[API] 콘텐츠 요약 오류: ${error.message}`, { service: 'factchecker' });
    
    return res.status(500).json({
      success: false,
      error: '콘텐츠 요약 중 오류가 발생했습니다',
      details: error.message
    });
  }
});

/**
 * 주장 감지 및 키워드 검색 API
 */
router.post('/content/detect-and-search', async (req, res) => {
  try {
    const { text } = req.body;
    
    if (!text || text.length < 50) {
      return res.status(400).json({
        success: false,
        error: '텍스트가 너무 짧습니다. 최소 50자 이상의 텍스트를 입력해주세요.'
      });
    }
    
    logger.info(`주장 감지 및 키워드 검색 요청 - 텍스트 길이: ${text.length}자`);
    
    // 주장 감지 및 키워드 검색 수행
    const result = await detectClaimsAndSearch(text);
    
    if (result.error) {
      logger.error(`주장 감지 및 키워드 검색 실패: ${result.error}`);
      return res.status(500).json({
        success: false,
        error: `주장 감지 및 키워드 검색 중 오류가 발생했습니다: ${result.error}`
      });
    }
    
    // 검색 결과가 있는 경우 상세 정보 로그
    if (result.searchResults && result.searchResults.success) {
      logger.info(`주장 감지 및 키워드 검색 완료`, {
        claims_count: result.claims.length,
        keyword: result.searchResults.keyword,
        tavily_count: result.searchResults.results?.tavily?.length || 0,
        brave_count: result.searchResults.results?.braveSearch?.length || 0,
        timestamp: new Date().toISOString()
      });
    }
    
    return res.json({
      success: true,
      claims: result.claims,
      searchResults: result.searchResults
    });
  } catch (error) {
    logger.error(`주장 감지 및 키워드 검색 API 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: `서버 오류: ${error.message}`
    });
  }
});

/**
 * @route   POST /api/keyword-search
 * @desc    주장에서 키워드 추출 및 검색 요청
 * @access  Public
 */
router.post('/keyword-search', async (req, res) => {
  const { claims } = req.body;
  const context = createLoggingContext(req);
  
  if (!claims) {
    logError(context, new Error('주장이 제공되지 않았습니다'), { body: req.body });
    return res.status(400).json({
      success: false,
      message: '주장을 제공해야 합니다.'
    });
  }
  
  try {
    logContent(context, 'CLAIMS', claims);
    
    // factChecker 서비스의 함수 호출
    const result = await services.factChecker.findKeywordAndSearchFromClaims(claims);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: result.error || '키워드 검색 실패'
      });
    }
    
    // 검색 결과 로깅
    logVerificationResult(context, {
      type: 'KEYWORD_SEARCH',
      keyword: result.keyword,
      tavilyResultsCount: result.tavilyResults?.results?.length || 0,
      braveResultsCount: result.braveResults?.results?.length || 0
    });
    
    return res.json({
      success: true,
      keyword: result.keyword,
      tavilyResults: result.tavilyResults,
      braveResults: result.braveResults
    });
  } catch (error) {
    logError(context, error, { claims });
    
    return res.status(500).json({
      success: false,
      message: `키워드 추출 및 검색 중 오류: ${error.message}`
    });
  }
});

module.exports = router; 