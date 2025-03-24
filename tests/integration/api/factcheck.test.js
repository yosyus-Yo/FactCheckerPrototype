/**
 * 팩트체킹 API 통합 테스트
 */
const request = require('supertest');
const app = require('../../../src/app');
const factCheckerIntegration = require('../../../src/services/factCheckerIntegration');

// 서비스 모킹
jest.mock('../../../src/services/factCheckerIntegration');

describe('팩트체킹 API 통합 테스트', () => {
  // 테스트 전 설정
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/verify-claim-multi', () => {
    test('유효한 요청이 주어지면 검증 결과를 반환해야 함', async () => {
      // 서비스 응답 모킹
      const mockVerificationResult = {
        status: 'VERIFIED_TRUE',
        trustScore: 0.92,
        explanation: '여러 과학적 증거에 의해 검증됨',
        sources: [
          { url: 'https://example.com/evidence1', title: '과학적 증거 1' },
          { url: 'https://example.com/evidence2', title: '과학적 증거 2' }
        ]
      };
      
      factCheckerIntegration.verifyClaim.mockResolvedValue(mockVerificationResult);
      
      // API 요청
      const response = await request(app)
        .post('/api/verify-claim-multi')
        .send({
          claim: '지구는 둥글다',
          language: 'ko',
          apis: ['google', 'factiverse']
        });
      
      // 응답 검증
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('result');
      expect(response.body.result).toEqual(mockVerificationResult);
      expect(factCheckerIntegration.verifyClaim).toHaveBeenCalledWith(
        '지구는 둥글다',
        expect.objectContaining({
          languageCode: 'ko',
          apis: ['google', 'factiverse']
        })
      );
    });

    test('클레임이 없는 요청은 400 오류를 반환해야 함', async () => {
      // API 요청 (클레임 없음)
      const response = await request(app)
        .post('/api/verify-claim-multi')
        .send({
          language: 'ko',
          apis: ['google']
        });
      
      // 응답 검증
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', true);
      expect(factCheckerIntegration.verifyClaim).not.toHaveBeenCalled();
    });

    test('서비스 오류 발생 시 500 오류를 반환해야 함', async () => {
      // 서비스 오류 모킹
      factCheckerIntegration.verifyClaim.mockRejectedValue(new Error('서비스 오류'));
      
      // API 요청
      const response = await request(app)
        .post('/api/verify-claim-multi')
        .send({
          claim: '지구는 둥글다',
          language: 'ko',
          apis: ['google']
        });
      
      // 응답 검증
      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', true);
    });
  });

  describe('POST /api/verify-claims-batch', () => {
    test('여러 클레임을 일괄 처리하여 결과를 반환해야 함', async () => {
      // 서비스 응답 모킹
      const mockResults = [
        {
          status: 'VERIFIED_TRUE',
          trustScore: 0.92,
          explanation: '과학적 사실',
          sources: [{ url: 'https://example.com/evidence1', title: '증거 1' }]
        },
        {
          status: 'VERIFIED_FALSE',
          trustScore: 0.15,
          explanation: '과학적 근거 없음',
          sources: [{ url: 'https://example.com/evidence2', title: '증거 2' }]
        }
      ];
      
      factCheckerIntegration.verifyClaimBatch.mockResolvedValue(mockResults);
      
      // API 요청
      const response = await request(app)
        .post('/api/verify-claims-batch')
        .send({
          claims: ['지구는 둥글다', '지구는 평평하다'],
          language: 'ko',
          apis: ['google', 'factiverse']
        });
      
      // 응답 검증
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(2);
      expect(factCheckerIntegration.verifyClaimBatch).toHaveBeenCalledWith(
        ['지구는 둥글다', '지구는 평평하다'],
        expect.objectContaining({
          languageCode: 'ko',
          apis: ['google', 'factiverse']
        })
      );
    });

    test('클레임 배열이 없는 요청은 400 오류를 반환해야 함', async () => {
      // API 요청 (클레임 배열 없음)
      const response = await request(app)
        .post('/api/verify-claims-batch')
        .send({
          language: 'ko',
          apis: ['google']
        });
      
      // 응답 검증
      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', true);
      expect(factCheckerIntegration.verifyClaimBatch).not.toHaveBeenCalled();
    });

    test('빈 클레임 배열은 처리되어야 함', async () => {
      // 서비스 응답 모킹
      factCheckerIntegration.verifyClaimBatch.mockResolvedValue([]);
      
      // API 요청 (빈 클레임 배열)
      const response = await request(app)
        .post('/api/verify-claims-batch')
        .send({
          claims: [],
          language: 'ko',
          apis: ['google']
        });
      
      // 응답 검증
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('success', true);
      expect(response.body).toHaveProperty('results');
      expect(Array.isArray(response.body.results)).toBe(true);
      expect(response.body.results.length).toBe(0);
    });
  });
}); 