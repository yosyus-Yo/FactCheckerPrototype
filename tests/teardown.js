/**
 * Jest 전역 정리 파일
 * 모든 테스트 실행 후에 한 번 실행됩니다.
 */

const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

module.exports = async () => {
  console.log('\n테스트 환경 정리 시작...');
  
  // MongoDB 연결 종료 및 인스턴스 종료 예시
  /*
  const mongoose = require('mongoose');
  await mongoose.disconnect();
  
  if (global.__MONGO_SERVER__) {
    await global.__MONGO_SERVER__.stop();
  }
  */
  
  // Redis 서버 종료 예시
  /*
  if (global.__REDIS_SERVER__) {
    await global.__REDIS_SERVER__.stop();
  }
  */
  
  // Mock API 서버 종료 예시
  /*
  if (global.__MOCK_SERVER__) {
    await global.__MOCK_SERVER__.stop();
  }
  */
  
  // 테스트용 임시 디렉토리 삭제
  if (process.env.TEST_TEMP_DIR && fs.existsSync(process.env.TEST_TEMP_DIR)) {
    try {
      // rimraf 모듈을 사용한 디렉토리 삭제
      rimraf.sync(process.env.TEST_TEMP_DIR);
      console.log('테스트 임시 디렉토리 삭제 완료:', process.env.TEST_TEMP_DIR);
    } catch (error) {
      console.error('테스트 임시 디렉토리 삭제 중 오류 발생:', error);
    }
  }
  
  // 테스트 결과 로그 정리
  const testResultsPath = path.join(process.cwd(), 'test-results');
  if (fs.existsSync(testResultsPath)) {
    const files = fs.readdirSync(testResultsPath);
    // 오래된 로그 파일 정리
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(testResultsPath, file);
      const stats = fs.statSync(filePath);
      if (stats.mtimeMs < oneWeekAgo) {
        fs.unlinkSync(filePath);
      }
    }
  }
  
  console.log('테스트 환경 정리 완료');
}; 