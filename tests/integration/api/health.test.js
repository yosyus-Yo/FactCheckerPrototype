/**
 * API 상태 확인 엔드포인트에 대한 통합 테스트
 */
const request = require('supertest');
const app = require('../../../src/app');

describe('상태 확인 API', () => {
  test('GET /api/health는 200 상태 코드와 함께 상태 정보를 반환해야 함', async () => {
    const response = await request(app)
      .get('/api/health')
      .expect('Content-Type', /json/)
      .expect(200);
    
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('timestamp');
    expect(response.body).toHaveProperty('environment');
  });
  
  test('상태 확인 응답은 1초 이내에 반환되어야 함', async () => {
    const startTime = Date.now();
    
    await request(app)
      .get('/api/health')
      .expect(200);
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    expect(responseTime).toBeLessThan(1000);
  });
}); 