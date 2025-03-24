require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const redis = require('redis');
const cluster = require('cluster');
const os = require('os');
const app = express();
const logger = require('./utils/logger');
const config = require('./config');
const routes = require('./routes');

// 클러스터 모드 실행 여부 확인
const enableClusterMode = config.app.enableClusterMode !== false;
const numCPUs = os.cpus().length;

// 클러스터 모드가 활성화되어 있고, 프로덕션 환경이면 클러스터 실행
if (enableClusterMode && process.env.NODE_ENV === 'production' && cluster.isMaster) {
  logger.info(`마스터 프로세스 ${process.pid} 실행 중`);

  // CPU 코어 수만큼 워커 프로세스 생성
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // 워커 프로세스 종료 시 새 프로세스 생성
  cluster.on('exit', (worker, code, signal) => {
    logger.warn(`워커 프로세스 ${worker.process.pid} 종료됨 (${signal || code}). 재시작 중...`);
    cluster.fork();
  });
} else {
  // 워커 프로세스 또는 클러스터 모드 비활성화 시 서버 구성

  // 미들웨어 설정
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // 압축 미들웨어 추가
  const compression = require('compression');
  app.use(compression());

  // 보안 미들웨어 추가
  const helmet = require('helmet');
  app.use(helmet());

  // CORS 설정
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      return res.status(200).json({});
    }
    next();
  });

  // HTTP 요청 로깅
  if (process.env.NODE_ENV !== 'test') {
    const morgan = require('morgan');
    app.use(morgan('dev'));
  }

  // 라우트 설정
  app.use('/api', require('./routes/api'));
  app.use('/', routes.index);

  // 정적 파일 제공 (캐싱 활성화)
  app.use(express.static('public', {
    maxAge: '1d', // 정적 파일을 1일 동안 캐싱
    etag: true
  }));

  // 라우트 로깅 미들웨어 추가
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
  });

  // 404 에러 핸들러 수정
  app.use((req, res, next) => {
    console.error(`404 에러 발생: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      success: false, 
      error: `요청하신 URL(${req.originalUrl})을 찾을 수 없습니다.`,
      timestamp: new Date().toISOString()
    });
  });

  // 오류 핸들러
  app.use((err, req, res, next) => {
    logger.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  // 서버 시작
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`API 서버 URL: http://localhost:${PORT}/api`);
    
    // 서버 시작 시 초기화 작업 수행
    initializeApp();
  });
}

/**
 * 애플리케이션 초기화 함수
 */
async function initializeApp() {
  try {
    // MongoDB 연결
    await connectToMongoDB();
    logger.info('MongoDB 연결 성공');
    
    // Redis 연결
    await connectToRedis();
    logger.info('Redis 연결 성공');
    
    // 서비스 초기화
    initializeServices();
    
    logger.info('애플리케이션이 성공적으로 초기화되었습니다');
  } catch (error) {
    logger.error(`애플리케이션 초기화 중 오류 발생: ${error.message}`);
    // 심각한 오류인 경우 앱 종료 고려
    if (error.fatal) {
      logger.error('치명적인 오류로 인해 애플리케이션을 종료합니다');
      process.exit(1);
    }
  }
}

/**
 * MongoDB 데이터베이스 연결
 */
async function connectToMongoDB() {
  try {
    console.log('MongoDB 연결 시도 중...');
    
    // 몽구스 옵션 설정
    const mongooseOptions = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000 // 5초 타임아웃
    };
    
    if (!config.db.uri) {
      console.warn('MongoDB URI가 제공되지 않았습니다. 메모리 데이터베이스를 사용합니다.');
      // 인메모리 데이터베이스 생성을 위한 mongoose-memory-server를 사용하거나 
      // 디폴트 로컬 URI 사용
      await mongoose.connect('mongodb://localhost:27017/factchecker', mongooseOptions);
    } else {
      await mongoose.connect(config.db.uri, mongooseOptions);
    }
    
    console.log('MongoDB에 연결되었습니다');
    
    // 메모리 데이터베이스가 사용 중인지 확인
    const isMemoryDB = mongoose.connection.host === 'localhost:27017';
    if (isMemoryDB) {
      console.warn('메모리 또는 로컬 MongoDB를 사용 중입니다. 데이터는 영구적으로 저장되지 않을 수 있습니다.');
    }
    
    // 데이터베이스 초기화
    await initDatabase();
  } catch (err) {
    console.error('MongoDB 연결 오류:', err);
    
    // 데이터베이스 연결 실패 시 임시 인메모리 저장소 생성
    setupInMemoryStorage();
  }
}

/**
 * 인메모리 저장소 설정 (MongoDB 연결 실패 시)
 */
function setupInMemoryStorage() {
  console.log('인메모리 저장소를 사용합니다. 데이터는 서버 재시작 시 손실됩니다.');
  
  // 글로벌 맵 객체 생성하여 임시 데이터 저장
  global.inMemoryDB = {
    claims: new Map(),
    verifications: new Map(),
    sources: new Map()
  };
  
  // Verification 모델 메서드 모킹
  if (!global.Verification) {
    global.Verification = {
      findOne: async () => null,
      create: async (data) => {
        const id = `ver_${Date.now()}`;
        const newDoc = { _id: id, ...data, createdAt: new Date(), updatedAt: new Date() };
        global.inMemoryDB.verifications.set(id, newDoc);
        return newDoc;
      }
    };
  }
}

/**
 * 데이터베이스 초기화
 */
async function initDatabase() {
  // 필요한 초기화 작업 수행
  console.log('데이터베이스 초기화 완료');
}

/**
 * Redis 연결 함수
 */
async function connectToRedis() {
  try {
    const client = redis.createClient({
      url: config.db.redis.url
    });
    
    client.on('error', (err) => {
      logger.error(`Redis 오류: ${err.message}`);
    });
    
    await client.connect();
    
    // 전역 Redis 클라이언트 설정
    global.redisClient = client;
    
    return client;
  } catch (error) {
    logger.error(`Redis 연결 실패: ${error.message}`);
    // Redis는 선택 사항이므로 치명적 오류로 표시하지 않음
    return null;
  }
}

/**
 * 서비스 모듈 초기화 함수
 */
function initializeServices() {
  try {
    const services = require('./services');
    // 서비스 모듈에 캐싱 설정 적용
    if (services.factCheckerIntegration) {
      services.factCheckerIntegration.setCacheOptions({
        enabled: config.cache.enabled,
        ttl: config.cache.ttl
      });
    }
    logger.info('서비스 모듈이 초기화되었습니다');
  } catch (error) {
    logger.error(`서비스 초기화 중 오류 발생: ${error.message}`);
  }
}

// 에러 처리 이벤트 설정
process.on('uncaughtException', (error) => {
  logger.error(`처리되지 않은 예외: ${error.message}`, { stack: error.stack });
  // 심각한 예외 발생 시 프로세스 종료 (클러스터 모드에서는 마스터가 새 워커를 생성)
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`처리되지 않은 프로미스 거부: ${reason}`, { promise });
  // 프로세스는 종료하지 않고 로깅만 수행
});

module.exports = app; 