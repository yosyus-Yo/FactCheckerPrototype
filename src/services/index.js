/**
 * 서비스 모듈 인덱스
 * 모든 서비스 모듈을 내보냅니다.
 */

// 팩트체킹 관련 서비스
const factChecker = require('./factChecker');
const factCheckerIntegration = require('./factCheckerIntegration');

// 미디어 콘텐츠 인식 관련 서비스
const contentRecognition = require('./contentRecognition');

// 주장 감지 관련 서비스
const claimDetection = require('./claimDetection');

// AR 시각화 관련 서비스
const arVisualization = require('./arVisualization');

// 성능 모니터링 서비스
const performanceMonitor = require('./performanceMonitor');

// 프레임 분석 서비스
const frameAnalysis = require('./frameAnalysis');

// 유틸리티 모듈
const utils = {
  helpers: require('../utils/helpers'),
  logger: require('../utils/logger')
};

module.exports = {
  // 팩트체킹 서비스
  factChecker,
  factCheckerIntegration,
  
  // 콘텐츠 인식 서비스
  contentRecognition,
  
  // 주장 감지 서비스
  claimDetection,
  
  // AR 시각화 서비스
  arVisualization,
  
  // 성능 모니터링 서비스
  performanceMonitor,
  
  // 프레임 분석 서비스
  frameAnalysis,
  
  // 유틸리티 모듈
  utils
}; 