/**
 * FactChecker 프레임 분석 서비스
 * Google AI Studio Stream Realtime API를 활용한 이미지 분석 및 주장 추출
 */

const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const tavily = require('tavily');
const claimDetection = require('./claimDetection');
const helpers = require('../utils/helpers');
const config = require('../config');

// Google Gemini API 설정
const googleAI = new GoogleGenerativeAI(config.apiKeys.googleAI);

// Tavily API 설정
const tavilyClient = new tavily.TavilyClient({ apiKey: config.apiKeys.tavily });

/**
 * 이미지를 분석하여 주장 추출
 * @param {string} imageData - Base64 인코딩된 이미지 데이터
 * @returns {Promise<{claims: Array, error: Error}>} 추출된 주장과 오류
 */
async function analyze(imageData) {
  try {
    // 작업 디렉토리 확인 및 생성
    const tempDir = path.join(__dirname, '../..', 'tmp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // 이미지 데이터 포맷 검증 및 정리
    if (!imageData.startsWith('data:image/')) {
      return { claims: [], error: new Error('Invalid image format') };
    }
    
    // 이미지를 임시 파일로 저장
    const imageFileName = `frame_${uuidv4()}.jpg`;
    const imagePath = path.join(tempDir, imageFileName);
    
    // Base64 이미지 데이터에서 헤더 제거 및 파일로 저장
    const base64Data = imageData.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(imagePath, Buffer.from(base64Data, 'base64'));
    
    // 이미지에서 텍스트 추출
    let extractedText;
    try {
      extractedText = await extractTextFromImage(imagePath);
      console.log('이미지에서 추출된 텍스트:', extractedText);
    } catch (textExtractionError) {
      console.error('이미지 텍스트 추출 오류:', textExtractionError.message);
      // 텍스트 추출 실패 시 빈 텍스트로 처리
      extractedText = '';
    }
    
    // 텍스트가 없거나 너무 짧으면 빈 결과 반환
    if (!extractedText || extractedText.length < 10) {
      // 임시 파일 삭제
      try { fs.unlinkSync(imagePath); } catch (e) {}
      return { claims: [], error: null };
    }
    
    // 텍스트에서 주장 추출
    let claims = [];
    try {
      claims = await extractClaimsFromText(extractedText);
    } catch (claimExtractionError) {
      console.error('AI를 통한 주장 추출 오류:', claimExtractionError.message);
      // API 오류 시 간단한 규칙 기반 추출 시도
      claims = fallbackClaimExtraction(extractedText);
    }
    
    // 주장이 있으면 검색 정보 보강
    if (claims.length > 0) {
      try {
        claims = await enrichClaimsWithSearchInfo(claims);
      } catch (searchError) {
        console.error('주장 검색 정보 추가 오류:', searchError);
        // 검색 정보 없이 진행
      }
    }
    
    // 임시 파일 삭제
    try { fs.unlinkSync(imagePath); } catch (e) {}
    
    return { claims, error: null };
  } catch (error) {
    console.error('이미지 분석 오류:', error);
    return { claims: [], error };
  }
}

/**
 * API 실패 시 사용할 기본 주장 추출 함수
 * @param {string} text - 추출된 텍스트
 * @returns {Array} 주장 목록
 */
function fallbackClaimExtraction(text) {
  const claims = [];
  
  // 특정 패턴을 가진 문장만 추출 (마침표로 끝나는 15자 이상 문장)
  const sentences = text.split(/[.!?]/)
    .map(s => s.trim())
    .filter(s => s.length >= 15);
  
  for (const sentence of sentences) {
    // 주장성 키워드 포함 확인
    const claimKeywords = ['이다', '것이다', '입니다', '했다', '라고', '주장', '발표'];
    const isClaimLike = claimKeywords.some(keyword => sentence.includes(keyword));
    
    if (isClaimLike) {
      claims.push({
        text: sentence,
        confidence: 0.6,
        sources: [],
        entities: []
      });
    }
  }
  
  // 최대 3개만 반환
  return claims.slice(0, 3);
}

/**
 * 이미지에서 텍스트 추출
 * @param {string} imagePath - 이미지 경로
 * @returns {Promise<string>} 추출된 텍스트
 */
async function extractTextFromImage(imagePath) {
  try {
    // Google Gemini 1.5 Flash 모델 사용 (Pro 대신)
    const model = googleAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    // 이미지 파일을 읽고 바이너리 데이터로 변환
    const imageData = fs.readFileSync(imagePath);
    
    // 이미지를 MIME 타입으로 변환
    const imageBase64 = imageData.toString('base64');
    const mimeType = 'image/jpeg';
    
    // 이미지 프롬프트 생성
    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType
      }
    };
    
    // 프롬프트 작성
    const prompt = "이 이미지에서 모든 텍스트를 추출해서 원본 형식 그대로 반환해주세요. 추가 설명이나 주석 없이 텍스트만 반환합니다.";
    
    // API 요청으로 텍스트 추출
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    const text = response.text();
    
    return text.trim();
  } catch (error) {
    console.error('텍스트 추출 오류:', error);
    throw error;
  }
}

/**
 * 텍스트에서 주장 추출
 * @param {string} text - 추출할 텍스트
 * @returns {Promise<Array>} 추출된 주장 배열
 */
async function extractClaimsFromText(text) {
  try {
    // claimDetection 서비스의 기능 활용
    const { claims } = await claimDetection.detectClaims(text);
    return claims;
  } catch (error) {
    console.error('텍스트에서 주장 추출 오류:', error);
    return [];
  }
}

/**
 * 주장에 검색 정보 추가
 * @param {Array} claims - 주장 배열
 * @returns {Promise<Array>} 검색 정보가 추가된 주장 배열
 */
async function enrichClaimsWithSearchInfo(claims) {
  try {
    // 각 주장에 대해 병렬로 검색 정보 추가
    const enrichedClaims = await Promise.all(
      claims.map(async (claim) => {
        try {
          // Tavily API를 사용하여 관련 정보 검색
          const searchResponse = await tavily.search({
            query: claim.text,
            search_depth: 'basic',
            include_domains: ['news.com', 'wikipedia.org', 'gov.org', 'edu'],
            max_results: 3
          });

          // 검색 결과를 주장에 추가
          return {
            ...claim,
            sources: searchResponse.results.map(result => ({
              title: result.title,
              url: result.url,
              content: result.content
            }))
          };
        } catch (error) {
          console.warn(`주장 검색 정보 추가 실패 (${claim.text}):`, error);
          return claim;
        }
      })
    );

    return enrichedClaims;
  } catch (error) {
    console.error('주장 검색 정보 추가 오류:', error);
    return claims;
  }
}

/**
 * 뉴스 콘텐츠에서 주장 추출
 * @param {string} content - 뉴스 기사 내용
 * @returns {Promise<Array<string>>} - 추출된 주장들의 배열
 */
async function extractClaims(content) {
  try {
    // 텍스트 길이 제한
    const maxContentLength = 5000;
    const truncatedContent = content.length > maxContentLength ? 
      content.substring(0, maxContentLength) + '...' : content;
    
    // Gemini 모델을 사용하여 주요 주장 추출
    const geminiResponse = await googleAI.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent(`
      **분석 대상 뉴스 기사**:
      "${truncatedContent}"
      
      **작업 지시사항**:
      1. 위 뉴스 기사에서 검증 가능한 주요 사실적 주장을 최대 3개 추출하세요.
      2. 추출한 주장은 사실 여부를 검증할 수 있는 명확한 형태여야 합니다.
      3. 각 주장은 한 문장으로 간결하게 정리해주세요. 
      4. 가장 중요하고 논쟁의 여지가 있는 주장부터 순서대로 정렬해주세요.
      5. 주장을 "1. 주장내용" 형태로 번호를 붙여 나열해주세요.

      **주의사항**:
      - 의견이나 감정 표현이 아닌 사실 검증이 가능한 주장만 추출하세요.
      - 주장은 각각 별개의 독립적인 내용이어야 합니다.
      - 너무 모호하거나 광범위한 주장은 피하세요.
    `);
    
    if (!geminiResponse || !geminiResponse.response || !geminiResponse.response.text()) {
      console.error('Gemini 응답 없음');
      return [];
    }
    
    const response = geminiResponse.response.text();
    
    // 정규식을 사용하여 번호가 매겨진 주장 추출
    const claimsRegex = /\d+\.\s+(.+)/g;
    const matches = [...response.matchAll(claimsRegex)];
    
    // 주장 텍스트만 배열로 변환
    const claims = matches.map(match => match[1].trim());
    
    console.log(`추출된 주장: ${claims.length}개`);
    return claims;
  } catch (error) {
    console.error('주장 추출 중 오류 발생:', error);
    return [];
  }
}

/**
 * 뉴스 내용의 주장 검증
 * @param {string} claim - 검증할 주장
 * @param {string} content - 뉴스 내용 전체
 * @param {string} sourceUrl - 뉴스 소스 URL
 * @returns {Promise<Object>} - 검증 결과
 */
async function verifyNewsContent(claim, content, sourceUrl) {
  try {
    // 소스 URL이 없는 경우 기본값 설정
    const url = sourceUrl || 'unknown-source';
    
    // 검색 쿼리 준비 (주장을 기반으로 관련 정보 검색)
    const searchQuery = `팩트체크: ${claim}`;
    
    // Tavily 검색 수행
    const searchResults = await tavilyClient.search({
      query: searchQuery,
      search_depth: "advanced",
      include_domains: [
        "factcheck.org", "politifact.com", "snopes.com", "reuters.com", 
        "bbc.com", "apnews.com", "factcheck.snu.ac.kr", "newstapa.org",
        "news.sbs.co.kr/factcheck", "news.jtbc.joins.com/factcheck",
        "ytn.co.kr", "newneek.co", "pressian.com"
      ],
      max_results: 5
    });
    
    // 검색 결과 컨텍스트 구성
    let searchContext = '';
    if (searchResults && searchResults.results && searchResults.results.length > 0) {
      searchContext = searchResults.results
        .map((result, idx) => `[출처 ${idx + 1}] ${result.title}\n${result.content}\n출처 URL: ${result.url}`)
        .join('\n\n');
    } else {
      searchContext = '관련 검색 결과가 없습니다.';
    }
    
    // Gemini 모델을 사용하여 검증 수행
    const geminiPrompt = `
      **팩트체크 요청**
      
      **검증할 주장**:
      "${claim}"
      
      **뉴스 기사 내용**:
      "${content.substring(0, 2000)}${content.length > 2000 ? '...' : ''}"
      
      **관련 검색 결과**:
      ${searchContext}
      
      **작업 지시사항**:
      주장을 검증하고 아래 형식의 JSON 객체로 응답해주세요:
      
      {
        "verdict": "사실" | "부분적 사실" | "허위" | "검증 불가",
        "truth_score": 0부터 1 사이의 숫자(정확도 점수),
        "explanation": "검증 결과에 대한 설명",
        "sources": [
          {
            "title": "출처 제목",
            "url": "출처 URL"
          }
        ]
      }
      
      **검증 가이드라인**:
      1. 검증에 필요한 객관적 증거와 신뢰할 수 있는 출처를 활용하세요.
      2. 검색 결과와 기사 내용을 종합적으로 분석하세요.
      3. 확인된 사실과 확인되지 않은 부분을 명확히 구분하세요.
      4. 진실 점수(truth_score)는 주장의 정확성을 0(완전 허위)에서 1(완전 사실) 사이로 평가하세요.
      
      JSON만 응답해주세요.
    `;
    
    const geminiResponse = await googleAI.getGenerativeModel({ model: "gemini-1.5-flash" }).generateContent(geminiPrompt);
    
    if (!geminiResponse || !geminiResponse.response || !geminiResponse.response.text()) {
      throw new Error('Gemini 응답 없음');
    }
    
    let verificationResult;
    try {
      // JSON 응답 파싱
      const responseText = geminiResponse.response.text();
      
      // JSON 부분만 추출 (모델이 때때로 추가 텍스트를 생성할 수 있음)
      const jsonMatch = responseText.match(/(\{[\s\S]*\})/);
      const jsonString = jsonMatch ? jsonMatch[1] : responseText;
      
      verificationResult = JSON.parse(jsonString);
    } catch (parseError) {
      console.error('JSON 파싱 오류:', parseError);
      // 기본 결과 반환
      verificationResult = {
        verdict: '검증 불가',
        truth_score: 0.5,
        explanation: '결과 처리 중 오류가 발생했습니다.',
        sources: []
      };
    }
    
    return verificationResult;
  } catch (error) {
    console.error('뉴스 검증 중 오류 발생:', error);
    return {
      verdict: '검증 불가',
      truth_score: 0.5,
      explanation: `검증 중 오류: ${error.message}`,
      sources: []
    };
  }
}

/**
 * 주장 저장 함수
 * @param {Object} claim - 저장할 주장 정보
 * @returns {Promise<Object>} - 저장된 주장 정보
 */
async function saveClaim(claim) {
  try {
    // 주장 데이터 검증
    if (!claim || !claim.text) {
      throw new Error('유효하지 않은 주장 데이터');
    }
    
    // MongoDB 모델이 없으므로 메모리에 저장
    // 실제 구현에서는 MongoDB 모델을 사용할 수 있습니다
    const savedClaim = {
      id: uuidv4(),
      text: claim.text,
      context: claim.context || '',
      source: claim.source || {},
      verification: claim.verification || {},
      createdAt: new Date()
    };
    
    console.log('주장이 저장되었습니다:', savedClaim.id);
    return savedClaim;
  } catch (error) {
    console.error('주장 저장 오류:', error);
    throw error;
  }
}

/**
 * 저장된 주장 조회 함수
 * @param {string} id - 주장 ID
 * @returns {Promise<Array>} - 저장된 주장들
 */
async function getClaims(id) {
  try {
    // 메모리에서 검색 (실제 구현에서는 MongoDB 사용)
    // 예제 데이터 반환
    return [
      {
        id: uuidv4(),
        text: '샘플 주장 데이터입니다',
        verification: {
          verdict: '검증 중',
          truth_score: 0.5
        },
        createdAt: new Date()
      }
    ];
  } catch (error) {
    console.error('주장 조회 오류:', error);
    throw error;
  }
}

module.exports = {
  analyze,
  extractClaims,
  verifyNewsContent,
  saveClaim,
  getClaims
}; 