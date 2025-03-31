const winston = require('winston');

// 커스텀 로그 포맷 정의
const customFormat = winston.format.printf(({ level, message, timestamp, service, ...metadata }) => {
  let metaStr = '';
  if (Object.keys(metadata).length > 0 && metadata.stack === undefined) {
    metaStr = JSON.stringify(metadata);
  }
  
  return `${timestamp} [${level.toUpperCase()}] ${service ? `[${service}] ` : ''}${message} ${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp', 'service'] })
  ),
  defaultMeta: { service: 'factchecker' },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      format: winston.format.combine(
        winston.format.json()
      )
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.json()
      )
    })
  ]
});

// 콘솔 로그 형식 설정
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      customFormat
    )
  }));
}

// 추가 로그 헬퍼 함수
logger.logContentExtraction = function(url, success, title, contentLength, error) {
  const logData = {
    url,
    success,
    contentLength: contentLength || 0,
    titleLength: title ? title.length : 0
  };
  
  if (error) {
    logData.error = error.message || error;
    this.warn(`콘텐츠 추출 실패: ${url}`, logData);
  } else if (success) {
    this.info(`콘텐츠 추출 성공: ${url}`, logData);
  }
};

logger.logVerification = function(url, trustScore, verifiedClaims) {
  const claimsCount = verifiedClaims ? verifiedClaims.length : 0;
  
  this.info(`콘텐츠 검증 완료: ${url}`, {
    trustScore: trustScore,
    claimsCount: claimsCount
  });
};

// 폴더가 없으면 생성
const fs = require('fs');
const path = require('path');
const logDir = 'logs';

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

/**
 * 요약 텍스트에서 핵심 키워드를 추출하여 로그로 출력
 * @param {string} summary - 요약 텍스트
 * @param {Object} options - 추가 옵션
 * @param {number} options.keywordCount - 추출할 키워드 수 (기본값: 5)
 * @param {string} options.source - 요약 소스 (기본값: 'unknown')
 */
logger.logKeywords = function(summary, options = {}) {
  const { keywordCount = 5, source = 'unknown' } = options;
  
  if (!summary || typeof summary !== 'string') {
    this.warn('요약 텍스트가 제공되지 않았거나 문자열이 아닙니다.');
    return;
  }
  
  try {
    // 불용어 목록 (한국어)
    const stopwords = [
      '이', '그', '저', '것', '이것', '저것', '그것', '는', '은', '이런', '저런', '그런',
      '에', '에서', '을', '를', '와', '과', '의', '로', '으로', '에게', '뿐', '다', '이다',
      '및', '또는', '혹은', '또한', '그리고', '하지만', '그러나', '왜냐하면', '때문에',
      '있다', '없다', '있는', '없는', '되다', '하다', '이', '그', '저'
    ];
    
    // 문자열 전처리
    const cleanText = summary
      .replace(/[^\w\s가-힣]/g, ' ')  // 특수문자 제거
      .replace(/\s+/g, ' ')          // 연속된 공백을 하나로
      .trim()
      .toLowerCase();
    
    // 단어 분할 및 필터링
    const words = cleanText.split(' ')
      .filter(word => word.length > 1)  // 2글자 이상만
      .filter(word => !stopwords.includes(word));  // 불용어 제거
    
    // 단어 빈도 계산
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    // 빈도 기준으로 정렬하여 상위 N개 추출
    const keywords = Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, keywordCount)
      .map(entry => entry[0]);
    
    // 핵심 키워드 로그 출력
    this.info(`핵심 키워드 추출 [${source}]`, { 
      keywords,
      summary_length: summary.length,
      source
    });
    
    return keywords;
  } catch (error) {
    this.error(`키워드 추출 중 오류 발생: ${error.message}`, { error });
    return [];
  }
};

module.exports = logger; 