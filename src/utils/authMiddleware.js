/**
 * 인증 미들웨어
 * API 요청에 대한 인증을 처리합니다.
 */
const logger = require('./logger');

// 환경 변수에서 API 키 가져오기 (없으면 기본값 사용)
const API_KEY = process.env.API_KEY || 'factchecker-dev-key';

// 환경 설정
const NODE_ENV = process.env.NODE_ENV || 'development';

/**
 * 인증 미들웨어 함수
 * 
 * @param {Object} req - Express 요청 객체
 * @param {Object} res - Express 응답 객체
 * @param {Function} next - 다음 미들웨어 호출 함수
 */
const authMiddleware = (req, res, next) => {
  // 개발 환경에서는 인증을 우회
  if (NODE_ENV === 'development') {
    logger.debug('개발 환경에서 인증 우회됨');
    return next();
  }

  try {
    // 요청 헤더에서 API 키 확인
    const apiKey = req.headers['x-api-key'] || req.query.apiKey;

    // API 키가 없거나 일치하지 않는 경우
    if (!apiKey || apiKey !== API_KEY) {
      logger.warn(`인증 실패: 유효하지 않은 API 키 (IP: ${req.ip})`);
      return res.status(401).json({
        success: false,
        message: '인증에 실패했습니다. 유효한 API 키가 필요합니다.'
      });
    }

    // 인증 성공
    logger.debug(`인증 성공: ${req.method} ${req.path}`);
    next();
  } catch (error) {
    logger.error(`인증 처리 중 오류: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: '인증 처리 중 오류가 발생했습니다.'
    });
  }
};

module.exports = authMiddleware; 