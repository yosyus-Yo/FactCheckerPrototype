const express = require('express');
const path = require('path');
const router = express.Router();
const apiRoutes = require('./api');

// 메인 페이지
router.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="ko">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>FactChecker - 실시간 팩트체킹 서비스</title>
      <style>
        body {
          font-family: 'Noto Sans KR', sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 20px;
          max-width: 1000px;
          margin: 0 auto;
        }
        header {
          text-align: center;
          margin-bottom: 30px;
        }
        h1 {
          color: #2c3e50;
        }
        .features {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 20px;
          margin-bottom: 30px;
        }
        .feature {
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 15px;
          background-color: #f9f9f9;
        }
        .feature h3 {
          margin-top: 0;
          color: #3498db;
        }
        footer {
          text-align: center;
          margin-top: 30px;
          color: #7f8c8d;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <header>
        <h1>FactChecker</h1>
        <p>실시간 미디어 콘텐츠의 진위 여부를 자동으로 검증하고 AR로 시각화하는 서비스</p>
      </header>
      
      <div class="features">
        <div class="feature">
          <h3>실시간 미디어 처리</h3>
          <p>음성, 영상, 텍스트 등 다양한 형태의 미디어 콘텐츠를 실시간으로 분석합니다.</p>
        </div>
        <div class="feature">
          <h3>주장 감지 및 분류</h3>
          <p>콘텐츠에서 검증이 필요한 주장을 자동으로 감지하고 분류합니다.</p>
        </div>
        <div class="feature">
          <h3>다중 소스 팩트체킹</h3>
          <p>다양한 신뢰할 수 있는 소스를 통해 주장의 사실 여부를 검증합니다.</p>
        </div>
        <div class="feature">
          <h3>AR 시각화</h3>
          <p>WebXR 기술을 활용하여 팩트체킹 결과를 증강현실로 시각화합니다.</p>
        </div>
      </div>
      
      <footer>
        <p>© ${new Date().getFullYear()} FactChecker. 모든 권리 보유.</p>
      </footer>
    </body>
    </html>
  `);
});

// 상태 확인 엔드포인트
router.get('/status', (req, res) => {
  res.json({ status: 'running' });
});

// 기존 방식 (이전 코드와 호환성 유지를 위해)
module.exports = {
  index: router,
  api: apiRoutes
};

// 새로운 라우터 내보내기 방식
const apiRouter = require('./api');
// 기존 router를 indexRouter로 사용
const indexRouter = router;
// 임시 어드민 라우터 생성
const adminRouter = express.Router();

// 어드민 라우터 기본 경로 설정
adminRouter.get('/', (req, res) => {
  res.json({ message: '관리자 페이지는 준비 중입니다.' });
});

module.exports = {
  apiRouter,
  indexRouter,
  adminRouter
}; 