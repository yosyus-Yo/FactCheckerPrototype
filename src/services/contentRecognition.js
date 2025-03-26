/**
 * 콘텐츠 인식 모듈
 * 다양한 미디어 소스(텍스트, 오디오, 비디오)에서 주장을 인식하고 추출하는 기능을 제공합니다.
 */
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const logger = require('../utils/logger');
const { claimPatterns } = require('../utils/helpers');
const config = require('../config');
const cheerio = require('cheerio');
const { cleanUrl, sanitizeHtml } = require('../utils/helpers');

// 환경변수에서 모델명 가져오기
const GEMINI_MODEL = process.env.GOOGLE_AI_MODEL || "gemini-2.0-flash";

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
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
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

/**
 * 콘텐츠 분석 (AI 활용)
 * @param {Object} content 추출된 콘텐츠 객체
 * @returns {Promise<Object>} 분석 결과
 */
async function analyzeContent(content) {
  try {
    // 텍스트가 너무 짧은 경우 분석 스킵
    if (!content.textContent || content.textContent.length < 100) {
      return {
        summary: content.description || '콘텐츠가 충분하지 않습니다.',
        topics: [],
        contentType: 'unknown',
        language: 'unknown'
      };
    }
    
    // 요약 생성
    const summary = await generateSummary(content.textContent);
    
    // 주제어 추출
    const topics = await extractTopics(content.textContent);
    
    // 콘텐츠 유형 분류
    const contentType = await classifyContentType(content.textContent);
    
    // 언어 감지
    const language = detectLanguage(content.textContent);
    
    return {
      summary,
      topics,
      contentType,
      language
    };
  } catch (error) {
    logger.error(`콘텐츠 분석 오류: ${error.message}`);
    return {
      summary: content.description || '내용 요약을 생성할 수 없습니다.',
      topics: [],
      contentType: 'unknown',
      language: 'unknown'
    };
  }
}

/**
 * AI를 사용하여 콘텐츠 요약 생성
 * @param {string} text 원본 텍스트
 * @returns {Promise<string>} 요약된 텍스트
 */
async function generateSummary(text) {
  try {
    // 텍스트가 너무 길면 잘라내기
    const truncatedText = text.length > 15000 ? text.substring(0, 15000) + '...' : text;
    
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    const prompt = `다음 텍스트의 주요 내용을 3-5문장으로 요약해주세요:
    
    "${truncatedText}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    logger.error(`요약 생성 오류: ${error.message}`);
    return '요약을 생성할 수 없습니다.';
  }
}

/**
 * AI를 사용하여 주제어 추출
 * @param {string} text 원본 텍스트
 * @returns {Promise<Array>} 주제어 목록
 */
async function extractTopics(text) {
  try {
    // 텍스트가 너무 길면 잘라내기
    const truncatedText = text.length > 10000 ? text.substring(0, 10000) + '...' : text;
    
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    const prompt = `다음 텍스트의 주요 주제어를 5개 이하의 키워드로 추출해주세요.
    키워드만 쉼표로 구분하여 응답해주세요:
    
    "${truncatedText}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // 응답에서 키워드 추출
    const topicsText = response.text().trim();
    return topicsText.split(/,\s*/).filter(t => t.length > 0).slice(0, 5);
  } catch (error) {
    logger.error(`주제어 추출 오류: ${error.message}`);
    return [];
  }
}

/**
 * AI를 사용하여 콘텐츠 유형 분류
 * @param {string} text 원본 텍스트
 * @returns {Promise<string>} 콘텐츠 유형
 */
async function classifyContentType(text) {
  try {
    // 텍스트가 너무 길면 잘라내기
    const truncatedText = text.length > 5000 ? text.substring(0, 5000) + '...' : text;
    
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    
    const prompt = `다음 텍스트의 콘텐츠 유형을 다음 카테고리 중 하나로 분류해주세요:
    - news (뉴스 기사)
    - blog (블로그 포스트)
    - academic (학술 자료)
    - product (제품 설명)
    - review (리뷰)
    - opinion (의견/칼럼)
    - social (소셜 미디어 글)
    - other (기타)
    
    카테고리만 단일 단어로 응답해주세요:
    
    "${truncatedText}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // 응답에서 콘텐츠 유형 추출
    const contentType = response.text().trim().toLowerCase();
    
    // 허용된 콘텐츠 유형만 반환
    const allowedTypes = ['news', 'blog', 'academic', 'product', 'review', 'opinion', 'social'];
    return allowedTypes.includes(contentType) ? contentType : 'other';
  } catch (error) {
    logger.error(`콘텐츠 유형 분류 오류: ${error.message}`);
    return 'unknown';
  }
}

/**
 * 텍스트의 언어 감지
 * @param {string} text 원본 텍스트
 * @returns {string} 감지된 언어 코드
 */
function detectLanguage(text) {
  try {
    // 간단한 언어 감지 방법 (한글, 영어, 일본어, 중국어 구분)
    const sample = text.substring(0, 500);
    
    // 한글 비율 확인
    const koreanChars = sample.match(/[가-힣]/g) || [];
    const koreanRatio = koreanChars.length / sample.length;
    
    // 영어 비율 확인
    const englishChars = sample.match(/[a-zA-Z]/g) || [];
    const englishRatio = englishChars.length / sample.length;
    
    // 일본어 비율 확인 (히라가나, 가타카나)
    const japaneseChars = sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
    const japaneseRatio = japaneseChars.length / sample.length;
    
    // 중국어 비율 확인
    const chineseChars = sample.match(/[\u4E00-\u9FFF]/g) || [];
    const chineseRatio = chineseChars.length / sample.length;
    
    // 비율에 따라 언어 결정
    if (koreanRatio > 0.15) return 'ko';
    if (japaneseRatio > 0.15) return 'ja';
    if (chineseRatio > 0.15) return 'zh';
    if (englishRatio > 0.15) return 'en';
    
    return 'unknown';
  } catch (error) {
    logger.error(`언어 감지 오류: ${error.message}`);
    return 'unknown';
  }
}

/**
 * URL 유효성 검증
 * @param {string} url 검증할 URL
 * @returns {boolean} 유효성 여부
 */
function isValidUrl(url) {
  try {
    const pattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
    return pattern.test(url) || url.startsWith('http://localhost');
  } catch (error) {
    return false;
  }
}

/**
 * 텍스트 및 미디어 콘텐츠를 인식하고 분류하는 서비스
 */
class ContentRecognitionService {
  constructor() {
    // 기본 설정 초기화
    this.axiosConfig = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 15000, // 15초 타임아웃
      maxRedirects: 5  // 최대 리다이렉트 횟수
    };
    
    logger.info(`ContentRecognitionService 초기화 완료 (모델: ${GEMINI_MODEL})`);
  }

  /**
   * URL에서 미디어 콘텐츠 추출
   * @param {string} url 웹 페이지 URL
   * @returns {Promise<Object>} 추출된 콘텐츠 객체
   */
  async extractFromUrl(url) {
    try {
      const cleanedUrl = cleanUrl(url);
      
      // URL 유효성 검증
      if (!this.isValidUrl(cleanedUrl)) {
        throw new Error('유효하지 않은 URL 형식입니다.');
      }
      
      logger.info(`콘텐츠 추출 시작: ${cleanedUrl}`);
      
      // 웹 페이지 HTML 가져오기
      const { data: html } = await axios.get(cleanedUrl, this.axiosConfig);
      
      // HTML에서 주요 콘텐츠 추출
      const extractedContent = this.extractContentFromHtml(html, cleanedUrl);
      
      // 콘텐츠 유형 및 메타데이터 분석
      const analyzedContent = await this.analyzeContent(extractedContent);
      
      return {
        success: true,
        url: cleanedUrl,
        ...extractedContent,
        ...analyzedContent
      };
    } catch (error) {
      logger.error(`콘텐츠 추출 오류 (${url}): ${error.message}`);
      return {
        success: false,
        url: url,
        error: error.message
      };
    }
  }

  /**
   * HTML에서 주요 콘텐츠 추출
   * @param {string} html HTML 문자열
   * @param {string} url 원본 URL
   * @returns {Object} 추출된 콘텐츠 객체
   */
  extractContentFromHtml(html, url) {
    try {
      const $ = cheerio.load(html);
      
      // 페이지 기본 정보 추출
      const title = $('title').text().trim() || $('h1').first().text().trim() || '';
      const description = $('meta[name="description"]').attr('content') || '';
      const ogImage = $('meta[property="og:image"]').attr('content') || '';
      const author = $('meta[name="author"]').attr('content') || $('meta[property="article:author"]').attr('content') || '';
      const publishedDate = $('meta[property="article:published_time"]').attr('content') || '';
      
      // 주요 콘텐츠 영역 찾기
      let mainContent = '';
      let textContent = '';
      
      // 뉴스 기사 구조 우선 확인 (schema.org 마크업 활용)
      const articleBody = $('[itemprop="articleBody"]').text() || $('article').text() || '';
      
      if (articleBody.length > 200) {
        mainContent = articleBody;
      } else {
        // 일반적인 콘텐츠 선택자 시도
        const contentSelectors = [
          'article', '.article', '.post', '.content', '.entry-content',
          '.post-content', '.story', '.news-content', '#content', '#main',
          '.main', 'main', '.container', '#container'
        ];
        
        for (const selector of contentSelectors) {
          const content = $(selector).text();
          if (content && content.length > mainContent.length) {
            mainContent = content;
          }
        }
        
        // 선택자로 찾지 못한 경우 본문 영역 추정
        if (mainContent.length < 200) {
          // p 태그 내용 모두 합치기
          const paragraphs = $('p').map((i, el) => $(el).text().trim()).get();
          textContent = paragraphs.join('\n\n');
          
          if (textContent.length > 200) {
            mainContent = textContent;
          } else {
            // 최후의 수단: body 전체 텍스트 (불필요한 요소 제외)
            $('header, footer, nav, aside, script, style, .header, .footer, .nav, .menu, .sidebar, .ad, .advertisement, .banner').remove();
            mainContent = $('body').text();
          }
        }
      }
      
      // 텍스트 정리
      mainContent = sanitizeHtml(mainContent)
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();
      
      // 이미지 URL 추출
      const images = [];
      $('img').each((i, img) => {
        const src = $(img).attr('src') || $(img).attr('data-src');
        const alt = $(img).attr('alt') || '';
        
        if (src && !src.includes('data:image') && !src.includes('pixel.gif')) {
          // 상대 URL을 절대 URL로 변환
          const imageUrl = src.startsWith('http') ? src : new URL(src, url).href;
          images.push({ url: imageUrl, alt });
        }
      });
      
      return {
        title,
        description,
        mainContent,
        textContent: textContent || mainContent,
        images,
        metadata: {
          author,
          publishedDate,
          ogImage,
          url
        }
      };
    } catch (error) {
      logger.error(`HTML 파싱 오류: ${error.message}`);
      return {
        title: '',
        description: '',
        mainContent: '',
        textContent: '',
        images: [],
        metadata: { url }
      };
    }
  }

  /**
   * 콘텐츠 분석 (AI 활용)
   * @param {Object} content 추출된 콘텐츠 객체
   * @returns {Promise<Object>} 분석 결과
   */
  async analyzeContent(content) {
    try {
      // 텍스트가 너무 짧은 경우 분석 스킵
      if (!content.textContent || content.textContent.length < 100) {
        return {
          summary: content.description || '콘텐츠가 충분하지 않습니다.',
          topics: [],
          contentType: 'unknown',
          language: 'unknown'
        };
      }
      
      // 요약 생성
      const summary = await this.generateSummary(content.textContent);
      
      // 주제어 추출
      const topics = await this.extractTopics(content.textContent);
      
      // 콘텐츠 유형 분류
      const contentType = await this.classifyContentType(content.textContent);
      
      // 언어 감지
      const language = this.detectLanguage(content.textContent);
      
      return {
        summary,
        topics,
        contentType,
        language
      };
    } catch (error) {
      logger.error(`콘텐츠 분석 오류: ${error.message}`);
      return {
        summary: content.description || '내용 요약을 생성할 수 없습니다.',
        topics: [],
        contentType: 'unknown',
        language: 'unknown'
      };
    }
  }

  /**
   * AI를 사용하여 콘텐츠 요약 생성
   * @param {string} text 원본 텍스트
   * @returns {Promise<string>} 요약된 텍스트
   */
  async generateSummary(text) {
    try {
      // 텍스트가 너무 길면 잘라내기
      const truncatedText = text.length > 15000 ? text.substring(0, 15000) + '...' : text;
      
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      
      const prompt = `다음 텍스트의 주요 내용을 3-5문장으로 요약해주세요:
      
      "${truncatedText}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      logger.error(`요약 생성 오류: ${error.message}`);
      return '요약을 생성할 수 없습니다.';
    }
  }

  /**
   * AI를 사용하여 주제어 추출
   * @param {string} text 원본 텍스트
   * @returns {Promise<Array>} 주제어 목록
   */
  async extractTopics(text) {
    try {
      // 텍스트가 너무 길면 잘라내기
      const truncatedText = text.length > 10000 ? text.substring(0, 10000) + '...' : text;
      
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      
      const prompt = `다음 텍스트의 주요 주제어를 5개 이하의 키워드로 추출해주세요.
      키워드만 쉼표로 구분하여 응답해주세요:
      
      "${truncatedText}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      // 응답에서 키워드 추출
      const topicsText = response.text().trim();
      return topicsText.split(/,\s*/).filter(t => t.length > 0).slice(0, 5);
    } catch (error) {
      logger.error(`주제어 추출 오류: ${error.message}`);
      return [];
    }
  }

  /**
   * AI를 사용하여 콘텐츠 유형 분류
   * @param {string} text 원본 텍스트
   * @returns {Promise<string>} 콘텐츠 유형
   */
  async classifyContentType(text) {
    try {
      // 텍스트가 너무 길면 잘라내기
      const truncatedText = text.length > 5000 ? text.substring(0, 5000) + '...' : text;
      
      const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
      
      const prompt = `다음 텍스트의 콘텐츠 유형을 다음 카테고리 중 하나로 분류해주세요:
      - news (뉴스 기사)
      - blog (블로그 포스트)
      - academic (학술 자료)
      - product (제품 설명)
      - review (리뷰)
      - opinion (의견/칼럼)
      - social (소셜 미디어 글)
      - other (기타)
      
      카테고리만 단일 단어로 응답해주세요:
      
      "${truncatedText}"`;
      
      const result = await model.generateContent(prompt);
      const response = await result.response;
      
      // 응답에서 콘텐츠 유형 추출
      const contentType = response.text().trim().toLowerCase();
      
      // 허용된 콘텐츠 유형만 반환
      const allowedTypes = ['news', 'blog', 'academic', 'product', 'review', 'opinion', 'social'];
      return allowedTypes.includes(contentType) ? contentType : 'other';
    } catch (error) {
      logger.error(`콘텐츠 유형 분류 오류: ${error.message}`);
      return 'unknown';
    }
  }

  /**
   * 텍스트의 언어 감지
   * @param {string} text 원본 텍스트
   * @returns {string} 감지된 언어 코드
   */
  detectLanguage(text) {
    try {
      // 간단한 언어 감지 방법 (한글, 영어, 일본어, 중국어 구분)
      const sample = text.substring(0, 500);
      
      // 한글 비율 확인
      const koreanChars = sample.match(/[가-힣]/g) || [];
      const koreanRatio = koreanChars.length / sample.length;
      
      // 영어 비율 확인
      const englishChars = sample.match(/[a-zA-Z]/g) || [];
      const englishRatio = englishChars.length / sample.length;
      
      // 일본어 비율 확인 (히라가나, 가타카나)
      const japaneseChars = sample.match(/[\u3040-\u309F\u30A0-\u30FF]/g) || [];
      const japaneseRatio = japaneseChars.length / sample.length;
      
      // 중국어 비율 확인
      const chineseChars = sample.match(/[\u4E00-\u9FFF]/g) || [];
      const chineseRatio = chineseChars.length / sample.length;
      
      // 비율에 따라 언어 결정
      if (koreanRatio > 0.15) return 'ko';
      if (japaneseRatio > 0.15) return 'ja';
      if (chineseRatio > 0.15) return 'zh';
      if (englishRatio > 0.15) return 'en';
      
      return 'unknown';
    } catch (error) {
      logger.error(`언어 감지 오류: ${error.message}`);
      return 'unknown';
    }
  }

  /**
   * URL 유효성 검증
   * @param {string} url 검증할 URL
   * @returns {boolean} 유효성 여부
   */
  isValidUrl(url) {
    try {
      const pattern = /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([/\w .-]*)*\/?$/;
      return pattern.test(url) || url.startsWith('http://localhost');
    } catch (error) {
      return false;
    }
  }
}

module.exports = {
  extractClaimsFromText,
  processAudioToText,
  processVideo,
  searchExistingFactChecks,
  processMediaStream,
  ContentRecognitionService
}; 