/**
 * 성능 모니터링 서비스
 * 
 * 애플리케이션의 성능 지표를 수집, 분석하고 모니터링합니다.
 */
const os = require('os');
const { performance } = require('perf_hooks');
const logger = require('../utils/logger');
const config = require('../config');

// 성능 지표 수집 주기 (밀리초)
const METRICS_COLLECTION_INTERVAL = 30000; // 30초

// 성능 지표 보관 기간 (샘플 수)
const MAX_METRICS_SAMPLES = 60; // 30분 (30초 간격으로 60개 샘플)

// 성능 지표 저장소
const metrics = {
  system: [],
  api: {},
  database: {},
  memory: [],
  startTime: Date.now(),
  lastCollectionTime: Date.now()
};

/**
 * 모니터링 모듈 초기화
 * @param {Object} options - 초기화 옵션
 */
function initialize(options = {}) {
  const interval = options.interval || 60000; // 기본 1분마다 로깅
  
  logger.info('성능 모니터링 서비스 초기화 완료', {
    collectionInterval: `${interval / 1000}초`,
    maxSamples: MAX_METRICS_SAMPLES
  });
  
  // 주기적으로 시스템 메트릭 수집 및 로깅
  setInterval(() => {
    const summary = getMetricsSummary();
    logger.info('시스템 성능 지표', { summary });
    
    // 필요한 경우 임계값 초과 알림
    checkThresholds(summary);
  }, interval);
}

/**
 * API 요청 메트릭 기록
 * @param {string} endpoint - API 엔드포인트
 * @param {number} responseTime - 응답 시간 (ms)
 * @param {boolean} success - 요청 성공 여부
 */
function recordApiMetrics(endpoint, responseTime, success) {
  if (!metrics.api[endpoint]) {
    metrics.api[endpoint] = {
      requestCount: 0,
      totalResponseTime: 0,
      successCount: 0,
      failCount: 0,
      minResponseTime: Number.MAX_SAFE_INTEGER,
      maxResponseTime: 0,
      lastRecorded: Date.now()
    };
  }
  
  const endpointMetrics = metrics.api[endpoint];
  
  endpointMetrics.requestCount++;
  endpointMetrics.totalResponseTime += responseTime;
  
  if (success) {
    endpointMetrics.successCount++;
  } else {
    endpointMetrics.failCount++;
  }
  
  endpointMetrics.minResponseTime = Math.min(endpointMetrics.minResponseTime, responseTime);
  endpointMetrics.maxResponseTime = Math.max(endpointMetrics.maxResponseTime, responseTime);
  endpointMetrics.lastRecorded = Date.now();
}

/**
 * 데이터베이스 쿼리 메트릭 기록
 * @param {string} operation - 데이터베이스 연산 (find, update 등)
 * @param {string} collection - 컬렉션 이름
 * @param {number} queryTime - 쿼리 실행 시간 (ms)
 * @param {boolean} success - 쿼리 성공 여부
 */
function recordDbMetrics(operation, collection, queryTime, success) {
  const key = `${collection}.${operation}`;
  
  if (!metrics.database[key]) {
    metrics.database[key] = {
      queryCount: 0,
      totalQueryTime: 0,
      successCount: 0,
      failCount: 0,
      minQueryTime: Number.MAX_SAFE_INTEGER,
      maxQueryTime: 0,
      lastRecorded: Date.now()
    };
  }
  
  const dbMetrics = metrics.database[key];
  
  dbMetrics.queryCount++;
  dbMetrics.totalQueryTime += queryTime;
  
  if (success) {
    dbMetrics.successCount++;
  } else {
    dbMetrics.failCount++;
  }
  
  dbMetrics.minQueryTime = Math.min(dbMetrics.minQueryTime, queryTime);
  dbMetrics.maxQueryTime = Math.max(dbMetrics.maxQueryTime, queryTime);
  dbMetrics.lastRecorded = Date.now();
}

/**
 * 시스템 메트릭 수집
 * @returns {Object} 시스템 메트릭 객체
 */
function getSystemMetrics() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  
  // CPU 사용량 계산
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  
  const cpuUsage = 100 - (totalIdle / totalTick * 100);
  
  return {
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
    cpu: {
      usage: cpuUsage.toFixed(2),
      cores: cpus.length
    },
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
      usagePercent: ((totalMem - freeMem) / totalMem * 100).toFixed(2)
    }
  };
}

/**
 * 프로세스 메트릭 수집
 * @returns {Object} 프로세스 메트릭 객체
 */
function getProcessMetrics() {
  const memoryUsage = process.memoryUsage();
  
  return {
    memory: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      usagePercent: (memoryUsage.heapUsed / memoryUsage.heapTotal * 100).toFixed(2)
    },
    uptime: process.uptime()
  };
}

/**
 * 현재 메트릭 요약 반환
 * @returns {Object} 종합 메트릭 요약
 */
function getMetricsSummary() {
  // API 메트릭 계산
  Object.keys(metrics.api).forEach(endpoint => {
    const apiMetric = metrics.api[endpoint];
    apiMetric.avgResponseTime = apiMetric.requestCount ? 
      (apiMetric.totalResponseTime / apiMetric.requestCount).toFixed(2) : 0;
    apiMetric.errorRate = apiMetric.requestCount ? 
      (apiMetric.failCount / apiMetric.requestCount).toFixed(4) : 0;
  });
  
  // DB 메트릭 계산
  Object.keys(metrics.database).forEach(key => {
    const dbMetric = metrics.database[key];
    dbMetric.avgQueryTime = dbMetric.queryCount ? 
      (dbMetric.totalQueryTime / dbMetric.queryCount).toFixed(2) : 0;
    dbMetric.errorRate = dbMetric.queryCount ? 
      (dbMetric.failCount / dbMetric.queryCount).toFixed(4) : 0;
  });
  
  return {
    timestamp: Date.now(),
    uptime: Date.now() - metrics.startTime,
    system: getSystemMetrics(),
    process: getProcessMetrics(),
    api: metrics.api,
    database: metrics.database
  };
}

/**
 * 메트릭 임계값 확인 및 알림
 * @param {Object} summary - 메트릭 요약 객체
 */
function checkThresholds(summary) {
  // 메모리 사용량 임계값 확인 (90% 이상)
  if (parseFloat(summary.system.memory.usagePercent) > 90) {
    logger.warn('높은 시스템 메모리 사용량 감지', {
      usagePercent: summary.system.memory.usagePercent
    });
  }
  
  // 힙 메모리 사용량 임계값 확인 (85% 이상)
  if (parseFloat(summary.process.memory.usagePercent) > 85) {
    logger.warn('높은 힙 메모리 사용량 감지', {
      usagePercent: summary.process.memory.usagePercent
    });
  }
  
  // API 에러율 임계값 확인 (5% 이상)
  Object.keys(summary.api).forEach(endpoint => {
    if (parseFloat(summary.api[endpoint].errorRate) > 0.05) {
      logger.warn('높은 API 에러율 감지', {
        endpoint,
        errorRate: summary.api[endpoint].errorRate
      });
    }
    
    // 응답 시간 임계값 확인 (평균 1초 이상)
    if (parseFloat(summary.api[endpoint].avgResponseTime) > 1000) {
      logger.warn('긴 API 응답 시간 감지', {
        endpoint, 
        avgResponseTime: summary.api[endpoint].avgResponseTime
      });
    }
  });
  
  // DB 쿼리 에러율 임계값 확인 (3% 이상)
  Object.keys(summary.database).forEach(key => {
    if (parseFloat(summary.database[key].errorRate) > 0.03) {
      logger.warn('높은 DB 쿼리 에러율 감지', {
        query: key,
        errorRate: summary.database[key].errorRate
      });
    }
    
    // 쿼리 시간 임계값 확인 (평균 500ms 이상)
    if (parseFloat(summary.database[key].avgQueryTime) > 500) {
      logger.warn('긴 DB 쿼리 시간 감지', {
        query: key,
        avgQueryTime: summary.database[key].avgQueryTime
      });
    }
  });
}

// 모듈 내보내기
module.exports = {
  initialize,
  recordApiMetrics,
  recordDbMetrics,
  getMetricsSummary
}; 