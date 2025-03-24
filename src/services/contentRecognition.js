/**
 * 콘텐츠 인식 모듈
 * 다양한 미디어 소스(텍스트, 오디오, 비디오)에서 주장을 인식하고 추출하는 기능을 제공합니다.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const logger = require('../utils/logger');
const { claimPatterns } = require('../utils/helpers');
const config = require('../config');

// Google AI 초기화
const genAI = new GoogleGenerativeAI(config.api.googleAi.apiKey);

/**
 * 텍스트에서 주장 추출
 * @param {string} text - 분석할 텍스트 내용
 * @returns {Promise<Array>} - 추출된 주장 목록
 */
async function extractClaimsFromText(text) {
  try {
    // 1. 정규식 패턴을 사용한 기본 주장 추출
    const claims = [];
    
    // 따옴표 안의 주장 추출
    let match;
    while ((match = claimPatterns.quotedStatement.exec(text)) !== null) {
      if (match[1] && match[1].length > 10) {
        claims.push({
          text: match[1],
          confidence: 0.8,
          source: { type: 'TEXT' }
        });
      }
    }
    
    // 선언적 주장 추출
    while ((match = claimPatterns.declarative.exec(text)) !== null) {
      if (match[1] && match[1].length > 10) {
        claims.push({
          text: match[1],
          confidence: 0.6,
          source: { type: 'TEXT' }
        });
      }
    }
    
    // 수치 관련 주장 추출
    while ((match = claimPatterns.numericalClaim.exec(text)) !== null) {
      if (match[0] && match[0].length > 5) {
        claims.push({
          text: match[0],
          confidence: 0.7,
          source: { type: 'TEXT' }
        });
      }
    }
    
    // 2. Google AI를 사용한 고급 주장 분석 (텍스트가 충분히 긴 경우)
    if (text.length > 100) {
      const enhancedClaims = await analyzeClaimsWithAI(text);
      return [...new Set([...claims, ...enhancedClaims])];
    }
    
    return claims;
  } catch (error) {
    logger.error(`주장 추출 중 오류 발생: ${error.message}`);
    return [];
  }
}

/**
 * Google AI를 사용하여 텍스트에서 주장 분석
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<Array>} - AI가 감지한 주장 목록
 */
async function analyzeClaimsWithAI(text) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    
    const prompt = `
    다음 텍스트에서 사실 확인이 필요한 주장을 추출해주세요:
    
    "${text}"
    
    주장만 JSON 배열 형식으로 반환해주세요. 각 주장은 다음 형식이어야 합니다:
    {
      "text": "주장 내용",
      "confidence": 신뢰도(0.0-1.0 사이 값),
      "category": "카테고리(정치/경제/사회/문화/과학/스포츠/기타 중 하나)"
    }
    `;
    
    const result = await model.generateContent(prompt);
    const response = result.response;
    const textResponse = response.text();
    
    // JSON 추출
    const jsonMatch = textResponse.match(/\[\s*\{.*\}\s*\]/s);
    if (jsonMatch) {
      try {
        const parsedClaims = JSON.parse(jsonMatch[0]);
        // 소스 정보 추가
        return parsedClaims.map(claim => ({
          ...claim,
          source: { type: 'TEXT' }
        }));
      } catch (parseError) {
        logger.error(`AI 응답 파싱 중 오류: ${parseError.message}`);
        return [];
      }
    }
    
    return [];
  } catch (error) {
    logger.error(`AI 분석 중 오류 발생: ${error.message}`);
    return [];
  }
}

/**
 * 음성을 텍스트로 변환하고 주장 추출
 * @param {Buffer} audioBuffer - 오디오 데이터
 * @returns {Promise<Object>} - 변환된 텍스트와 추출된 주장
 */
async function processAudioToText(audioBuffer) {
  try {
    // Google Speech-to-Text API를 직접 호출하는 대신 다른 메서드 사용
    // 실제 구현에서는 적절한 API 호출 필요
    
    // 임시로 더미 텍스트 반환
    const transcribedText = "이것은 음성 변환 텍스트의 예시입니다. 최근 연구에 따르면 전 세계 온도가 2도 상승했다고 합니다.";
    
    // 변환된 텍스트에서 주장 추출
    const claims = await extractClaimsFromText(transcribedText);
    
    return {
      text: transcribedText,
      claims: claims
    };
  } catch (error) {
    logger.error(`오디오 처리 중 오류 발생: ${error.message}`);
    return { text: "", claims: [] };
  }
}

/**
 * 비디오에서 주요 프레임을 추출하고 텍스트/오디오 처리
 * @param {string} videoUrl - 비디오 URL 또는 경로
 * @returns {Promise<Object>} - 처리 결과
 */
async function processVideo(videoUrl) {
  // 실제 구현에서는 비디오 프레임 추출 및 분석 로직 필요
  // 여기서는 간단한 예시만 제공
  
  try {
    // 더미 데이터 반환
    return {
      text: "비디오에서 추출한 텍스트 내용입니다.",
      claims: [
        {
          text: "비디오에서 발견된 주장 예시입니다.",
          confidence: 0.6,
          source: {
            type: 'VIDEO',
            url: videoUrl,
            timestamp: 45 // 비디오 시작 후 45초 지점
          }
        }
      ]
    };
  } catch (error) {
    logger.error(`비디오 처리 중 오류 발생: ${error.message}`);
    return { text: "", claims: [] };
  }
}

/**
 * 실시간 미디어 스트림 분석
 * @param {Object} options - 스트림 분석 옵션
 * @returns {Promise<Object>} - 스트림 분석 세션 정보
 */
async function processMediaStream(options) {
  const { 
    mediaUrl, 
    streamType = 'LIVE', 
    language = 'ko',
    sessionId = `stream_${Date.now()}`
  } = options;
  
  try {
    logger.info(`미디어 스트림 분석 시작 - 세션 ID: ${sessionId}`);
    
    // 분석 세션 상태 객체
    const sessionState = {
      id: sessionId,
      status: 'INITIALIZING',
      mediaUrl,
      streamType,
      language,
      startTime: new Date(),
      transcript: '',
      claims: [],
      progress: 0
    };
    
    // 여기서는 실제 스트림 프로세싱 로직이 아닌 개념적 구현만 제공
    // 실제 구현 시에는 스트림 연결, 청크 처리, 최적화 등이 필요
    
    // 실시간 처리를 백그라운드로 시작
    processStreamInBackground(sessionState);
    
    return {
      sessionId,
      status: 'STARTED',
      message: '미디어 스트림 분석이 시작되었습니다'
    };
  } catch (error) {
    logger.error(`미디어 스트림 분석 초기화 중 오류: ${error.message}`);
    throw new Error(`스트림 분석 초기화 실패: ${error.message}`);
  }
}

/**
 * 백그라운드에서 미디어 스트림 처리 (비동기)
 * @param {Object} sessionState - 스트림 세션 상태
 */
async function processStreamInBackground(sessionState) {
  try {
    // 1. 스트림 연결 설정
    sessionState.status = 'CONNECTING';
    sessionState.progress = 10;
    emitStreamProgress(sessionState);
    
    // 실제 구현에서는 여기서 스트림 연결
    await simulateDelay(1000);
    
    // 2. 스트림 처리 시작
    sessionState.status = 'PROCESSING';
    sessionState.progress = 20;
    emitStreamProgress(sessionState);
    
    // 실제 구현에서는 청크 단위 분석 수행
    const chunkCount = sessionState.streamType === 'LIVE' ? 5 : 10;
    
    for (let i = 0; i < chunkCount; i++) {
      // 청크 처리 시뮬레이션
      await simulateDelay(1000);
      
      // 트랜스크립트 및 주장 누적
      const chunkTranscript = generateSampleTranscript(i);
      sessionState.transcript += chunkTranscript;
      
      // 주장 추출
      const newClaims = await extractClaimsFromText(chunkTranscript);
      if (newClaims.length > 0) {
        sessionState.claims = [
          ...sessionState.claims,
          ...newClaims.map(claim => ({
            ...claim,
            timestamp: new Date().toISOString(),
            chunkIndex: i
          }))
        ];
        
        // 새 주장이 발견되면 이벤트 발송
        emitNewClaimsDetected(sessionState, newClaims);
      }
      
      // 진행 상황 업데이트
      sessionState.progress = 20 + Math.floor((i + 1) / chunkCount * 60);
      emitStreamProgress(sessionState);
    }
    
    // 3. 최종 분석 및 정리
    sessionState.status = 'FINALIZING';
    sessionState.progress = 90;
    emitStreamProgress(sessionState);
    
    await simulateDelay(1000);
    
    // 4. 분석 완료
    sessionState.status = 'COMPLETED';
    sessionState.progress = 100;
    emitStreamCompletion(sessionState);
    
    logger.info(`미디어 스트림 분석 완료 - 세션 ID: ${sessionState.id}`);
  } catch (error) {
    logger.error(`미디어 스트림 처리 중 오류: ${error.message}`);
    
    // 오류 상태 업데이트 및 이벤트 발송
    sessionState.status = 'ERROR';
    sessionState.error = error.message;
    emitStreamError(sessionState);
  }
}

/**
 * 샘플 트랜스크립트 생성 (테스트용)
 * @param {number} chunkIndex - 청크 인덱스
 * @returns {string} - 생성된 텍스트
 */
function generateSampleTranscript(chunkIndex) {
  const sampleTexts = [
    "최근 연구에 따르면 지구 온도가 지난 10년간 1도 상승했다고 합니다.",
    "정부는 내년부터 새로운 환경 정책을 시행할 예정이라고 발표했습니다.",
    "전문가들은 이번 조치가 경제에 부정적 영향을 미칠 것이라고 우려하고 있습니다.",
    "통계에 따르면 올해 실업률은 3.5%로 작년보다 0.5% 감소했습니다.",
    "연구진은 '새로운 백신이 코로나 변이에도 효과적'이라고 밝혔습니다."
  ];
  
  return sampleTexts[chunkIndex % sampleTexts.length];
}

/**
 * 스트림 진행 이벤트 발송
 * @param {Object} sessionState - 세션 상태
 */
function emitStreamProgress(sessionState) {
  // factChecker 모듈의 SSE 이벤트 발송 기능 활용
  const factChecker = require('./factChecker');
  
  factChecker.sendEventToAll({
    eventType: 'stream_analysis_progress',
    sessionId: sessionState.id,
    progress: sessionState.progress,
    status: sessionState.status,
    timestamp: new Date().toISOString()
  });
}

/**
 * 새로운 주장 감지 이벤트 발송
 * @param {Object} sessionState - 세션 상태
 * @param {Array} newClaims - 새로 감지된 주장들
 */
function emitNewClaimsDetected(sessionState, newClaims) {
  const factChecker = require('./factChecker');
  
  factChecker.sendEventToAll({
    eventType: 'stream_claims_detected',
    sessionId: sessionState.id,
    claims: newClaims,
    totalClaimsCount: sessionState.claims.length,
    timestamp: new Date().toISOString()
  });
}

/**
 * 스트림 완료 이벤트 발송
 * @param {Object} sessionState - 세션 상태
 */
function emitStreamCompletion(sessionState) {
  const factChecker = require('./factChecker');
  
  factChecker.sendEventToAll({
    eventType: 'stream_analysis_completed',
    sessionId: sessionState.id,
    result: {
      transcript: sessionState.transcript,
      claims: sessionState.claims,
      processingTime: Date.now() - sessionState.startTime.getTime()
    },
    timestamp: new Date().toISOString()
  });
}

/**
 * 스트림 오류 이벤트 발송
 * @param {Object} sessionState - 세션 상태
 */
function emitStreamError(sessionState) {
  const factChecker = require('./factChecker');
  
  factChecker.sendEventToAll({
    eventType: 'stream_analysis_error',
    sessionId: sessionState.id,
    error: sessionState.error,
    timestamp: new Date().toISOString()
  });
}

/**
 * 딜레이 시뮬레이션 (테스트용)
 * @param {number} ms - 밀리초
 * @returns {Promise<void>}
 */
async function simulateDelay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 구글 팩트체크 API를 사용하여 기존 팩트체크 결과 조회
 * @param {string} query - 검색할 주장 텍스트
 * @returns {Promise<Array>} - 팩트체크 결과 목록
 */
async function searchExistingFactChecks(query) {
  try {
    const response = await axios.get(`${config.api.googleFactCheck.apiUrl}/claims:search`, {
      params: {
        key: config.api.googleFactCheck.apiKey,
        query: query
      }
    });
    
    if (response.data && response.data.claims) {
      return response.data.claims;
    }
    return [];
  } catch (error) {
    logger.error(`기존 팩트체크 검색 중 오류: ${error.message}`);
    return [];
  }
}

module.exports = {
  extractClaimsFromText,
  processAudioToText,
  processVideo,
  searchExistingFactChecks,
  processMediaStream
}; 