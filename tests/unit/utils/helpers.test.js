/**
 * src/utils/helpers.js에 대한 단위 테스트
 */
const helpers = require('../../../src/utils/helpers');
const jestExtended = require('jest-extended');

// Jest 확장 설정
expect.extend(jestExtended);

describe('helpers 유틸리티 함수', () => {
  describe('trustScoreToVisual', () => {
    test('높은 신뢰도 점수는 "매우 높음"으로 변환되어야 함', () => {
      expect(helpers.trustScoreToVisual(0.95)).toBe('매우 높음');
      expect(helpers.trustScoreToVisual(0.9)).toBe('매우 높음');
    });

    test('높은 신뢰도 점수는 "높음"으로 변환되어야 함', () => {
      expect(helpers.trustScoreToVisual(0.89)).toBe('높음');
      expect(helpers.trustScoreToVisual(0.75)).toBe('높음');
    });

    test('중간 신뢰도 점수는 "중간"으로 변환되어야 함', () => {
      expect(helpers.trustScoreToVisual(0.74)).toBe('중간');
      expect(helpers.trustScoreToVisual(0.5)).toBe('중간');
    });

    test('낮은 신뢰도 점수는 "낮음"으로 변환되어야 함', () => {
      expect(helpers.trustScoreToVisual(0.49)).toBe('낮음');
      expect(helpers.trustScoreToVisual(0.25)).toBe('낮음');
    });

    test('매우 낮은 신뢰도 점수는 "매우 낮음"으로 변환되어야 함', () => {
      expect(helpers.trustScoreToVisual(0.24)).toBe('매우 낮음');
      expect(helpers.trustScoreToVisual(0.1)).toBe('매우 낮음');
      expect(helpers.trustScoreToVisual(0)).toBe('매우 낮음');
    });

    test('유효하지 않은 입력에 대해 "중간"을 반환해야 함', () => {
      expect(helpers.trustScoreToVisual(null)).toBe('중간');
      expect(helpers.trustScoreToVisual(undefined)).toBe('중간');
      expect(helpers.trustScoreToVisual('not-a-number')).toBe('중간');
    });
  });

  describe('extractClaims', () => {
    test('텍스트에서 주장을 추출해야 함', () => {
      const text = '지구는 둥글다. 이것은 과학적 사실이다.';
      const claims = helpers.extractClaims(text);
      
      expect(Array.isArray(claims)).toBe(true);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims).toContain('지구는 둥글다');
    });

    test('빈 텍스트에서는 빈 배열을 반환해야 함', () => {
      expect(helpers.extractClaims('')).toEqual([]);
    });

    test('null 또는 undefined에 대해 빈 배열을 반환해야 함', () => {
      expect(helpers.extractClaims(null)).toEqual([]);
      expect(helpers.extractClaims(undefined)).toEqual([]);
    });
  });

  describe('formatApiError', () => {
    test('오류 객체를 API 오류 응답 형식으로 변환해야 함', () => {
      const error = new Error('테스트 오류 메시지');
      const formattedError = helpers.formatApiError(error);
      
      expect(formattedError).toEqual({
        error: true,
        message: '테스트 오류 메시지',
        stack: expect.any(String)
      });
    });

    test('development 환경에서는 스택 트레이스를 포함해야 함', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      
      const error = new Error('개발 환경 오류');
      const formattedError = helpers.formatApiError(error);
      
      expect(formattedError.stack).toBeDefined();
      
      process.env.NODE_ENV = originalNodeEnv;
    });

    test('production 환경에서는 스택 트레이스를 포함하지 않아야 함', () => {
      const originalNodeEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      const error = new Error('프로덕션 환경 오류');
      const formattedError = helpers.formatApiError(error);
      
      expect(formattedError.stack).toBeUndefined();
      
      process.env.NODE_ENV = originalNodeEnv;
    });
  });

  describe('formatTimeInterval', () => {
    test('밀리초를 가독성 있는 시간 형식으로 변환해야 함', () => {
      expect(helpers.formatTimeInterval(500)).toBe('500ms');
      expect(helpers.formatTimeInterval(1500)).toBe('1.5초');
      expect(helpers.formatTimeInterval(60 * 1000)).toBe('1분');
      expect(helpers.formatTimeInterval(90 * 1000)).toBe('1분 30초');
      expect(helpers.formatTimeInterval(3600 * 1000)).toBe('1시간');
      expect(helpers.formatTimeInterval(3600 * 1000 + 90 * 1000)).toBe('1시간 1분 30초');
    });

    test('유효하지 않은 입력에 대해 "0ms"를 반환해야 함', () => {
      expect(helpers.formatTimeInterval(null)).toBe('0ms');
      expect(helpers.formatTimeInterval(undefined)).toBe('0ms');
      expect(helpers.formatTimeInterval('invalid')).toBe('0ms');
    });
  });
}); 