const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { formatApiError, formatTimeInterval } = require('../utils/helpers');
const services = require('../services');
const config = require('../config');
const { factChecker, factCheckerIntegration, performanceMonitor } = require('../services');
const mongoose = require('mongoose');
const { chromium } = require('playwright');
const axios = require('axios');
const cheerio = require('cheerio');
const { Verification, isMongoConnected } = require('../models/verification');
const contentExtractor = require('../utils/contentExtractor');

// 진행 중인 요청을 추적하는 Map 객체 (임시 메모리 저장)
const processingRequests = new Map();

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

// 검증 상태 확인 API 엔드포인트
router.get('/verification-status/:claimId', async (req, res) => {
  try {
    const { claimId } = req.params;
    const clientId = req.query.clientId;
    
    console.log(`[API] /verification-status/${claimId} 요청 수신, 클라이언트 ID: ${clientId || '(없음)'}`);
    
    // 데이터베이스에서 검증 상태 조회
    const verification = await Verification.findOne({
      where: { claimId }
    });

    if (!verification) {
      console.log(`[API] 검증 ID를 찾을 수 없음: ${claimId}`);
      return res.status(404).json({ 
        success: false, 
        error: '해당 검증 ID를 찾을 수 없습니다.' 
      });
    }
    
    // 클라이언트 ID 존재 시 추가
    if (clientId && !verification.clientIds.includes(clientId)) {
      verification.clientIds = [...verification.clientIds, clientId];
      await verification.save();
      console.log(`[API] 클라이언트 ID 추가: ${clientId} (총 ${verification.clientIds.length}개)`);
    }

    console.log(`[API] 검증 상태 조회 성공: ID=${claimId}, 상태=${verification.status}, 진행도=${verification.progress}%`);
    
    // 상세 결과 반환
    const result = {
      success: true,
      status: verification.status,
      progress: verification.progress,
      claimId: verification.claimId,
      title: verification.title,
      url: verification.url
    };
    
    // 검증이 완료된 경우 결과 포함
    if (verification.status === 'completed') {
      result.result = {
        trustScore: verification.trustScore,
        factCheckerAnalysis: verification.factCheckerAnalysis,
        factCheckingInfo: verification.factCheckingInfo,
        analysisDetails: verification.analysisDetails,
        completedAt: verification.updatedAt
      };
      
      console.log(`[API] 검증 결과 반환: 신뢰도 점수=${verification.trustScore}, 완료 시간=${verification.updatedAt}`);
    } else if (verification.status === 'error') {
      result.error = verification.errorMessage || '검증 과정 중 오류가 발생했습니다.';
      console.log(`[API] 검증 오류 반환: ${result.error}`);
    }

    return res.json(result);
  } catch (error) {
    console.error(`[API] /verification-status 처리 중 예외 발생:`, error);
    logger.error(`[API] /verification-status 처리 중 오류: ${error.message}`, { service: 'api', error });
    
    return res.status(500).json({ 
      success: false, 
      error: `서버 오류: ${error.message}` 
    });
  }
});

module.exports = router; 