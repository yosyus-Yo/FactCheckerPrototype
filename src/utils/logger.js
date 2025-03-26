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

module.exports = logger; 