/**
 * Jest 전역 설정 파일
 * 모든 테스트 실행 전에 한 번 실행됩니다.
 */

// 환경 변수 설정
process.env.NODE_ENV = 'test';

module.exports = async () => {
  console.log('\n테스트 환경 설정 시작...');
  
  // 필요한 경우 테스트용 데이터베이스 설정
  // MongoDB 테스트 환경 설정 예시
  /*
  const mongoose = require('mongoose');
  const { MongoMemoryServer } = require('mongodb-memory-server');
  
  const mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  process.env.MONGODB_URI = mongoUri;
  global.__MONGO_URI__ = mongoUri;
  global.__MONGO_SERVER__ = mongoServer;
  
  await mongoose.connect(mongoUri);
  */
  
  // Redis 테스트 환경 설정 예시
  /*
  const { RedisMemoryServer } = require('redis-memory-server');
  const redisServer = new RedisMemoryServer();
  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  
  process.env.REDIS_URL = `redis://${redisHost}:${redisPort}`;
  global.__REDIS_SERVER__ = redisServer;
  */
  
  // Mock API 서버 설정 예시
  /*
  const mockServer = require('./mocks/api-server');
  await mockServer.start();
  global.__MOCK_SERVER__ = mockServer;
  */
  
  // 테스트용 임시 디렉토리 생성
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  
  const tempTestDir = path.join(os.tmpdir(), 'factchecker-tests-' + Date.now());
  fs.mkdirSync(tempTestDir, { recursive: true });
  process.env.TEST_TEMP_DIR = tempTestDir;
  
  console.log('테스트 환경 설정 완료');
  console.log('테스트 임시 디렉토리:', tempTestDir);
  
  // 기타 전역 설정
  // 콘솔 출력 형식 설정 등
  
  // Jest의 타임아웃 설정
  // jest.setTimeout(30000); // 이 부분이 문제입니다
  // setTimeout 설정은 setupFiles에서 처리하도록 수정
}; 