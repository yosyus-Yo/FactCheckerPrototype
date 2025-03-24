/**
 * 애플리케이션 설정 파일
 * 환경 변수 및 기본 설정값을 관리합니다.
 */

// 앱 설정
const app = {
  name: process.env.APP_NAME || 'FactChecker',
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || 'localhost',
  enableClusterMode: process.env.ENABLE_CLUSTER_MODE === 'true', // 클러스터 모드 활성화 여부
  trustProxy: process.env.TRUST_PROXY === 'true' // 프록시 신뢰 여부
};

// 데이터베이스 설정
const database = {
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/factchecker',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      poolSize: parseInt(process.env.MONGODB_POOL_SIZE, 10) || 10, // 커넥션 풀 크기
      connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS, 10) || 10000,
      serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 15000
    }
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    options: {
      enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE === 'true', // 오프라인 큐 활성화 여부
      retryStrategy: (times) => Math.min(times * 50, 2000) // 재시도 전략
    }
  }
};

// app.js에서 config.db로 접근하기 때문에 별칭 추가
const db = database;

// API 설정
const api = {
  googleFactCheck: {
    apiKey: process.env.GOOGLE_FACTCHECK_API_KEY,
    apiUrl: process.env.GOOGLE_FACTCHECK_API_URL || 'https://factchecktools.googleapis.com/v1alpha1'
  },
  bigkinds: {
    apiKey: process.env.BIGKINDS_API_KEY,
    apiUrl: process.env.BIGKINDS_API_URL || 'https://API.bigkinds.or.kr',
    enabled: process.env.BIGKINDS_API_ENABLED === 'true' // 빅카인즈 API 활성화 여부
  },
  factiverse: {
    apiKey: process.env.FACTIVERSE_API_KEY,
    apiUrl: process.env.FACTIVERSE_API_URL || 'https://api.factiverse.com/v1',
    enabled: process.env.FACTIVERSE_API_ENABLED === 'true' // Factiverse API 활성화 여부
  },
  googleAi: {
    apiKey: process.env.GOOGLE_AI_API_KEY || '',
    enabled: process.env.GOOGLE_AI_ENABLED === 'true' // Google AI API 활성화 여부
  }
};

// 캐싱 설정
const cache = {
  enabled: process.env.CACHE_ENABLED !== 'false', // 기본값은 활성화
  ttl: parseInt(process.env.CACHE_TTL, 10) || 86400, // 캐시 TTL (초), 기본값 24시간
  prefetch: process.env.CACHE_PREFETCH === 'true', // 프리페치 활성화 여부
  compressionEnabled: process.env.CACHE_COMPRESSION_ENABLED === 'true', // 캐시 압축 활성화 여부
  keysPattern: process.env.CACHE_KEYS_PATTERN || 'factchecker:*', // 캐시 키 패턴
  checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD, 10) || 600 // 10분
};

// 로깅 설정
const logging = {
  level: process.env.LOG_LEVEL || (app.env === 'production' ? 'info' : 'debug'),
  format: process.env.LOG_FORMAT || 'json',
  fileLogging: process.env.FILE_LOGGING === 'true',
  logDir: process.env.LOG_DIR || 'logs',
  performanceLogging: process.env.PERFORMANCE_LOGGING === 'true', // 성능 로깅 활성화 여부
  file: process.env.LOG_FILE || 'logs/factchecker.log'
};

// 성능 설정
const performance = {
  cacheThreshold: parseInt(process.env.PERF_CACHE_THRESHOLD_MS, 10) || 1000, // 캐싱 임계값 (밀리초)
  timeout: {
    api: parseInt(process.env.PERF_API_TIMEOUT_MS, 10) || 5000, // API 요청 타임아웃 (밀리초)
    db: parseInt(process.env.PERF_DB_TIMEOUT_MS, 10) || 3000, // DB 쿼리 타임아웃 (밀리초)
    default: parseInt(process.env.PERF_DEFAULT_TIMEOUT_MS, 10) || 10000 // 기본 타임아웃 (밀리초)
  },
  rateLimiting: {
    enabled: process.env.RATE_LIMITING_ENABLED === 'true', // 속도 제한 활성화 여부
    windowMs: parseInt(process.env.RATE_LIMITING_WINDOW_MS, 10) || 60000, // 시간 창 (밀리초), 기본값 1분
    maxRequests: parseInt(process.env.RATE_LIMITING_MAX_REQUESTS, 10) || 100 // 최대 요청 수
  }
};

// 기능 플래그
const features = {
  multiApi: process.env.FEATURE_MULTI_API !== 'false', // 멀티 API 통합 활성화 여부
  caching: process.env.FEATURE_CACHING !== 'false', // 캐싱 활성화 여부
  sse: process.env.FEATURE_SSE !== 'false', // SSE 활성화 여부
  rateLimiting: process.env.FEATURE_RATE_LIMITING === 'true', // 속도 제한 활성화 여부
  arVisualization: process.env.FEATURE_AR_VISUALIZATION === 'true', // AR 시각화 활성화 여부
  crawling: process.env.FEATURE_CRAWLING === 'true', // 크롤링 활성화 여부
  metrics: process.env.FEATURE_METRICS === 'true' // 메트릭스 수집 활성화 여부
};

// WebXR 설정
const webxr = {
  enabled: process.env.WEBXR_ENABLED === 'true', // WebXR 활성화 여부
  featuresRequired: process.env.WEBXR_FEATURES_REQUIRED?.split(',') || ['dom-overlay', 'hit-test'],
  featuresOptional: process.env.WEBXR_FEATURES_OPTIONAL?.split(',') || ['dom-overlay', 'hit-test', 'light-estimation'],
  domOverlay: process.env.WEBXR_DOM_OVERLAY === 'true', // DOM 오버레이 활성화 여부
  performanceMode: process.env.WEBXR_PERFORMANCE_MODE || 'balanced' // 성능 모드 (low, balanced, high)
};

// CORS 설정
const cors = {
  allowedOrigins: process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['*'],
  allowedMethods: process.env.CORS_ALLOWED_METHODS?.split(',') || ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: process.env.CORS_ALLOWED_HEADERS?.split(',') || ['Content-Type', 'Authorization'],
  maxAge: parseInt(process.env.CORS_MAX_AGE, 10) || 86400 // 프리플라이트 요청 캐싱 시간 (초), 기본값 24시간
};

// API 키 설정
const apiKeys = {
  googleAI: process.env.GOOGLE_AI_API_KEY || 'YOUR_GOOGLE_AI_API_KEY',
  tavily: process.env.TAVILY_API_KEY || 'YOUR_TAVILY_API_KEY',
  braveSearch: process.env.BRAVE_SEARCH_API_KEY || 'YOUR_BRAVE_SEARCH_API_KEY',
  googleFactCheck: process.env.GOOGLE_FACT_CHECK_API_KEY || 'YOUR_GOOGLE_FACT_CHECK_API_KEY'
};

// 임시 파일 설정
const tempFiles = {
  directory: process.env.TEMP_DIR || 'tmp',
  expirationTime: 24 * 60 * 60 * 1000 // 24시간
};

// 모든 설정을 하나의 객체로 내보내기
module.exports = {
  app,
  database,
  db,
  api,
  cache,
  logging,
  performance,
  features,
  webxr,
  cors,
  apiKeys,
  tempFiles
}; 