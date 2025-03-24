/**
 * 성능 모니터링 서비스 단위 테스트
 */
const performanceMonitor = require('../../../src/services/performanceMonitor');

describe('성능 모니터링 서비스 테스트', () => {
  beforeEach(() => {
    // 모듈 내부 상태 초기화 (필요한 경우)
    jest.clearAllMocks();
  });

  describe('initialize() 함수', () => {
    test('오류 없이 초기화되어야 함', () => {
      // setInterval 모킹
      jest.spyOn(global, 'setInterval').mockImplementation(() => {});
      
      expect(() => {
        performanceMonitor.initialize();
      }).not.toThrow();
      
      expect(setInterval).toHaveBeenCalled();
      
      // 모킹 복원
      global.setInterval.mockRestore();
    });
  });

  describe('recordApiMetrics() 함수', () => {
    test('API 메트릭을 기록해야 함', () => {
      // 함수 호출
      performanceMonitor.recordApiMetrics('/api/test', 150, true);
      performanceMonitor.recordApiMetrics('/api/test', 200, true);
      
      // 메트릭 확인 (getMetricsSummary에서 확인 가능)
      const metrics = performanceMonitor.getMetricsSummary();
      
      // API 메트릭 포함 확인
      expect(metrics).toHaveProperty('api');
      expect(metrics.api).toHaveProperty('/api/test');
      
      // 샘플 수 확인
      expect(metrics.api['/api/test'].requestCount).toBeGreaterThanOrEqual(2);
    });

    test('API 오류를 기록해야 함', () => {
      // 함수 호출 (성공, 실패)
      performanceMonitor.recordApiMetrics('/api/error-test', 150, true);
      performanceMonitor.recordApiMetrics('/api/error-test', 300, false);
      
      // 메트릭 확인
      const metrics = performanceMonitor.getMetricsSummary();
      
      // API 메트릭 포함 확인
      expect(metrics).toHaveProperty('api');
      expect(metrics.api).toHaveProperty('/api/error-test');
      
      // 오류율 확인 (50% = 0.5) - 문자열을 숫자로 변환
      expect(parseFloat(metrics.api['/api/error-test'].errorRate)).toBeGreaterThan(0);
    });
  });

  describe('recordDbMetrics() 함수', () => {
    test('데이터베이스 쿼리 메트릭을 기록해야 함', () => {
      // 함수 호출
      performanceMonitor.recordDbMetrics('find', 'users', 50, true);
      performanceMonitor.recordDbMetrics('find', 'users', 70, true);
      
      // 메트릭 확인
      const metrics = performanceMonitor.getMetricsSummary();
      
      // DB 메트릭 포함 확인
      expect(metrics).toHaveProperty('database');
      // 객체에 해당 키가 존재하는지 확인 (toHaveProperty 대신)
      expect(metrics.database['users.find']).toBeDefined();
      
      // 샘플 수 확인
      expect(metrics.database['users.find'].queryCount).toBeGreaterThanOrEqual(2);
    });

    test('데이터베이스 쿼리 오류를 기록해야 함', () => {
      // 함수 호출 (성공, 실패)
      performanceMonitor.recordDbMetrics('update', 'claims', 80, true);
      performanceMonitor.recordDbMetrics('update', 'claims', 120, false);
      
      // 메트릭 확인
      const metrics = performanceMonitor.getMetricsSummary();
      
      // DB 메트릭 포함 확인
      expect(metrics).toHaveProperty('database');
      // 객체에 해당 키가 존재하는지 확인 (toHaveProperty 대신)
      expect(metrics.database['claims.update']).toBeDefined();
      
      // 오류율 확인 - 문자열을 숫자로 변환
      expect(parseFloat(metrics.database['claims.update'].errorRate)).toBeGreaterThan(0);
    });
  });

  describe('getMetricsSummary() 함수', () => {
    test('올바른 형식의 메트릭 요약을 반환해야 함', () => {
      // 함수 호출
      const summary = performanceMonitor.getMetricsSummary();
      
      // 메트릭 구조 확인
      expect(summary).toHaveProperty('timestamp');
      expect(summary).toHaveProperty('system');
      expect(summary).toHaveProperty('process');
      expect(summary).toHaveProperty('api');
      expect(summary).toHaveProperty('database');
      
      // 시스템 메트릭 구조 확인
      expect(summary.system).toHaveProperty('cpu');
      expect(summary.system).toHaveProperty('memory');
      expect(summary.system).toHaveProperty('loadAvg');
      
      // 프로세스 메트릭 구조 확인
      expect(summary.process).toHaveProperty('memory');
      expect(summary.process.memory).toHaveProperty('rss');
      expect(summary.process.memory).toHaveProperty('heapUsed');
      expect(summary.process.memory).toHaveProperty('heapTotal');
    });

    test('API 및 DB 메트릭이 추가된 후 요약에 포함되어야 함', () => {
      // 테스트 메트릭 추가
      performanceMonitor.recordApiMetrics('/api/summary-test', 100, true);
      performanceMonitor.recordDbMetrics('find', 'summary', 30, true);
      
      // 함수 호출
      const summary = performanceMonitor.getMetricsSummary();
      
      // 추가된 메트릭 확인 - 객체 속성 접근 방식 수정
      expect(summary.api).toHaveProperty('/api/summary-test');
      expect(summary.database['summary.find']).toBeDefined();
    });
  });
}); 