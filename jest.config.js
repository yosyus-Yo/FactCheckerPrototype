/**
 * Jest 설정 파일
 * 테스트 환경 및 테스트 실행 방식 설정
 */
module.exports = {
  // 테스트 환경: Node.js 환경에서 실행
  testEnvironment: 'node',
  
  // 모듈 파일 확장자 설정
  moduleFileExtensions: [
    'js',
    'json',
    'ts'
  ],
  
  // 테스트 파일 패턴 설정
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  
  // 테스트 제외 패턴
  testPathIgnorePatterns: [
    '/node_modules/',
    '/public/'
  ],
  
  // 코드 변환 설정 (TypeScript 사용 시)
  transform: {
    '^.+\\.ts$': 'ts-jest'
  },
  
  // 코드 커버리지 설정
  collectCoverage: true,
  coverageDirectory: './coverage',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!**/node_modules/**'
  ],
  
  // 타임아웃 설정 (밀리초)
  testTimeout: 30000,
  
  // 테스트 실행 전 실행할 스크립트
  globalSetup: './tests/setup.js',
  
  // 테스트 실행 후 실행할 스크립트
  globalTeardown: './tests/teardown.js',
  
  // 테스트 리포팅 설정
  reporters: [
    'default',
    ['./node_modules/jest-html-reporter', {
      pageTitle: 'FactChecker 테스트 보고서',
      outputPath: './tests/test-report.html',
      includeFailureMsg: true,
      includeSuiteFailure: true
    }]
  ],
  
  // 모듈 경로 별칭 설정
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // 모듈 경로 해석 순서
  moduleDirectories: [
    'node_modules',
    'src'
  ],
  
  // 테스트 실행 환경 변수
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  },
  
  // 자세한 출력 
  verbose: true
}; 