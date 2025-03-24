/**
 * factCheckerIntegration 서비스 통합 테스트
 * 실제 외부 API와의 통합을 테스트합니다.
 */
require('dotenv').config();
const factCheckerIntegration = require('../../../src/services/factCheckerIntegration');
const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');

describe('팩트체커 통합 서비스 통합 테스트', () => {
  let mockAxios;
  
  beforeAll(() => {
    // axios 모킹 설정
    mockAxios = new MockAdapter(axios);
  });
  
  afterAll(() => {
    // 모킹 해제
    mockAxios.restore();
  });
  
  beforeEach(() => {
    // 모든 모킹 초기화
    mockAxios.reset();
  });

  describe('verifyClaim() 외부 API 통합', () => {
    test('Google Fact Check API 응답을 처리해야 함', async () => {
      // API 응답 모킹
      const googleApiUrl = new RegExp('factchecktools.googleapis.com');
      mockAxios.onGet(googleApiUrl).reply(200, {
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
      });
      
      // API 호출
      const result = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google']
      });
      
      // 결과 검증
      expect(result).toBeDefined();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('trustScore');
      expect(result).toHaveProperty('sources');
      expect(result.sources.length).toBeGreaterThanOrEqual(1);
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBe(1);
      expect(mockAxios.history.get[0].url).toMatch(googleApiUrl);
    });
    
    test('Factiverse API 응답을 처리해야 함', async () => {
      // API 응답 모킹
      const factiverseApiUrl = new RegExp('factiverse.com');
      mockAxios.onGet(factiverseApiUrl).reply(200, {
        result: {
          claim: '지구는 둥글다',
          verdict: 'SUPPORTED',
          confidence: 0.95,
          sources: [
            { url: 'https://example.com/evidence', title: '과학적 증거' }
          ]
        }
      });
      
      // API 호출
      const result = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['factiverse']
      });
      
      // 결과 검증
      expect(result).toBeDefined();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('trustScore');
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBe(1);
      expect(mockAxios.history.get[0].url).toMatch(factiverseApiUrl);
    });
    
    test('여러 API 결과를 통합해야 함', async () => {
      // Google API 응답 모킹
      const googleApiUrl = new RegExp('factchecktools.googleapis.com');
      mockAxios.onGet(googleApiUrl).reply(200, {
        claims: [
          {
            text: '지구는 둥글다',
            claimReview: [
              {
                textualRating: 'True',
                title: '과학적으로 검증된 사실',
                url: 'https://example.com/evidence1',
                publisher: { name: 'Science Fact Check' }
              }
            ]
          }
        ]
      });
      
      // Factiverse API 응답 모킹
      const factiverseApiUrl = new RegExp('factiverse.com');
      mockAxios.onGet(factiverseApiUrl).reply(200, {
        result: {
          claim: '지구는 둥글다',
          verdict: 'SUPPORTED',
          confidence: 0.95,
          sources: [
            { url: 'https://example.com/evidence2', title: '다른 과학적 증거' }
          ]
        }
      });
      
      // API 호출
      const result = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google', 'factiverse']
      });
      
      // 결과 검증
      expect(result).toBeDefined();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('trustScore');
      expect(result).toHaveProperty('sources');
      
      // 두 소스가 모두 포함되어 있는지 확인
      expect(result.sources.length).toBeGreaterThanOrEqual(2);
      const sourceUrls = result.sources.map(source => source.url);
      expect(sourceUrls).toContain('https://example.com/evidence1');
      expect(sourceUrls).toContain('https://example.com/evidence2');
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBe(2);
    });
    
    test('하나의 API가 실패해도 다른 API의 결과를 반환해야 함', async () => {
      // Google API 오류 모킹
      const googleApiUrl = new RegExp('factchecktools.googleapis.com');
      mockAxios.onGet(googleApiUrl).reply(500, { error: 'Internal Server Error' });
      
      // Factiverse API 응답 모킹
      const factiverseApiUrl = new RegExp('factiverse.com');
      mockAxios.onGet(factiverseApiUrl).reply(200, {
        result: {
          claim: '지구는 둥글다',
          verdict: 'SUPPORTED',
          confidence: 0.95,
          sources: [
            { url: 'https://example.com/evidence', title: '과학적 증거' }
          ]
        }
      });
      
      // API 호출
      const result = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google', 'factiverse']
      });
      
      // 결과 검증
      expect(result).toBeDefined();
      expect(result).toHaveProperty('status');
      expect(result).toHaveProperty('trustScore');
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBe(2);
    });
    
    test('모든 API 요청이 실패하면 오류를 발생시켜야 함', async () => {
      // 모든 API 오류 모킹
      mockAxios.onGet().reply(500, { error: 'Internal Server Error' });
      
      // API 호출 및 예외 검증
      await expect(factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google', 'factiverse']
      })).rejects.toThrow();
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('verifyClaimBatch() 외부 API 통합', () => {
    test('여러 클레임을 일괄 처리하고 결과 배열을 반환해야 함', async () => {
      // API 응답 모킹
      const googleApiUrl = new RegExp('factchecktools.googleapis.com');
      
      // 첫 번째 클레임 응답
      mockAxios.onGet(googleApiUrl).replyOnce(200, {
        claims: [
          {
            text: '지구는 둥글다',
            claimReview: [
              {
                textualRating: 'True',
                title: '과학적으로 검증된 사실',
                url: 'https://example.com/evidence1',
                publisher: { name: 'Science Fact Check' }
              }
            ]
          }
        ]
      });
      
      // 두 번째 클레임 응답
      mockAxios.onGet(googleApiUrl).replyOnce(200, {
        claims: [
          {
            text: '지구는 평평하다',
            claimReview: [
              {
                textualRating: 'False',
                title: '과학적으로 반증된 주장',
                url: 'https://example.com/evidence2',
                publisher: { name: 'Science Fact Check' }
              }
            ]
          }
        ]
      });
      
      // API 호출
      const results = await factCheckerIntegration.verifyClaimBatch([
        '지구는 둥글다',
        '지구는 평평하다'
      ], {
        apis: ['google']
      });
      
      // 결과 검증
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(2);
      
      // 첫 번째 결과 검증
      expect(results[0]).toHaveProperty('status');
      expect(results[0]).toHaveProperty('trustScore');
      
      // 두 번째 결과 검증
      expect(results[1]).toHaveProperty('status');
      expect(results[1]).toHaveProperty('trustScore');
      
      // 신뢰도 점수 비교 (첫 번째가 더 높아야 함)
      expect(results[0].trustScore).toBeGreaterThan(results[1].trustScore);
      
      // API 호출 검증
      expect(mockAxios.history.get.length).toBe(2);
    });
  });

  describe('캐싱 기능 테스트', () => {
    test('캐시가 활성화되면 동일한 요청은 API를 다시 호출하지 않아야 함', async () => {
      // 캐시 활성화
      factCheckerIntegration.setCacheOptions({
        enabled: true,
        ttl: 3600
      });
      
      // API 응답 모킹
      const googleApiUrl = new RegExp('factchecktools.googleapis.com');
      mockAxios.onGet(googleApiUrl).replyOnce(200, {
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
      });
      
      // 첫 번째 API 호출
      const result1 = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google']
      });
      
      // 두 번째 API 호출 (캐시에서 가져와야 함)
      const result2 = await factCheckerIntegration.verifyClaim('지구는 둥글다', {
        apis: ['google']
      });
      
      // 결과 검증
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      
      // 결과가 동일한지 확인
      expect(result1.status).toBe(result2.status);
      expect(result1.trustScore).toBe(result2.trustScore);
      
      // API 호출은 한 번만 되어야 함
      expect(mockAxios.history.get.length).toBe(1);
      
      // 캐시 비활성화 (다른 테스트에 영향을 주지 않도록)
      factCheckerIntegration.setCacheOptions({
        enabled: false
      });
    });
  });
}); 