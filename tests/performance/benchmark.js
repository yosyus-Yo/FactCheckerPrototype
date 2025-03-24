/**
 * 성능 테스트 스크립트
 * 
 * 주요 기능의 성능을 측정하고 결과를 저장합니다.
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const axios = require('axios');
const factCheckerIntegration = require('../../src/services/factCheckerIntegration');
const performanceMonitor = require('../../src/services/performanceMonitor');
const arVisualization = require('../../src/services/arVisualization');
const contentRecognition = require('../../src/services/contentRecognition');

// 벤치마크 결과 저장 경로
const RESULTS_PATH = path.join(__dirname, 'benchmark-results.json');

// 벤치마크 반복 횟수
const ITERATIONS = 100;

// 벤치마크 테스트 케이스 정의
const benchmarks = [
  {
    name: '팩트체커 통합: 단일 클레임 검증',
    async fn() {
      // API 호출 모킹
      jest.spyOn(axios, 'get').mockImplementation(() => 
        Promise.resolve({
          data: {
            claims: [
              {
                text: '지구는 둥글다',
                claimReview: [
                  {
                    textualRating: 'True',
                    title: '과학적으로 검증된 사실',
                    url: 'https://example.com/evidence',
                    publisher: { name: 'Science Fact Check' }
                  }
                ]
              }
            ]
          }
        })
      );
      
      await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google']
      });
      
      axios.get.mockRestore();
    }
  },
  {
    name: '팩트체커 통합: 일괄 클레임 검증 (10개)',
    async fn() {
      // verifyClaim 함수 모킹
      const originalVerifyClaim = factCheckerIntegration.verifyClaim;
      factCheckerIntegration.verifyClaim = jest.fn().mockResolvedValue({
        status: 'VERIFIED_TRUE',
        trustScore: 0.9
      });
      
      const claims = Array(10).fill().map((_, i) => `테스트 클레임 ${i}`);
      await factCheckerIntegration.verifyClaimBatch(claims);
      
      factCheckerIntegration.verifyClaim = originalVerifyClaim;
    }
  },
  {
    name: 'AR 시각화: 검증 결과 시각화 데이터 생성',
    fn() {
      const verificationResult = {
        status: 'VERIFIED_TRUE',
        trustScore: 0.92,
        explanation: '여러 과학적 증거에 의해 검증됨',
        sources: [
          { url: 'https://example.com/evidence1', title: '과학적 증거 1' },
          { url: 'https://example.com/evidence2', title: '과학적 증거 2' }
        ]
      };
      
      arVisualization.generateVisualizationData(verificationResult);
    }
  },
  {
    name: '콘텐츠 인식: 텍스트에서 클레임 추출',
    async fn() {
      const text = `지구는 둥글다. 이는 과학적으로 증명된 사실이다.
      반면에 지구 평평설은 과학적 근거가 없는 주장이다.
      지구의 둘레는 약 4만 킬로미터이며, 지구의 자전 주기는 24시간이다.
      달은 지구의 위성이며, 약 27일마다 지구 주위를 공전한다.`;
      
      await contentRecognition.extractClaimsFromText(text);
    }
  },
  {
    name: '성능 모니터링: 지표 요약 생성',
    fn() {
      performanceMonitor.getMetricsSummary();
    }
  }
];

/**
 * 벤치마크 실행 함수
 * @param {Object} benchmark - 벤치마크 정의 객체
 * @returns {Object} - 벤치마크 결과
 */
async function runBenchmark(benchmark) {
  console.log(`실행 중: ${benchmark.name}`);
  
  const durations = [];
  
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    
    try {
      await benchmark.fn();
    } catch (error) {
      console.error(`벤치마크 오류 (${benchmark.name}):`, error);
      continue;
    }
    
    const end = performance.now();
    durations.push(end - start);
  }
  
  // 통계 계산
  durations.sort((a, b) => a - b);
  
  const sum = durations.reduce((acc, val) => acc + val, 0);
  const avg = sum / durations.length;
  
  const min = durations[0];
  const max = durations[durations.length - 1];
  
  // 중앙값
  const median = durations.length % 2 === 0
    ? (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
    : durations[Math.floor(durations.length / 2)];
  
  // 95 백분위수
  const p95Index = Math.floor(durations.length * 0.95);
  const p95 = durations[p95Index];
  
  // 표준 편차
  const variance = durations.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / durations.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    name: benchmark.name,
    iterations: durations.length,
    avgMs: avg.toFixed(2),
    medianMs: median.toFixed(2),
    p95Ms: p95.toFixed(2),
    minMs: min.toFixed(2),
    maxMs: max.toFixed(2),
    stdDevMs: stdDev.toFixed(2)
  };
}

/**
 * 모든 벤치마크 실행
 */
async function runAllBenchmarks() {
  console.log('성능 벤치마크 시작...');
  console.log(`반복 횟수: ${ITERATIONS}`);
  
  const results = [];
  const startTime = new Date();
  
  for (const benchmark of benchmarks) {
    const result = await runBenchmark(benchmark);
    results.push(result);
    console.log(`완료: ${benchmark.name} (평균: ${result.avgMs}ms)`);
  }
  
  const endTime = new Date();
  const totalTime = (endTime - startTime) / 1000;
  
  console.log(`모든 벤치마크 완료 (총 ${totalTime.toFixed(2)}초 소요)`);
  
  // 결과 저장
  const fullResults = {
    timestamp: new Date().toISOString(),
    duration: totalTime,
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCores: require('os').cpus().length
    },
    benchmarks: results
  };
  
  fs.writeFileSync(RESULTS_PATH, JSON.stringify(fullResults, null, 2));
  console.log(`결과가 저장됨: ${RESULTS_PATH}`);
  
  // 콘솔 표 형식으로 결과 출력
  console.table(results.map(r => ({
    '테스트': r.name,
    '평균 (ms)': r.avgMs,
    '중앙값 (ms)': r.medianMs,
    'P95 (ms)': r.p95Ms,
    '최소 (ms)': r.minMs,
    '최대 (ms)': r.maxMs
  })));
}

// 벤치마크 실행
if (require.main === module) {
  runAllBenchmarks().catch(console.error);
}

module.exports = { runBenchmark, runAllBenchmarks, benchmarks }; 