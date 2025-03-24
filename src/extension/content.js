// 팩트체크 오버레이 컴포넌트
class FactCheckOverlay {
  constructor() {
    this.overlayContainer = null;
    this.currentResult = null;
    this.setupOverlay();
    this.setupEventSource();
  }

  setupOverlay() {
    // 기존 오버레이 제거
    const existingOverlay = document.getElementById('fact-check-overlay');
    if (existingOverlay) {
      existingOverlay.remove();
    }

    // 새 오버레이 생성
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'fact-check-overlay';
    this.overlayContainer.style.display = 'none';
    this.overlayContainer.style.position = 'fixed';
    this.overlayContainer.style.top = '20px';
    this.overlayContainer.style.right = '20px';
    this.overlayContainer.style.width = '320px';
    this.overlayContainer.style.background = 'rgba(255, 255, 255, 0.95)';
    this.overlayContainer.style.borderRadius = '8px';
    this.overlayContainer.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.1)';
    this.overlayContainer.style.zIndex = '10000';
    this.overlayContainer.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

    document.body.appendChild(this.overlayContainer);
  }

  setupEventSource() {
    // 기존 EventSource 연결 해제
    if (this.eventSource) {
      this.eventSource.close();
    }

    // 새 EventSource 연결
    this.eventSource = new EventSource('http://localhost:3000/api/sse');

    // 연결 이벤트 처리
    this.eventSource.onopen = () => {
      console.log('[팩트체커] SSE 연결 성공');
    };

    // 메시지 이벤트 처리
    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] SSE 메시지 수신:', data);
        
        switch (data.eventType) {
          case 'verification_complete':
            console.log('[팩트체커] 검증 완료 메시지 수신:', data);
            this.showResult(data);
            break;
          case 'verification_error':
            console.log('[팩트체커] 검증 오류 메시지 수신:', data);
            this.showError(data.error);
            break;
          default:
            console.log('[팩트체커] 알 수 없는 메시지 타입:', data.eventType);
        }
      } catch (error) {
        console.error('[팩트체커] SSE 메시지 처리 오류:', error);
      }
    };

    // 오류 이벤트 처리
    this.eventSource.onerror = (error) => {
      console.error('[팩트체커] SSE 연결 오류:', error);
      // 3초 후 재연결 시도
      setTimeout(() => this.setupEventSource(), 3000);
    };
  }

  showResult(data) {
    console.log('[팩트체커] 결과 표시 시작:', data);
    this.currentResult = data;
    const { summary, visualStyle } = data;

    const html = `
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
          <span class="material-icons" style="color: ${visualStyle.color}; font-size: 24px; margin-right: 10px;">
            ${visualStyle.icon}
          </span>
          <div>
            <div style="font-size: 24px; font-weight: bold; color: ${visualStyle.color};">
              ${Math.round(summary.trustScore)}%
            </div>
            <div style="font-size: 14px; color: #666;">
              신뢰도 점수
            </div>
          </div>
        </div>
        
        <div style="margin-bottom: 15px;">
          <div style="font-weight: bold; margin-bottom: 5px;">판정 결과:</div>
          <div style="padding: 8px; background: ${visualStyle.color}20; border-radius: 4px; color: ${visualStyle.color};">
            ${summary.verdict}
          </div>
        </div>
        
        ${summary.mainPoints.length > 0 ? `
          <div style="margin-bottom: 15px;">
            <div style="font-weight: bold; margin-bottom: 5px;">주요 분석:</div>
            <ul style="margin: 0; padding-left: 20px;">
              ${summary.mainPoints.map(point => `
                <li style="margin-bottom: 5px; font-size: 14px; color: #333;">${point}</li>
              `).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;

    this.overlayContainer.innerHTML = html;
    this.overlayContainer.style.display = 'block';
    console.log('[팩트체커] 결과 표시 완료');
  }

  showError(error) {
    console.log('[팩트체커] 오류 표시:', error);
    const html = `
      <div style="padding: 20px;">
        <div style="display: flex; align-items: center; margin-bottom: 15px;">
          <span class="material-icons" style="color: #F44336; font-size: 24px; margin-right: 10px;">
            error
          </span>
          <div style="font-size: 16px; font-weight: bold; color: #F44336;">
            팩트체크 오류
          </div>
        </div>
        <div style="font-size: 14px; color: #666;">
          ${error}
        </div>
      </div>
    `;

    this.overlayContainer.innerHTML = html;
    this.overlayContainer.style.display = 'block';
  }

  hide() {
    this.overlayContainer.style.display = 'none';
  }
}

// Material Icons 스타일시트 추가
const linkElement = document.createElement('link');
linkElement.rel = 'stylesheet';
linkElement.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
document.head.appendChild(linkElement);

// 오버레이 인스턴스 생성
const factCheckOverlay = new FactCheckOverlay();

// 검증 요청 시 호출할 함수
window.requestFactCheck = () => {
  // 아무것도 표시하지 않음
  console.log('[팩트체커] 검증 요청됨');
}; 