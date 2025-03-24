/**
 * 부하 테스트 스크립트
 * 
 * 애플리케이션의 주요 API 엔드포인트에 대한 부하 테스트를 수행합니다.
 * 이 스크립트는 autocannon을 사용하여 HTTP 부하 테스트를 실행합니다.
 */
const autocannon = require('autocannon');
const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');

// 결과 저장 경로
const RESULTS_DIR = path.join(__dirname, 'load-test-results');

// 애플리케이션 서버 포트
const APP_PORT = 3000;

// 테스트 구성
const TEST_CONFIGS = [
  {
    name: 'health-check',
    url: `http://localhost:${APP_PORT}/api/health`,
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    },
    duration: 10, // 테스트 지속 시간(초)
    connections: 100, // 동시 연결 수
    pipelining: 10, // 파이프라이닝 요청 수
    description: 'API 상태 확인 엔드포인트 부하 테스트'
  },
  {
    name: 'verify-claim',
    url: `http://localhost:${APP_PORT}/api/verify-claim-multi`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      claim: '지구는 둥글다',
      language: 'ko',
      apis: ['google']
    }),
    duration: 20,
    connections: 50,
    description: '단일 클레임 검증 엔드포인트 부하 테스트'
  },
  {
    name: 'verify-claims-batch',
    url: `http://localhost:${APP_PORT}/api/verify-claims-batch`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      claims: [
        '지구는 둥글다',
        '달은 지구의 위성이다'
      ],
      language: 'ko',
      apis: ['google']
    }),
    duration: 20,
    connections: 30,
    description: '일괄 클레임 검증 엔드포인트 부하 테스트'
  }
];

/**
 * 부하 테스트 실행 함수
 * @param {Object} config - 테스트 구성
 * @returns {Promise<Object>} - 테스트 결과
 */
function runLoadTest(config) {
  return new Promise((resolve, reject) => {
    console.log(`부하 테스트 실행 중: ${config.name}`);
    
    const instance = autocannon({
      url: config.url,
      method: config.method,
      headers: config.headers,
      body: config.body,
      duration: config.duration,
      connections: config.connections,
      pipelining: config.pipelining || 1,
      title: config.name
    }, (err, result) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(result);
    });
    
    // 진행 상황 출력
    autocannon.track(instance, { renderProgressBar: true });
  });
}

/**
 * 결과 저장 함수
 * @param {string} testName - 테스트 이름
 * @param {Object} result - 테스트 결과
 */
function saveResults(testName, result) {
  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const filePath = path.join(RESULTS_DIR, `${testName}-${timestamp}.json`);
  
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2));
  console.log(`결과 저장됨: ${filePath}`);
}

/**
 * 서버 시작 함수
 * @returns {Promise<Object>} - 서버 프로세스
 */
function startServer() {
  return new Promise((resolve, reject) => {
    console.log('테스트용 서버 시작 중...');
    
    // 환경 변수 설정 (테스트용)
    const env = { ...process.env, NODE_ENV: 'test', PORT: APP_PORT };
    
    // 서버 프로세스 실행
    const server = fork('src/app.js', [], { env, silent: true });
    
    // 서버 시작 기다리기
    let started = false;
    
    server.stdout.on('data', (data) => {
      const message = data.toString();
      console.log(`서버: ${message.trim()}`);
      
      if (message.includes(`서버가 포트 ${APP_PORT}에서 실행 중입니다`)) {
        started = true;
        console.log('서버가 준비되었습니다.');
        resolve(server);
      }
    });
    
    server.stderr.on('data', (data) => {
      console.error(`서버 오류: ${data.toString().trim()}`);
    });
    
    server.on('error', (err) => {
      console.error('서버 프로세스 오류:', err);
      reject(err);
    });
    
    // 타임아웃 설정
    setTimeout(() => {
      if (!started) {
        server.kill();
        reject(new Error('서버 시작 타임아웃'));
      }
    }, 10000);
  });
}

/**
 * 모든 부하 테스트 실행
 */
async function runAllTests() {
  console.log('부하 테스트 시작...');
  
  let server;
  
  try {
    // 서버 시작
    server = await startServer();
    
    // 서버 준비 시간
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 각 테스트 구성에 대해 부하 테스트 실행
    for (const config of TEST_CONFIGS) {
      console.log(`\n${config.description || config.name} 시작`);
      const result = await runLoadTest(config);
      
      // 결과 저장
      saveResults(config.name, result);
      
      // 주요 지표 출력
      console.log('\n결과 요약:');
      console.log(`요청 수: ${result.requests.total}`);
      console.log(`평균 처리량: ${result.requests.average} req/sec`);
      console.log(`평균 지연 시간: ${result.latency.average} ms`);
      console.log(`최대 지연 시간: ${result.latency.max} ms`);
      console.log(`오류 수: ${result.errors}`);
      
      // 테스트 간 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('\n모든 부하 테스트 완료!');
  } catch (error) {
    console.error('부하 테스트 중 오류 발생:', error);
  } finally {
    // 서버 종료
    if (server) {
      console.log('테스트용 서버 종료 중...');
      server.kill();
    }
  }
}

// 직접 실행 시 모든 테스트 실행
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { runLoadTest, runAllTests, TEST_CONFIGS }; 