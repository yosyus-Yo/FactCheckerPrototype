/**
 * FactChecker 콘텐츠 스크립트
 * 미디어 콘텐츠 인식 및 주장 감지 모듈
 */
class ContentRecognitionModule {
  constructor() {
    this.isActive = false;
    this.detectedClaims = [];
    this.verifiedClaims = [];
    this.serverUrl = 'http://localhost:3000';
    this.captionTexts = new Set(); // 이미 처리한 자막 텍스트 캐싱
    this.screenStream = null; // 화면 공유 스트림
    this.captureInterval = null; // 캡처 주기
    this.processedClaims = new Set(); // 처리된 주장 저장용 세트
    this.overlayId = 'factchecker-overlay';
    this.loaderClass = 'factchecker-loader';
    this.config = {
      apiHost: this.serverUrl
    };
    this.loadFactCheckerDependencies(); // 의존성 로드
    this.setupListeners();
    console.log('FactChecker 콘텐츠 스크립트 초기화됨');
    this.checkApiStatus();
  }

  // 필요한 의존성 스크립트 로드
  loadFactCheckerDependencies() {
    // 전역 스타일 추가
    const style = document.createElement('style');
    style.textContent = `
      @keyframes factchecker-popup {
        0% { opacity: 0; transform: translateY(-20px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      
      @keyframes factchecker-progress {
        0% { width: 0; }
        100% { width: 100%; }
      }
      
      /* 검증 오버레이 스타일 */
      #factchecker-news-overlay {
        position: fixed;
        top: 20px;
        right: 20px;
        max-width: 90vw;
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        border-radius: 12px;
        z-index: 9999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        overflow: hidden;
        animation: factchecker-popup 0.3s ease-out;
        border: 1px solid rgba(0,0,0,0.1);
      }
    `;
    document.head.appendChild(style);
    
    console.log('[디버그] FactChecker 의존성 로드 완료');
  }

  setupListeners() {
    // 확장 프로그램과의 통신 설정
    try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[디버그] 콘텐츠 스크립트 메시지 수신:', message);
      
      if (message.action === 'activate') {
        this.activate();
        sendResponse({ success: true });
      } else if (message.action === 'deactivate') {
        this.deactivate();
        sendResponse({ success: true });
      } else if (message.action === 'getStatus') {
        sendResponse({
          isActive: this.isActive,
          detectedClaims: this.detectedClaims.length,
          verifiedClaims: this.verifiedClaims.length
        });
      } else if (message.action === 'verifyNewsContent') {
          console.log('[디버그] verifyNewsContent 액션 수신됨');
        this.verifyNewsContent();
        sendResponse({ success: true });
      } else if (message.action === 'newsVerificationResults') {
          console.log('[디버그] newsVerificationResults 액션 수신됨:', message.results);
        this.showNewsVerificationOverlay(message.results);
        sendResponse({ success: true });
        } else {
          console.log('[디버그] 처리되지 않은 액션:', message.action);
          sendResponse({ success: false, message: '지원되지 않는 액션입니다.' });
      }
      return true; // 비동기 응답 가능하도록 true 반환
    });

      console.log('[디버그] 메시지 리스너가 성공적으로 등록되었습니다.');
    } catch (error) {
      console.error('[오류] 메시지 리스너 등록 실패:', error);
    }

    // 페이지 언로드 시 정리
    window.addEventListener('beforeunload', () => {
      this.deactivate();
    });
    
    // 확장 프로그램 컨텍스트 변경 감지
    try {
      // chrome.runtime 객체가 존재하는지 확인
      if (chrome && chrome.runtime) {
        // onInstalled는 백그라운드 스크립트에서만 동작하므로 제거
        
        // chrome.runtime.connect를 통한 핑/퐁 연결 설정 (컨텍스트 유효성 확인용)
        this.setupConnectionMonitor();
      } else {
        console.warn('[경고] chrome.runtime 객체를 찾을 수 없습니다.');
      }
    } catch (error) {
      console.error('[오류] 확장 프로그램 이벤트 리스너 설정 실패:', error);
    }
  }

  // 확장 프로그램 연결 모니터링 설정
  setupConnectionMonitor() {
    try {
      // chrome.runtime 확인
      if (!chrome || !chrome.runtime) {
        console.warn('[경고] chrome.runtime을 찾을 수 없어 연결 모니터링을 설정할 수 없습니다.');
        return;
      }
      
      // 이미 설정된 경우 중복 설정 방지
      if (this.connectionPort) {
        return;
      }
      
      // 배경 스크립트와의 연결 설정 (try-catch로 감싸기)
      try {
        this.connectionPort = chrome.runtime.connect({ name: 'factchecker-connection-monitor' });
        
        // 연결 끊김 감지
        this.connectionPort.onDisconnect.addListener(() => {
          console.warn('[디버그] 배경 스크립트와의 연결이 끊어졌습니다.');
          this.connectionPort = null;
          
          // 검증 중인 상태라면 실패 처리
          if (this.verificationState && this.verificationState.isVerifying) {
            this.showErrorOverlay('확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침 후 다시 시도해주세요.');
            clearInterval(this.verificationTimer);
            this.verificationState.isVerifying = false;
          }
        });
        
        // 메시지 수신 리스너
        this.connectionPort.onMessage.addListener((message) => {
          if (message && message.type === 'ping') {
            this.connectionPort.postMessage({ type: 'pong' });
          }
        });
        
        console.log('[디버그] 배경 스크립트와 연결 모니터링이 설정되었습니다.');
      } catch (connectError) {
        console.error('[오류] 연결 포트 설정 실패:', connectError);
      }
    } catch (error) {
      console.error('[오류] 연결 모니터링 설정 실패:', error);
    }
  }

  async activate() {
    if (this.isActive) return;
    
    this.isActive = true;
    this.createOverlay();
    
    // 화면 공유 시작
    await this.startScreenCapture();
    
    // 현재 사이트에 맞는 미디어 처리 시작
    if (window.location.hostname.includes('youtube.com')) {
      this.startYouTubeProcessing();
    } else if (window.location.hostname.includes('naver.com')) {
      this.startNaverTVProcessing();
    } else if (window.location.hostname.includes('kakao.com')) {
      this.startKakaoTVProcessing();
    }
    
    console.log('FactChecker 활성화됨');
  }

  deactivate() {
    if (!this.isActive) return;
    
    this.isActive = false;
    this.removeOverlay();
    this.disconnectObservers();
    this.stopScreenCapture();
    console.log('FactChecker 비활성화됨');
  }

  // MutationObserver 정리
  disconnectObservers() {
    if (this.captionObserver) {
      this.captionObserver.disconnect();
      this.captionObserver = null;
    }
  }

  /**
   * 스크린 캡처 시작
   * YouTube API 대신 navigator.mediaDevices 사용
   */
  async startScreenCapture() {
    try {
      if (this.isCapturing) {
        console.log('이미 화면 캡처가 진행 중입니다.');
        return;
      }

      console.log('화면 캡처 시작 중...');
      
      // 화면 공유 권한 요청
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never',
          displaySurface: 'browser',
          // 해상도 제한으로 성능 개선
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { max: 5 }
        },
        audio: false
      });
      
      // 비디오 요소 생성
      this.videoElement = document.createElement('video');
      this.videoElement.srcObject = this.stream;
      this.videoElement.style.display = 'none'; // 화면에 표시하지 않음
      document.body.appendChild(this.videoElement);
      
      // 비디오 요소 로드 완료 대기
      await new Promise((resolve) => {
        this.videoElement.onloadedmetadata = () => {
          this.videoElement.play();
          resolve();
        };
      });
      
      console.log('화면 캡처가 시작되었습니다.');
      this.isCapturing = true;
      
      // 프레임 캡처 간격 설정 (5초마다 캡처로 변경)
      this.captureInterval = setInterval(() => {
        this.captureFrame();
      }, 5000);
      
      // 사용자가 화면 공유를 중단했을 때 처리
      this.stream.getVideoTracks()[0].onended = () => {
        this.stopScreenCapture();
      };
      
    } catch (error) {
      console.error('화면 캡처 시작 오류:', error);
      this.isCapturing = false;
    }
  }

  /**
   * 스크린 캡처 중지
   */
  stopScreenCapture() {
    try {
      if (!this.isCapturing) {
        return;
      }
      
      console.log('화면 캡처 중지 중...');
      
      // 캡처 간격 타이머 해제
      if (this.captureInterval) {
        clearInterval(this.captureInterval);
        this.captureInterval = null;
      }
      
      // 비디오 스트림 트랙 중지
      if (this.stream) {
        this.stream.getTracks().forEach(track => track.stop());
        this.stream = null;
      }
      
      // 비디오 요소 제거
      if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.srcObject = null;
        document.body.removeChild(this.videoElement);
        this.videoElement = null;
      }
      
      this.isCapturing = false;
      console.log('화면 캡처가 중지되었습니다.');
      
    } catch (error) {
      console.error('화면 캡처 중지 오류:', error);
    }
  }

  /**
   * 현재 프레임 캡처 및 서버로 전송
   */
  captureFrame() {
    try {
      if (!this.isCapturing || !this.videoElement) {
        return;
      }
      
      // 캔버스 생성 및 크기 설정 (크기 축소)
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      // 원본 크기에서 50% 축소
      const scale = 0.5;
      canvas.width = this.videoElement.videoWidth * scale;
      canvas.height = this.videoElement.videoHeight * scale;
      
      // 비디오 현재 프레임을 캔버스에 그리기
      context.drawImage(this.videoElement, 0, 0, canvas.width, canvas.height);
      
      // 캔버스에서 이미지 데이터 추출 (JPEG 포맷, 50% 품질로 축소)
      const imageData = canvas.toDataURL('image/jpeg', 0.5);
      
      // 서버로 이미지 데이터 전송
      this.sendFrameToServer(imageData);
      
    } catch (error) {
      console.error('프레임 캡처 오류:', error);
    }
  }

  /**
   * 캡처된 프레임을 서버로 전송
   */
  async sendFrameToServer(imageData) {
    try {
      console.log('서버로 프레임 전송 시작...');
      
      // 서버 URL 설정
      const serverUrl = 'http://localhost:3000';
      const endpoint = '/api/frames/analyze';
      
      // 요청 설정
      const requestOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ imageData })
      };
      
      // 서버에 요청 전송
      const response = await fetch(`${serverUrl}${endpoint}`, requestOptions);
      
      // 응답 처리
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`서버 응답 오류 (${response.status}): ${errorText}`);
        return { success: false, error: `서버 응답 오류: ${response.status}` };
      }
      
      // 응답 데이터 파싱
      const result = await response.json();
      console.log('서버 응답 데이터:', result);
      
      // 감지된 주장이 있으면 처리
      if (result.success && result.claims && result.claims.length > 0) {
        this.processClaims(result.claims); // this를 통해 객체 메서드로 호출
      } else {
        console.log('서버에서 감지된 주장이 없습니다');
      }
      
      return { success: true, data: result };
    } catch (error) {
      console.error('프레임 전송 오류:', error);
      return { success: false, error: error.message };
    }
  }

  createOverlay() {
    // 기존 오버레이 제거
    this.removeOverlay();
    
    // AR 오버레이 컨테이너 생성
    const overlayContainer = document.createElement('div');
    overlayContainer.id = this.overlayId;
    document.body.appendChild(overlayContainer);
  }

  removeOverlay() {
    const overlay = document.getElementById(this.overlayId);
    if (overlay) overlay.remove();
  }

  async processTranscript(text) {
    if (!this.isActive || !text || text.trim().length < 10) return;
    
    // 이미 처리한 텍스트는 건너뛰기
    const normalizedText = text.trim();
    if (this.captionTexts.has(normalizedText)) return;
    
    // 처리한 텍스트 기록
    this.captionTexts.add(normalizedText);
    
    try {
      console.log('처리 중인 텍스트:', normalizedText);
      
      // 서버에 트랜스크립트 전송하여 주장 감지 및 검증 요청
      const response = await fetch(`${this.serverUrl}/api/claims/detect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: normalizedText })
      });
      
      if (!response.ok) {
        console.error('API 오류:', response.status);
        return;
      }
      
      const data = await response.json();
      
      if (data.claims && data.claims.length > 0) {
        console.log('감지된 주장:', data.claims);
        this.detectedClaims = [...this.detectedClaims, ...data.claims];
        await this.verifyClaims(data.claims);
      }
    } catch (error) {
      console.error('트랜스크립트 처리 오류:', error);
    }
  }

  async verifyClaims(claims) {
    if (!this.isActive || !claims || !claims.length) return;
    
    try {
      // 검출된 주장을 서버에 전송하여 검증 요청
      const response = await fetch(`${this.serverUrl}/api/claims/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ claims })
      });
      
      if (!response.ok) {
        console.error('검증 API 오류:', response.status);
        return;
      }
      
      const results = await response.json();
      
      if (results.verificationResults) {
        console.log('검증 결과:', results.verificationResults);
        this.verifiedClaims = [...this.verifiedClaims, ...results.verificationResults];
        this.displayResults(results.verificationResults);
      }
    } catch (error) {
      console.error('주장 검증 오류:', error);
    }
  }

  displayResults(results) {
    // 기존 오버레이 생성 확인
    let overlay = document.getElementById(this.overlayId);
    
    // 오버레이가 없으면 생성
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = this.overlayId;
      overlay.style.position = 'fixed';
      overlay.style.top = '20px';
      overlay.style.right = '20px';
      overlay.style.zIndex = '9999';
      overlay.style.pointerEvents = 'none'; // 클릭 통과
      document.body.appendChild(overlay);
    }
    
    results.forEach((result, index) => {
      // AR 형태로 결과 표시
      const resultElement = document.createElement('div');
      resultElement.className = 'factcheck-result';
      
      // 위치 조정 (겹치지 않도록)
      resultElement.style.marginBottom = '20px';
      resultElement.style.position = 'relative';
      
      // 신뢰도에 따른 색상 결정
      let color = '#FFC107'; // 기본: 노란색 (부분적 사실)
      let verdict = '부분적 사실';
      
      if (result.truthScore >= 0.8) {
        color = '#4CAF50'; // 녹색 (사실)
        verdict = '사실';
      } else if (result.truthScore <= 0.3) {
        color = '#F44336'; // 빨간색 (허위)
        verdict = '허위';
      }
      
      // 결과 텍스트 생성
      const claimText = result.claim?.text || '';
      const truncatedClaim = claimText.length > 80 
        ? claimText.substring(0, 80) + '...' 
        : claimText;
      
      resultElement.innerHTML = `
        <div class="result-card" style="background-color: ${color}; opacity: 0.95; padding: 15px; border-radius: 8px; box-shadow: 0 4px 8px rgba(0,0,0,0.2); color: white; max-width: 350px; font-family: Arial, sans-serif;">
          <div class="claim" style="font-size: 14px; margin-bottom: 8px;">${truncatedClaim}</div>
          <div class="score" style="font-size: 12px; display: flex; justify-content: space-between;">
            <strong>판정: ${verdict}</strong>
            <span>신뢰도: ${Math.round(result.truthScore * 100)}%</span>
          </div>
        </div>
      `;
      
      overlay.appendChild(resultElement);
      
      // 8초 후 자동으로 사라지게 함
      setTimeout(() => {
        if (resultElement.parentNode) {
          resultElement.remove();
        }
      }, 8000);
    });
  }

  // 유튜브 전용 처리 함수
  startYouTubeProcessing() {
    console.log('유튜브 비디오 처리 시작');
    
    // 1. 비디오 제목과 설명에서 주장 감지
    setTimeout(() => {
      this.processYouTubeMetadata();
    }, 1500);
    
    // 2. 자막 감지 및 처리
    this.observeYouTubeCaptions();
  }
  
  observeYouTubeCaptions() {
    // 이전 옵저버 제거
    if (this.captionObserver) {
      this.captionObserver.disconnect();
    }
    
    // 자막 요소 관찰 (발견 시 텍스트 추출)
    this.captionObserver = new MutationObserver((mutations) => {
      if (!this.isActive) return;
      
      for (const mutation of mutations) {
        // 새로 추가된 노드가 있는 경우만 처리
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // 자막 텍스트 노드 찾기
          const captionTexts = document.querySelectorAll('.ytp-caption-segment');
          for (const captionNode of captionTexts) {
            const text = captionNode.textContent.trim();
            if (text && text.length > 10) {
              this.processTranscript(text);
            }
          }
        }
      }
    });
    
    // 옵저버 시작 - 자막 컨테이너 감시
    const startObserver = () => {
      // 자막 컨테이너 찾기 (여러 선택자 시도)
      const captionContainers = [
        document.querySelector('.ytp-caption-window-container'),
        document.querySelector('.captions-text'),
        document.querySelector('.ytp-subtitles-player-content')
      ];
      
      // 찾은 첫 번째 컨테이너에 옵저버 연결
      for (const container of captionContainers) {
        if (container) {
          this.captionObserver.observe(container, {
            childList: true,
            subtree: true,
            characterData: true
          });
          console.log('유튜브 자막 관찰 시작:', container);
          return;
        }
      }
      
      // 컨테이너를 찾지 못했으면 나중에 다시 시도
      if (this.isActive) {
        setTimeout(startObserver, 1000);
      }
    };
    
    // 자막 관찰 시작
    startObserver();
  }
  
  processYouTubeMetadata() {
    // 비디오 제목과 설명 추출 (여러 선택자 시도)
    const titleSelectors = [
      'h1.ytd-video-primary-info-renderer',
      'h1.title',
      '.title.ytd-video-primary-info-renderer',
      '.title'
    ];
    
    const descriptionSelectors = [
      '#description-text',
      '.ytd-expanded-shelf-contents-renderer',
      '.content.ytd-video-secondary-info-renderer',
      '.description'
    ];
    
    // 제목 추출 시도
    for (const selector of titleSelectors) {
      const titleElement = document.querySelector(selector);
      if (titleElement && titleElement.textContent) {
        this.processTranscript(titleElement.textContent);
        break;
      }
    }
    
    // 설명 추출 시도
    for (const selector of descriptionSelectors) {
      const descriptionElement = document.querySelector(selector);
      if (descriptionElement && descriptionElement.textContent) {
        this.processTranscript(descriptionElement.textContent);
        break;
      }
    }
  }

  // 네이버 TV 전용 처리 함수
  startNaverTVProcessing() {
    console.log('네이버 TV 처리 시작');
    
    // 안전하게 선택자 시도
    const safeProcessElement = (selector) => {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        this.processTranscript(element.textContent);
      }
    };
    
    // 제목과 설명에서 주장 감지
    safeProcessElement('.video_info .title');
    safeProcessElement('.video_info .description');
    safeProcessElement('.video_title');
    safeProcessElement('.detail_info');
    
    // 추가 콘텐츠 로딩 대기 후 처리
    setTimeout(() => {
      safeProcessElement('.video_summary');
      safeProcessElement('.comment_text');
    }, 2000);
  }

  // 카카오 TV 전용 처리 함수
  startKakaoTVProcessing() {
    console.log('카카오 TV 처리 시작');
    
    // 안전하게 선택자 시도
    const safeProcessElement = (selector) => {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        this.processTranscript(element.textContent);
      }
    };
    
    // 제목과 설명에서 주장 감지
    safeProcessElement('.tit_program');
    safeProcessElement('.desc_program');
    safeProcessElement('.area_tag');
    
    // 추가 콘텐츠 로딩 대기 후 처리
    setTimeout(() => {
      safeProcessElement('.desc_detail');
      safeProcessElement('.inner_profile');
    }, 2000);
  }

  // 서버로부터 받은 주장 처리
  processClaims(claims) {
    if (!claims || !Array.isArray(claims) || claims.length === 0) {
      return;
    }
    
    console.log(`총 ${claims.length}개의 주장 처리 중...`);
    
    // 캐시 확인 및 처리된 주장 필터링
    const newClaims = claims.filter(claim => {
      // claim에 text가 없는 경우 기본값 제공
      const claimText = claim.text || '내용 없음';
      const confidence = claim.confidence || 0;
      const claimKey = `${claimText}-${confidence}`;
      
      // 이미 처리된 주장인지 확인
      if (this.processedClaims.has(claimKey)) {
        console.log('이미 처리된 주장:', claimText);
        return false;
      }
      
      // 처리된 주장으로 표시
      this.processedClaims.add(claimKey);
      return true;
    });
    
    if (newClaims.length > 0) {
      console.log(`${newClaims.length}개의 새로운 주장 처리 중...`);
      
      // 검증 결과가 있으면 표시
      newClaims.forEach(claim => {
        // 임시 검증 결과 생성 (실제로는 서버에서 제공해야 함)
        const tempResult = {
          claim: claim,
          truthScore: claim.confidence || 0.5,
          sources: claim.sources || []
        };
        
        // 결과 표시
        this.displayResults([tempResult]);
      });
    } else {
      console.log('새로운 주장이 없습니다.');
    }
  }

  /**
   * Readability 라이브러리 로드
   */
  async loadReadabilityLibrary() {
    return new Promise((resolve, reject) => {
      if (window.Readability) {
        console.log('[디버그] Readability 라이브러리가 이미 로드되어 있습니다.');
        resolve(window.Readability);
        return;
      }
      
      console.log('[디버그] Readability 라이브러리 로드 중...');
      
      try {
        // 직접 Readability 코드 삽입
        const readabilityScript = document.createElement('script');
        readabilityScript.textContent = `
          /* @license
             Readability - https://github.com/mozilla/readability/blob/main/Readability.js
             License: Apache License 2.0
          */
          (function(global, factory) {
            typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
            typeof define === 'function' && define.amd ? define(factory) :
            (global = global || self, global.Readability = factory());
          }(this, function() { 'use strict';
          
            function Readability(doc, options) {
              // ... 여기에 Readability 코드 추가 ...
              // 실제 제품에서는 전체 Readability 코드를 삽입해야 함
              // 예제에서는 간단한 버전으로 구현
              this.parse = function() {
                try {
                  // 기본 추출 로직
                  const title = document.title || document.querySelector("h1")?.textContent || "";
                  let content = "";
                  
                  // 본문으로 추정되는, 가장 텍스트가 많은 부분 찾기
                  const contentSelectors = [
                    "article", ".article", ".article-body", "[itemprop='articleBody']",
                    ".news-content", ".content-body", "#article-body", ".story-body"
                  ];
                  
                  // 가장 많은 텍스트를 포함하는 요소 찾기
                  let bestElement = null;
                  let maxTextLength = 0;
                  
                  for (const selector of contentSelectors) {
                    const elements = document.querySelectorAll(selector);
                    for (const el of elements) {
                      const textLength = el.textContent.trim().length;
                      if (textLength > maxTextLength) {
                        maxTextLength = textLength;
                        bestElement = el;
                      }
                    }
                  }
                  
                  // 베스트 요소가 없으면 단락들 결합
                  if (!bestElement) {
                    const paragraphs = Array.from(document.querySelectorAll("p"))
                      .filter(p => p.textContent.trim().length > 20)
                      .map(p => p.textContent.trim());
                    
                    content = paragraphs.join("\\n\\n");
                    
                    if (content.length < 200) {
                      content = document.body.textContent.substring(0, 10000);
                    }
                  } else {
                    content = bestElement.textContent;
                  }
                  
                  // 콘텐츠에서 발췌 생성
                  const excerpt = content.substring(0, 200).trim() + "...";
      
      return {
                    title: title,
                    content: content,
                    textContent: content,
                    excerpt: excerpt,
                    length: content.length
                  };
                } catch (e) {
                  console.error("[Readability] 파싱 오류:", e);
                  return null;
                }
              };
            }
            
            return Readability;
          }));
        `;
        
        document.head.appendChild(readabilityScript);
        console.log('[디버그] Readability 라이브러리 로드 완료');
        resolve(window.Readability);
      } catch (error) {
        console.error('[오류] Readability 라이브러리 로드 실패:', error);
        reject(error);
      }
    });
  }

  /**
   * 뉴스 웹사이트에서 기사 내용 추출
   * @returns {Promise<object>} 추출된 뉴스 데이터
   */
  async extractNewsContent() {
    try {
      console.log('뉴스 콘텐츠 추출 시작...');
      const startTime = performance.now();
      
      let title = '';
      let content = '';
      let excerpt = '';
      
      // 사이트별 특화 선택자
      const selectors = {
        'news.naver.com': {
          title: '#title_area span, #articleTitle, h2.end_tit',
          content: '#dic_area, #articeBody, #newsEndContents',
          excerpt: '.media_end_summary, .article_summary, .articlebox2'
        },
        'news.daum.net': {
          title: '.tit_view',
          content: '.article_view',
          excerpt: '.summary, .desc_conclusion'
        },
        'yna.co.kr': {
          title: '.tit-article',
          content: '.article, .story-news',
          excerpt: '.sub-head'
        },
        'yonhapnews.co.kr': {
          title: '.tit-article',
          content: '.article',
          excerpt: '.sub-head'
        },
        'chosun.com': {
          title: '.article-header h1, h1.news-title, h1.title, .article-tit, #news_title_text_id',
          content: '.article-body, .news-content, .article, .article-text, #news_body_id, #articleBody',
          excerpt: '.article-summary, .news-summary, .summary-lead'
        },
        'biz.chosun.com': {
          title: '.article-header h1, h1.news-title, h1.title, .article-tit, #news_title_text_id',
          content: '.article-body, .news-content, .article, .article-text, #news_body_id, #articleBody',
          excerpt: '.article-summary, .news-summary, .summary-lead'
        },
        'hani.co.kr': {
          title: '.title, .article-title',
          content: '.article-text, .article-body, .article-contents, .article-content',
          excerpt: '.article-subtitle, .subtitle'
        },
        'kmib.co.kr': {
          title: '.headline, .nwstitbox h1',
          content: '#articleBody, .nwstxt, .article-body',
          excerpt: '.sum_n, .article-summary'
        },
        'khan.co.kr': {
          title: '.headline, .article-tit',
          content: '.art_body, .article_txt, .article-txt',
          excerpt: '.al_tit, .article-lead'
        },
        'mk.co.kr': {
          title: '.top_title, .news_ttl, .article_head h1',
          content: '.art_txt, #article_body, .article_content',
          excerpt: '.subhead_text, .article_summary'
        },
        'mt.co.kr': {
          title: '.headline-title, .article_head h1',
          content: '.article_content, .article-body',
          excerpt: '.article_head_summary, .article-summary'
        },
        'sedaily.com': {
          title: '.article_head h1, .article-title',
          content: '#contents, .article_view, .article-content',
          excerpt: '.article_summary, .sub-title'
        },
        'donga.com': {
          title: '.title, .article_title h1',
          content: '.article_txt, #article_content',
          excerpt: '.subtitle, .article-summary'
        },
        'joongang.co.kr': {
          title: '.headline, .article_title',
          content: '.article_body, .article_content',
          excerpt: '.key_paragraph, .article_summary'
        },
        'hankyung.com': {
          title: '.title, .news-title',
          content: '.news-body, .article-body',
          excerpt: '.lead-paragraph, .article-summary'
        },
        'sbs.co.kr': {
          title: '.news-title, .article-title-text',
          content: '.news-cont-article, .news-article-content',
          excerpt: '.news-summary, .article-summary'
        },
        'mbc.co.kr': {
          title: '.subject, .tit-article',
          content: '.news-body-txt, .article-body',
          excerpt: '.article-intro, .article-summary'
        },
        'kbs.co.kr': {
          title: '.title-wrap h5, .headline',
          content: '.body-txt, .news-cont',
          excerpt: '.sub-text, .news-summary'
        }
      };
      
      // 현재 호스트에 맞는 선택자 찾기
      const host = window.location.hostname;
      let siteSelectors = null;
      
      for (const site in selectors) {
        if (host.includes(site)) {
          siteSelectors = selectors[site];
          break;
        }
      }
      
      // 1. 선택자로 콘텐츠 추출 시도
      if (siteSelectors) {
        console.log('사이트 맞춤 선택자 사용:', host);
        
        // 제목 추출
        const titleElements = document.querySelectorAll(siteSelectors.title);
        if (titleElements && titleElements.length > 0) {
          title = Array.from(titleElements)
            .map(el => el.textContent.trim())
            .join(' ')
            .replace(/\s+/g, ' ');
        }
        
        // 본문 추출
        const contentElements = document.querySelectorAll(siteSelectors.content);
        if (contentElements && contentElements.length > 0) {
          content = Array.from(contentElements)
            .map(el => el.textContent.trim())
            .join('\n\n')
            .replace(/\s+/g, ' ');
        }
        
        // 요약 추출
        const excerptElements = document.querySelectorAll(siteSelectors.excerpt);
        if (excerptElements && excerptElements.length > 0) {
          excerpt = Array.from(excerptElements)
            .map(el => el.textContent.trim())
            .join('\n')
            .replace(/\s+/g, ' ');
        }
      }
      
      // 2. Readability 라이브러리 사용 (콘텐츠가 없거나 너무 짧은 경우도 시도)
      try {
        console.log('Readability 라이브러리 사용 시도');
        
        // Readability 라이브러리 로드
        await this.loadReadabilityLibrary();
        
        if (window.Readability) {
          // 현재 문서의 복제본 생성 (원본 DOM 보존)
          const documentClone = document.cloneNode(true);
          
          // Readability 파서 생성 및 실행
          const reader = new window.Readability(documentClone);
          const article = reader.parse();
          
          if (article) {
            console.log('Readability 추출 성공:', article.title);
            
            // 제목이 없거나 너무 짧으면 Readability 결과 사용
            if (!title || title.length < 10) {
              title = article.title;
            }
            
            // 콘텐츠가 없거나 너무 짧으면 Readability 결과 사용
            if (!content || content.length < article.textContent.length) {
              content = article.textContent;
            }
            
            // 요약이 없으면 Readability 발췌 사용
            if (!excerpt && article.excerpt) {
              excerpt = article.excerpt;
            }
          } else {
            console.warn('Readability가 기사를 파싱하지 못했습니다.');
          }
        }
      } catch (readabilityError) {
        console.warn('Readability 처리 오류:', readabilityError);
        // Readability 오류가 발생해도 계속 진행
      }
      
      // 3. 기본 추출 (선택자가 없거나 실패한 경우)
      if (!title) {
        console.log('일반 제목 선택자 사용');
        
        // 일반적인 뉴스 제목 선택자 시도
        const titleSelectors = [
          'h1', 'h1.title', 'h1.headline', '.title', '.headline', 
          'article h1', 'header h1', '.article-title', '.news-title',
          '[itemprop="headline"]', '.article-header h1', '.article_header h1'
        ];
        
        for (const selector of titleSelectors) {
          const titleElement = document.querySelector(selector);
        if (titleElement) {
          title = titleElement.textContent.trim();
            if (title.length > 10) {
              break;
            }
          }
        }
      }
      
      if (!content || content.length < 200) {
        console.log('일반 본문 선택자 사용');
        
        // 일반적인 뉴스 본문 선택자 시도
        const contentSelectors = [
          'article', '.article', '.article-body', '.article-content', 
          '.news-content', '.news-body', '.story-body', 
          '[itemprop="articleBody"]', '.content-body', '.news-article-content'
        ];
        
        // 본문으로 추정되는 요소들
        for (const selector of contentSelectors) {
          const articleElements = document.querySelectorAll(selector);
        if (articleElements.length > 0) {
          // 가장 텍스트가 많은 요소 선택
          let maxTextLength = 0;
          let bestElement = null;
          
            articleElements.forEach(el => {
              const textLength = el.textContent.trim().length;
            if (textLength > maxTextLength) {
              maxTextLength = textLength;
                bestElement = el;
              }
            });
            
            if (bestElement && maxTextLength > 200) {
              content = bestElement.textContent.trim().replace(/\s+/g, ' ');
              break;
            }
          }
        }
      }
      
      // 4. 콘텐츠가 여전히 없으면 단락(p 태그) 기반 추출
      if (!content || content.length < 200) {
        console.log('콘텐츠 없음, p 태그 기반 추출 시도');
        
        // 기사의 콘텐츠 영역으로 추정되는 요소 찾기
        const contentContainers = [
          ...document.querySelectorAll('article'),
          ...document.querySelectorAll('.article'),
          ...document.querySelectorAll('main'),
          ...document.querySelectorAll('#content'),
          ...document.querySelectorAll('.content')
        ];
        
        // 가장 많은 단락을 포함하는 컨테이너 찾기
        let bestContainer = document.body;
        let maxParagraphs = 0;
        
        for (const container of contentContainers) {
          const paragraphs = container.querySelectorAll('p');
          if (paragraphs.length > maxParagraphs) {
            maxParagraphs = paragraphs.length;
            bestContainer = container;
          }
        }
        
        // 선택된 컨테이너에서 단락 추출
        const paragraphs = bestContainer.querySelectorAll('p');
        
        if (paragraphs.length > 0) {
          // 단락 추출 (20자 이상의 유효한 단락)
          const validParagraphs = Array.from(paragraphs)
            .filter(p => {
              const text = p.textContent.trim();
              // 너무 짧은 텍스트 무시
              if (text.length < 20) return false;
              // 캡션, 인용구, 저작권 정보 등 제외
              if (p.classList.contains('caption') || 
                  p.classList.contains('figcaption') || 
                  p.parentElement.tagName === 'FIGCAPTION' ||
                  p.classList.contains('copyright') ||
                  p.classList.contains('byline')) {
                return false;
              }
              return true;
            })
            .map(p => p.textContent.trim());
          
          if (validParagraphs.length > 0) {
            content = validParagraphs.join('\n\n');
          }
        }
      }
      
      // 5. Firefox Reader View API 추출 시도 (모든 방법이 실패한 경우)
      if (!content || content.length < 100) {
        try {
          console.log('Firefox Reader View API 추출 시도');
          
          // Firefox Reader View API 직접 사용 (별도 스크립트 없이)
          const readerConfig = {
            maxElemsToParse: 1000,
            nbTopCandidates: 5,
            charThreshold: 500
          };
          
          // DOM 복제
          const docClone = document.cloneNode(true);
          
          // Firefox Reader API와 유사한 방식으로 구현
          function getMainContent(doc) {
            // 콘텐츠 후보 요소 선택
            const contentElements = doc.querySelectorAll('article, [role="main"], main, .article, .content, .main, #content, #main');
            
            // 가장 내용이 많은 요소 찾기
            let bestElement = null;
            let maxLength = 0;
            
            contentElements.forEach(el => {
              const text = el.textContent.trim();
              if (text.length > maxLength) {
                maxLength = text.length;
                bestElement = el;
              }
            });
            
            // 후보가 없으면 body 전체 사용
            return bestElement || doc.body;
          }
          
          const mainContent = getMainContent(docClone);
          if (mainContent && mainContent.textContent.length > 200) {
            content = mainContent.textContent
              .replace(/\s+/g, ' ')
              .trim();
          }
        } catch (readerError) {
          console.warn('Firefox Reader View API 추출 오류:', readerError);
        }
      }
      
      // 최후의 방법: 문서에서 유의미한 텍스트 추출
      if (!content || content.length < 100) {
        console.log('모든 추출 방법 실패, 문서 전체 텍스트 사용');
        
        // body에서 스크립트, 스타일 등 제외하고 텍스트 추출
        const bodyClone = document.body.cloneNode(true);
        
        // 비콘텐츠 요소 제거
        const nonContentSelectors = [
          'script', 'style', 'nav', 'header', 'footer', 'aside', 
          '.nav', '.menu', '.sidebar', '.footer', '.header', '.comment',
          '.advertisement', '.ad', '.social', '.sharing', '.related', '.recommendation'
        ];
        
        nonContentSelectors.forEach(selector => {
          const elements = bodyClone.querySelectorAll(selector);
          elements.forEach(el => el.remove());
        });
        
        content = bodyClone.textContent
          .replace(/\s+/g, ' ')
          .trim()
          .substring(0, 10000);
      }
      
      // 텍스트 정리
      title = title || document.title;
      
      // 콘텐츠 길이 확인
      const extractionTime = ((performance.now() - startTime) / 1000).toFixed(2);
      console.log(`추출된 콘텐츠 - 제목: ${title.length}자, 본문: ${content.length}자 (추출 시간: ${extractionTime}초)`);
      
      // 결과 반환
      return {
        title: title,
        content: content,
        excerpt: excerpt,
        url: window.location.href
      };
    } catch (error) {
      console.error('뉴스 추출 오류:', error);
      
      // 최소한의 정보만 반환
      return {
        title: document.title,
        content: document.body.textContent.substring(0, 5000), // 너무 길지 않게 제한
        excerpt: '',
        url: window.location.href
      };
    }
  }

  /**
   * 뉴스 검증 중임을 표시하는 오버레이
   */
  showVerifyingOverlay() {
    console.log('[디버그] 검증 중 오버레이 표시');
    
    // 이전 오버레이 제거
    this.removeNewsOverlay();
    
    const overlay = document.createElement('div');
    overlay.id = 'factchecker-news-overlay';
    overlay.className = 'factchecker-verifying-overlay'; // 클래스 추가
    
    // 간결하고 작은 크기의 로딩 오버레이 스타일
    overlay.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      width: 300px;
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      border-radius: 12px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      overflow: hidden;
      animation: factchecker-popup 0.3s ease-out;
      border: 1px solid rgba(0,0,0,0.1);
      transition: opacity 0.3s ease, transform 0.3s ease;
    `;
    
    // 간결한 내용으로 업데이트
    overlay.innerHTML = `
      <div style="padding: 16px; position: relative;">
        <button class="factchecker-close-btn" style="
          background: transparent;
      border: none;
          color: #5f6368;
          font-size: 18px;
      cursor: pointer;
          padding: 0;
          position: absolute;
          top: 8px;
          right: 8px;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
        ">×</button>
        
        <div style="display: flex; align-items: center; margin-bottom: 12px;">
          <div class="factchecker-loading-spinner" style="
            width: 20px;
            height: 20px;
            border: 2px solid rgba(66, 133, 244, 0.2);
            border-top: 2px solid #4285F4;
            border-radius: 50%;
            margin-right: 12px;
            animation: spin 1s linear infinite;
          "></div>
          <div style="font-weight: 500; font-size: 15px; color: #202124;">FactChecker 검증 중</div>
        </div>
        
        <p class="factchecker-verifying-message" style="
          margin: 0;
          font-size: 13px;
          color: #5f6368;
        ">뉴스 콘텐츠 검증 중입니다...</p>
        
        <div class="factchecker-verification-result" style="
          display: none;
          margin-top: 8px;
          padding: 8px;
          background: #f8f9fa;
          border-radius: 8px;
          font-size: 13px;
        ">
          <div class="verification-status" style="font-weight: 500;">판정 결과:</div>
          <div class="verification-progress">검증 진행 중...</div>
        </div>
      </div>
    `;
    
    // 애니메이션 스타일 추가
    const style = document.createElement('style');
    style.textContent = `
      @keyframes factchecker-popup {
        0% { opacity: 0; transform: translateY(-20px); }
        100% { opacity: 1; transform: translateY(0); }
      }
      
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(overlay);
    
    // 닫기 버튼 이벤트
    const closeButton = overlay.querySelector('.factchecker-close-btn');
    closeButton.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      // 검증 타이머 중지
      if (this.verificationTimer) {
        clearInterval(this.verificationTimer);
        this.verificationTimer = null;
      }
      
      // 검증 상태 초기화
      if (this.verificationState) {
        this.verificationState.isVerifying = false;
      }
      
      this.removeNewsOverlay();
    });
    
    // 결과 영역 표시
    const resultArea = overlay.querySelector('.factchecker-verification-result');
    if (resultArea) {
      resultArea.style.display = 'block';
    }
  }

  /**
   * 검증 중 오버레이 제거
   */
  removeVerifyingOverlay() {
    console.log('[디버그] 검증 중 오버레이 제거');
    const overlay = document.querySelector('.factchecker-verifying-overlay');
    if (overlay) {
      overlay.style.opacity = '0';
      overlay.style.transform = 'translateY(-10px)';
      
      setTimeout(() => {
        if (overlay.parentNode) {
          overlay.parentNode.removeChild(overlay);
        }
      }, 300);
    }
  }

  /**
   * 검증 중 메시지 업데이트
   */
  updateVerifyingOverlay(message) {
    console.log('[디버그] 검증 상태 업데이트:', message);
    const msgElement = document.querySelector('.factchecker-verifying-message');
    if (msgElement) {
      msgElement.textContent = message || '검증 진행 중입니다...';
    }
  }

  /**
   * 직접 API 호출하여 뉴스 콘텐츠 검증
   */
  async directVerifyNewsContent(newsData) {
    console.log('[디버그] 직접 API 호출 시도:', {
      url: window.location.href,
      title: newsData.title,
      contentLength: newsData.content?.length
    });
    
    try {
      // 직접 API 호출
      const response = await fetch(`${this.serverUrl}/api/verify-news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: window.location.href,
          title: newsData.title || document.title
          // content 필드 제거 - 서버에서 URL로부터 콘텐츠 추출하게 함
        })
      });
      
      // 응답 텍스트 먼저 가져오기 (디버깅 목적)
      const responseText = await response.text();
      console.log('[디버그] API 응답 텍스트:', responseText);
      
      // 응답이 json 형식이 아닌 경우 처리
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        console.error('[오류] JSON 파싱 실패:', jsonError);
        throw new Error(`JSON 파싱 실패: 서버 응답이 유효한 JSON 형식이 아닙니다. 응답: ${responseText.substring(0, 100)}...`);
      }
      
      // 응답 성공 여부 확인
      if (!response.ok) {
        // 서버에서 반환한 오류 메시지 포함
        const errorMessage = data.error || data.message || `서버 응답 오류: ${response.status} ${response.statusText}`;
        console.error('[오류] API 응답 오류:', errorMessage);
        throw new Error(errorMessage);
      }
      
      console.log('[디버그] API 응답 데이터:', data);
      
      // ClaimID 추출 (결과 추적용)
      if (data && data.data && data.data.claimId) {
        // claimId 저장
        this.currentClaimId = data.data.claimId;
        console.log('[디버그] ClaimID 저장됨:', this.currentClaimId);
        
        // 진행 상태 표시
        this.updateVerifyingOverlay(`검증 요청 완료. 결과 확인 중... (${data.data.claimId.substring(0, 8)})`);
        
        // 상태 확인 타이머 설정
        setTimeout(() => {
          this.checkVerificationStatus(data.data.claimId);
        }, 2000);
      }
      
      return data;
    } catch (error) {
      console.error('[오류] 직접 API 호출 실패:', error);
      
      // 사용자에게 보여줄 오류 메시지 생성
      let userErrorMessage = '검증 서버에 연결할 수 없습니다.';
      
      if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
        userErrorMessage = '네트워크 오류: 검증 서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요.';
      } else if (error.message.includes('JSON')) {
        userErrorMessage = '서버 응답 처리 실패: 서버가 잘못된 형식의 응답을 반환했습니다.';
      } else if (error.message.includes('400')) {
        userErrorMessage = '검증 요청 오류: 검증할 충분한 콘텐츠가 없습니다.';
      } else if (error.message.includes('500')) {
        userErrorMessage = '서버 내부 오류: 검증 서버에 문제가 발생했습니다. 나중에 다시 시도해 주세요.';
      } else if (error.message.includes('timeout')) {
        userErrorMessage = '요청 시간 초과: 서버 응답이 너무 오래 걸립니다.';
      }
      
      throw new Error(`${userErrorMessage} (${error.message})`);
    }
  }

  /**
   * 뉴스 콘텐츠 검증
   */
  async verifyNewsContent() {
    console.log('[디버그] 뉴스 콘텐츠 검증 시작');
    
    // 이미 검증 진행 중인 경우 중복 요청 방지
    if (this.verificationState && this.verificationState.isVerifying) {
      console.log('[디버그] 이미 검증이 진행 중입니다');
      this.updateVerifyingOverlay('이미 검증이 진행 중입니다. 잠시만 기다려주세요...');
      return;
    }
    
    // 현재 진행 상태 추적
    this.verificationState = {
      isVerifying: true,
      startTime: Date.now(),
      status: 'extracting',
      progress: 0
    };
    
    // 검증 중인 상태 표시
    this.showVerifyingOverlay();
    this.updateVerifyingOverlay('뉴스 콘텐츠 추출 중...');
    
    // 진행 상태 업데이트 타이머 설정
    this.verificationTimer = setInterval(() => {
      if (this.verificationState.isVerifying) {
        const elapsedTime = Date.now() - this.verificationState.startTime;
        
        // 10초 후에도 응답이 없으면 상태 메시지 업데이트
        if (elapsedTime > 10000 && this.verificationState.status === 'extracting') {
          this.verificationState.status = 'processing';
          this.updateVerifyingOverlay('콘텐츠 분석 및 검증 중...');
        }
        
        // 20초 후에도 응답이 없으면 상태 메시지 업데이트
        if (elapsedTime > 20000 && this.verificationState.status === 'processing') {
          this.verificationState.status = 'checking_sources';
          this.updateVerifyingOverlay('소스 확인 및 결과 종합 중...');
        }
        
        // 30초가 지나도 응답이 없으면 타임아웃 처리
        if (elapsedTime > 30000) {
          clearInterval(this.verificationTimer);
          this.verificationState.isVerifying = false;
          this.showErrorOverlay('검증 시간이 너무 오래 걸립니다. 잠시 후 다시 시도해주세요.');
        }
      }
    }, 1000);
    
    try {
      // 메인 콘텐츠 추출 (extractNewsContent 사용)
      const newsData = await this.extractNewsContent();
      console.log('[디버그] 추출된 뉴스 데이터:', {
        title: newsData.title,
        url: newsData.url,
        contentLength: newsData.content ? newsData.content.length : 0
      });
      
      if (!newsData.content || newsData.content.length < 100) {
        clearInterval(this.verificationTimer);
        this.verificationState.isVerifying = false;
        this.showErrorOverlay('검증할 충분한 콘텐츠가 없습니다. (최소 100자 이상 필요)');
        return;
      }
      
      this.updateVerifyingOverlay(`콘텐츠 추출 완료 (${newsData.content.length}자). 검증 요청 중...`);
      
      // 백그라운드 통신 가능 여부 확인
      const isExtensionValid = this.isExtensionContextValid();
      
      if (!isExtensionValid) {
        console.log('[디버그] 확장 프로그램 컨텍스트가 유효하지 않음. 직접 API 호출.');
        await this.handleDirectApiCall(newsData);
        return;
      }
      
      // 백그라운드 스크립트에 메시지 전송
      console.log('[디버그] 백그라운드에 검증 요청 메시지 전송 시작');
      
      // Promise 기반 메시지 전송 로직
      const sendMessagePromise = new Promise((resolve, reject) => {
        try {
          chrome.runtime.sendMessage({
            action: 'verifyNewsContent',
            data: {
              url: window.location.href,
              title: newsData.title || document.title
              // content 필드 제거 - 서버에서 URL로부터 콘텐츠 추출하게 함
            }
          }, (response) => {
            // 오류 처리
            if (chrome.runtime.lastError) {
              const error = chrome.runtime.lastError;
              console.error('[오류] 백그라운드 메시지 전송 실패:', error.message);
              reject(error);
              return;
            }
            
            console.log('[디버그] 백그라운드 응답 수신:', response);
            
            if (response && response.success) {
              resolve(response);
            } else {
              reject(new Error(response?.message || '알 수 없는 응답 오류'));
            }
          });
        } catch (error) {
          console.error('[오류] sendMessage 호출 실패:', error);
          reject(error);
        }
      });
      
      // 타임아웃 처리를 위한 Promise
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('메시지 전송 시간 초과'));
        }, 5000);
      });
      
      // Promise.race로 타임아웃 처리
      try {
        const result = await Promise.race([sendMessagePromise, timeoutPromise]);
        this.handleVerificationResults(result);
      } catch (error) {
        console.error('[오류] 메시지 처리 실패:', error.message);
        // 백그라운드 통신 실패 시 직접 API 호출
        await this.handleDirectApiCall(newsData);
      }
    } catch (error) {
      console.error('[오류] 검증 요청 중 예외 발생:', error);
      clearInterval(this.verificationTimer);
      this.verificationState.isVerifying = false;
      this.showErrorOverlay(`검증 요청 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  // 확장 프로그램 컨텍스트 유효성 확인
  isExtensionContextValid() {
    try {
      // chrome.runtime.id가 정의되어 있지 않으면 컨텍스트가 무효화된 것
      return typeof chrome.runtime.id === 'string';
    } catch (error) {
      console.error('[오류] 확장 프로그램 컨텍스트 확인 실패:', error);
      return false;
    }
  }

  // 직접 API 호출 처리
  async handleDirectApiCall(newsData) {
    console.log('[디버그] 백그라운드 통신 실패, 직접 API 호출 시도');
    try {
      const data = await this.directVerifyNewsContent(newsData);
      console.log('[디버그] 직접 API 호출 성공, 결과 처리 중');
      this.handleVerificationResults(data);
    } catch (error) {
      console.error('[오류] 직접 API 호출 실패:', error);
      clearInterval(this.verificationTimer);
      this.verificationState.isVerifying = false;
      this.showErrorOverlay(`검증 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  // 오버레이 드래그 기능 추가
  makeOverlayDraggable(overlay) {
    const header = overlay.querySelector('.factchecker-overlay-header');
    let isDragging = false;
    let offsetX, offsetY;
    
    header.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - overlay.getBoundingClientRect().left;
      offsetY = e.clientY - overlay.getBoundingClientRect().top;
      
      // 드래그 중 스타일 적용
      overlay.style.transition = 'none';
      overlay.style.cursor = 'grabbing';
    });
    
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      
      const x = e.clientX - offsetX;
      const y = e.clientY - offsetY;
      
      // 화면 경계 체크
      const maxX = window.innerWidth - overlay.offsetWidth;
      const maxY = window.innerHeight - overlay.offsetHeight;
      
      overlay.style.left = `${Math.max(0, Math.min(x, maxX))}px`;
      overlay.style.top = `${Math.max(0, Math.min(y, maxY))}px`;
      overlay.style.right = 'auto';
      overlay.style.bottom = 'auto';
    });
    
    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        overlay.style.cursor = '';
        overlay.style.transition = 'all 0.3s ease';
      }
    });
  }

  /**
   * 오류 메시지 오버레이 표시
   */
  showErrorOverlay(errorMessage) {
    console.log('[디버그] 오류 오버레이 표시:', errorMessage);
    
    // 기존 오버레이 제거
    this.removeNewsOverlay();
    
    // 오버레이 요소 생성
    const overlay = document.createElement('div');
    overlay.id = 'factchecker-news-overlay';
    
    // 스타일 설정
    overlay.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 450px;
      max-width: 90vw;
      background: rgba(255, 243, 240, 0.98);
      box-shadow: 0 8px 24px rgba(0,0,0,0.12);
      border-radius: 16px;
      z-index: 9999;
      font-family: 'Google Sans', Arial, sans-serif;
      overflow: hidden;
      animation: factchecker-popup 0.3s ease-out;
      border: 1px solid rgba(0,0,0,0.1);
    `;
    
    // 오버레이 내용 생성 - 매우 간결한 형태
    overlay.innerHTML = `
      <div style="padding: 24px;">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="font-size: 28px; margin-right: 16px;">⚠️</div>
          <div>
            <h2 style="margin: 0; font-size: 20px; font-weight: 500; color: #202124;">오류 발생</h2>
            <p style="margin: 4px 0 0; font-size: 16px; color: #DB4437; font-weight: 500;">검증 과정에서 문제가 발생했습니다</p>
          </div>
        </div>
        
        <p style="margin: 16px 0; color: #5f6368; font-size: 14px; line-height: 1.5;">${errorMessage}</p>
        
        <div style="display: flex; justify-content: flex-end; margin-top: 24px;">
          <button class="factchecker-retry-btn" style="background-color: #DB4437; color: white; border: none; padding: 8px 16px; border-radius: 4px; font-family: 'Google Sans', Arial, sans-serif; font-weight: 500; cursor: pointer; margin-right: 8px;">다시 시도</button>
          <button class="factchecker-close-error-btn" style="background-color: transparent; color: #5f6368; border: 1px solid #dadce0; padding: 8px 16px; border-radius: 4px; font-family: 'Google Sans', Arial, sans-serif; font-weight: 500; cursor: pointer;">닫기</button>
        </div>
      </div>
    `;
    
    // 문서에 오버레이 추가
    document.body.appendChild(overlay);
    
    // 닫기 버튼 이벤트 핸들러 설정
    const closeButton = overlay.querySelector('.factchecker-close-error-btn');
    closeButton.addEventListener('click', () => {
      this.removeNewsOverlay();
    });
    
    // 다시 시도 버튼 이벤트 핸들러 설정
    const retryButton = overlay.querySelector('.factchecker-retry-btn');
    retryButton.addEventListener('click', () => {
      this.removeNewsOverlay();
      this.verifyNewsContent();
    });
    
    // ESC 키로 닫기 기능 추가
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.removeNewsOverlay();
      }
    }, { once: true });
    
    // 10초 후 자동으로 닫히도록 설정
    setTimeout(() => {
      if (document.body.contains(overlay)) {
        this.removeNewsOverlay();
      }
    }, 10000); // 10초 = 10,000 밀리초
  }

  /**
   * API 서버 상태 확인
   */
  async checkApiStatus() {
    try {
      const response = await fetch(`${this.serverUrl}/api/status`);
      if (response.ok) {
        const data = await response.json();
        console.log('FactChecker API 서버 상태:', data);
      } else {
        console.warn('FactChecker API 서버 연결 실패:', response.status);
      }
    } catch (error) {
      console.error('FactChecker API 서버 연결 오류:', error);
    }
  }

  /**
   * 뉴스 오버레이 제거
   */
  removeNewsOverlay() {
    console.log('[디버그] 뉴스 오버레이 제거 요청됨');
    try {
      // 애니메이션을 사용하여 부드럽게 제거
      const removeWithAnimation = (overlayId) => {
        const overlay = document.getElementById(overlayId);
        if (overlay) {
          console.log(`[디버그] 오버레이 요소 제거 시작: ${overlayId}`);
          
          // 애니메이션 적용 (부드럽게 사라지는 효과)
          overlay.style.opacity = '0';
          overlay.style.transform = 'translateY(10px)';
          
          // 애니메이션이 완료된 후 DOM에서 제거
          setTimeout(() => {
            if (overlay.parentNode) {
              overlay.parentNode.removeChild(overlay);
              console.log(`[디버그] 오버레이 요소 성공적으로 제거됨: ${overlayId}`);
            }
          }, 300); // 트랜지션 기간과 일치시킴
        }
      };
      
      // 모든 가능한 오버레이 ID 체크
      const overlayIds = [
        'factchecker-news-overlay',
        'factchecker-verification-overlay',
        'factchecker-error-overlay'
      ];
      
      overlayIds.forEach(removeWithAnimation);
      
      // 사용자 정의 오버레이 (동적 ID를 가진 경우)
      const customOverlays = document.querySelectorAll('[id^="factchecker-"]');
      customOverlays.forEach(overlay => {
        if (!overlayIds.includes(overlay.id)) {
          console.log(`[디버그] 사용자 정의 오버레이 제거: ${overlay.id}`);
          overlay.style.opacity = '0';
          overlay.style.transform = 'translateY(10px)';
          
          setTimeout(() => {
            if (overlay.parentNode) {
              overlay.parentNode.removeChild(overlay);
            }
          }, 300);
        }
      });
      
    } catch (error) {
      console.error('[오류] 오버레이 제거 중 오류 발생:', error);
    }
  }

  handleVerificationResults(results) {
    console.log('[디버그] 검증 결과 처리:', results);
    
    try {
      clearInterval(this.verificationTimer);
      this.verificationState.isVerifying = false;
      
      if (!results) {
        console.error('[오류] 검증 결과가 없습니다');
        this.showErrorOverlay('검증 결과를 가져오지 못했습니다: 서버로부터 응답이 없습니다');
        return;
      }
      
      if (results.error) {
        console.error('[오류] 검증 실패:', results.error);
        this.showErrorOverlay(`검증 결과를 가져오지 못했습니다: ${results.error}`);
        return;
      }
      
      // 백그라운드 스크립트에서 직접 전달된 결과 처리 (verifyNewsContent 액션에 대한 응답)
      if (results.success && (results.truthScore !== undefined || results.verdict !== undefined ||
          (results.data && (results.data.truthScore !== undefined || results.data.verdict !== undefined)))) {
        console.log('[디버그] 백그라운드에서 직접 전달된 검증 결과 처리');
        
        // results.data 형식인 경우 추출
        const resultData = results.data || results;
        this.showNewsVerificationOverlay(resultData);
        return;
      }
      
      // API 서버 응답 형식 처리 (/api/verify 엔드포인트 응답)
      if (results.verification) {
        const verificationData = results.verification;
        
        if (verificationData.status === 'completed') {
          if (verificationData.results) {
            console.log('[디버그] 완료된 검증 결과 표시');
            this.showNewsVerificationOverlay(verificationData.results);
          } else {
            console.error('[오류] 완료된 검증에 결과가 없습니다');
            this.showErrorOverlay('검증은 완료되었으나 결과를 불러올 수 없습니다');
          }
        } else if (verificationData.status === 'processing' || verificationData.status === 'analyzing') {
          console.log('[디버그] 검증이 아직 진행 중입니다:', verificationData.progress);
          const progressText = verificationData.progress ? `${verificationData.progress}%` : '';
          this.updateVerifyingOverlay(`검증이 진행 중입니다 ${progressText ? `(${progressText})` : ''}...`);
          
          // 상태 다시 확인 - 진행률에 따라 다른 간격 사용
          const retryDelay = verificationData.progress > 70 ? 2000 : 
                            verificationData.progress > 30 ? 3000 : 5000;
          
          setTimeout(() => {
            this.checkVerificationStatus(verificationData.claimId);
          }, retryDelay);
        } else if (verificationData.status === 'error') {
          console.error('[오류] 검증 중 서버 오류:', verificationData.error);
          this.showErrorOverlay(`검증 중 오류가 발생했습니다: ${verificationData.error || '알 수 없는 오류'}`);
        } else {
          console.warn('[경고] 알 수 없는 검증 상태:', verificationData.status);
          this.showErrorOverlay('검증 결과가 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
        }
      } 
      // 직접 검증 결과가 포함된 경우 - verifyNewsRequest 액션 응답 또는 API 직접 호출 응답
      else if (results.data && results.data.result) {
        console.log('[디버그] 직접 검증 결과 데이터 처리');
        // 데이터 형식 변환
        const resultData = results.data.result;
        const formattedData = {
          truthScore: resultData.confidence || resultData.truthScore || 50,
          verdict: resultData.message || resultData.verdict || '신뢰도 평가 결과',
          sources: resultData.sources || [],
          timestamp: resultData.timestamp || new Date().toISOString()
        };
        this.showNewsVerificationOverlay(formattedData);
      }
      // 기타 형식의 결과 - 가능한 데이터 추출 시도
      else {
        console.log('[디버그] 기타 형식의 검증 결과 처리 시도');
        try {
          // 응답 데이터에서 필요한 정보 추출 시도
          const extractedData = {
            truthScore: this.extractValue(results, ['truthScore', 'score', 'confidence']),
            verdict: this.extractValue(results, ['verdict', 'message', 'result']),
            sources: Array.isArray(results.sources) ? results.sources : 
                    (Array.isArray(results.references) ? results.references : []),
            timestamp: results.timestamp || new Date().toISOString()
          };
          
          if (extractedData.truthScore !== undefined || extractedData.verdict) {
            this.showNewsVerificationOverlay(extractedData);
          } else {
            throw new Error('필요한 결과 데이터를 찾을 수 없습니다');
          }
        } catch (dataError) {
          console.error('[오류] 유효한 검증 결과를 찾을 수 없습니다:', dataError);
          this.showErrorOverlay('검증 결과 형식이 유효하지 않습니다. 다시 시도해주세요.');
        }
      }
    } catch (error) {
      console.error('[오류] 검증 결과 처리 중 예외 발생:', error);
      this.showErrorOverlay(`검증 결과 처리 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  // 객체에서 가능한 키 중 첫 번째 유효한 값을 추출하는 유틸리티 함수
  extractValue(obj, possibleKeys) {
    if (!obj) return undefined;
    
    for (const key of possibleKeys) {
      if (obj[key] !== undefined) {
        return obj[key];
      }
    }
    
    return undefined;
  }

  // 결과 표시 함수 개선
  showNewsVerificationOverlay(results) {
    console.log('[디버그] 뉴스 검증 결과 표시:', results);
    
    try {
      // 기존 검증 중 오버레이 제거
      this.removeVerifyingOverlay();
    this.removeNewsOverlay();
    
      // 데이터 유효성 검사
      if (!results) {
        throw new Error('검증 결과 데이터가 없습니다');
      }
      
      // 결과 데이터 추출 및 표준화
      let truthScore, verdict, sources = [], timestamp;
      
      // 데이터 파싱 - truthScore 추출
      if (results.truthScore !== undefined) {
        truthScore = parseFloat(results.truthScore);
      } else if (results.confidence !== undefined) {
        truthScore = parseFloat(results.confidence);
      } else if (results.score !== undefined) {
        truthScore = parseFloat(results.score);
      } else {
        console.warn('[경고] 신뢰도 점수가 없어 기본값 사용');
        truthScore = 50; // 기본값
      }
      
      // 신뢰도 점수를 0-100 사이로 정규화 (백분율)
      if (truthScore > 0 && truthScore < 1) {
        truthScore = Math.round(truthScore * 100);
      } else {
        truthScore = Math.round(truthScore);
      }
      
      // 점수가 범위를 벗어나면 조정
      truthScore = Math.max(0, Math.min(100, truthScore));
      
      // 판정 결과 추출
      verdict = results.verdict || results.message || this.getTrustLevelMessage(truthScore);
      
      // 소스 추출
      if (Array.isArray(results.sources)) {
        sources = results.sources;
      } else if (results.references && Array.isArray(results.references)) {
        sources = results.references;
      }
      
      // 타임스탬프 추출 및 검증
      try {
        timestamp = results.timestamp || new Date().toISOString();
        // 유효한 날짜 형식인지 확인
        new Date(timestamp);
      } catch (e) {
        timestamp = new Date().toISOString();
      }
      
      // UI 생성
    const overlay = document.createElement('div');
    overlay.id = 'factchecker-news-overlay';
      overlay.className = 'factchecker-news-overlay';
      
      // 스타일 설정
    overlay.style.cssText = `
      position: fixed;
        bottom: 20px;
        right: 20px;
        width: 350px;
        max-width: 80vw;
        background-color: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        z-index: 2147483647;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #333;
        display: flex;
        flex-direction: column;
        max-height: 500px;
        opacity: 0;
        transform: translateY(10px);
        transition: opacity 0.3s ease, transform 0.3s ease;
      `;
      
      // 헤더
      const header = document.createElement('div');
      header.className = 'factchecker-overlay-header';
      header.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 15px;
        background: #f8f8f8;
        border-bottom: 1px solid #eaeaea;
        cursor: move;
      `;
      
      // 로고와 타이틀
      const headerTitle = document.createElement('div');
      headerTitle.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        font-weight: bold;
      `;
      
      const logoIcon = document.createElement('div');
      logoIcon.className = 'factchecker-logo';
      logoIcon.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M21 9L17 5L3 5L3 19L21 19L21 9Z" stroke="#3182CE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M17 5V9H21" stroke="#3182CE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      
      const titleText = document.createElement('span');
      titleText.textContent = '팩트체커 검증 결과';
      
      headerTitle.appendChild(logoIcon);
      headerTitle.appendChild(titleText);
      
      // 닫기 버튼
      const closeButton = document.createElement('button');
      closeButton.className = 'factchecker-close-btn';
      closeButton.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M18 6L6 18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 6L18 18" stroke="#666" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      closeButton.style.cssText = `
        background: none;
      border: none;
      cursor: pointer;
        padding: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.7;
        transition: opacity 0.2s;
      `;
      
      header.appendChild(headerTitle);
      header.appendChild(closeButton);
      
      // 내용 영역
      const content = document.createElement('div');
      content.style.cssText = `
        padding: 15px;
        max-height: 300px;
        overflow-y: auto;
      `;
      
      // 신뢰도 점수 표시
      const scoreDisplay = document.createElement('div');
      scoreDisplay.style.cssText = `
        text-align: center;
        margin-bottom: 15px;
      `;
      scoreDisplay.innerHTML = `
        <div style="font-size: 42px; font-weight: bold; color: #3498db;">${truthScore}%</div>
        <div style="font-size: 16px; color: #555;">신뢰도 점수</div>
      `;
      
      // 판정 결과 표시
      const verdictDisplay = document.createElement('div');
      verdictDisplay.style.cssText = `
        margin-bottom: 15px;
        padding: 10px;
        background-color: #f8f9fa;
        border-left: 4px solid #3498db;
        border-radius: 4px;
      `;
      verdictDisplay.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 5px;">판정 결과:</div>
        <div>${verdict}</div>
      `;
      
      // 소스 표시 (있는 경우에만)
      const sourcesDisplay = document.createElement('div');
      if (sources.length > 0) {
        sourcesDisplay.style.cssText = `
          margin-top: 15px;
        `;
        sourcesDisplay.innerHTML = `<div style="font-weight: bold; margin-bottom: 5px;">참고 출처:</div>`;
        
        const sourcesList = document.createElement('ul');
        sourcesList.style.cssText = `
          padding-left: 20px;
          margin: 5px 0;
        `;
        
        const validSources = sources.filter(source => source !== null && source !== undefined);
        validSources.slice(0, 3).forEach(source => {
          const sourceItem = document.createElement('li');
          
          // 소스가 문자열이거나 URL만 있는 경우
          if (typeof source === 'string') {
            sourceItem.innerHTML = `<a href="${source}" target="_blank" style="color: #3498db; text-decoration: none;">${this.truncateText(source, 40)}</a>`;
          } 
          // 소스가 객체인 경우 (title, url 속성)
          else if (source && typeof source === 'object') {
            if (source.url) {
              const title = source.title || this.truncateText(source.url, 40);
              sourceItem.innerHTML = `<a href="${source.url}" target="_blank" style="color: #3498db; text-decoration: none;">${title}</a>`;
            } else if (source.title) {
              sourceItem.innerText = source.title;
            } else if (source.snippet) {
              sourceItem.innerText = this.truncateText(source.snippet, 60);
            }
          }
          
          sourcesList.appendChild(sourceItem);
        });
        
        sourcesDisplay.appendChild(sourcesList);
        
        // 더 많은 소스가 있는 경우 표시
        if (validSources.length > 3) {
          const moreSources = document.createElement('div');
          moreSources.style.cssText = `
            font-size: 12px;
            color: #666;
            margin-top: 5px;
            text-align: right;
          `;
          moreSources.innerText = `외 ${validSources.length - 3}개 출처 더 있음`;
          sourcesDisplay.appendChild(moreSources);
        }
      }
      
      // 타임스탬프 추가
      const timestampDisplay = document.createElement('div');
      timestampDisplay.style.cssText = `
        margin-top: 15px;
        font-size: 12px;
        color: #777;
        text-align: right;
      `;
      
      // 타임스탬프 포맷팅
      try {
        const formattedTimestamp = new Date(timestamp).toLocaleString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        timestampDisplay.innerText = `검증 시간: ${formattedTimestamp}`;
      } catch (e) {
        console.warn('[경고] 타임스탬프 포맷팅 오류:', e);
        timestampDisplay.innerText = `검증 시간: 방금 전`;
      }
      
      // 콘텐츠에 요소들 추가
      content.appendChild(scoreDisplay);
      content.appendChild(verdictDisplay);
      if (sources.length > 0) {
        content.appendChild(sourcesDisplay);
      }
      content.appendChild(timestampDisplay);
      
      // 오버레이에 헤더와 콘텐츠 추가
      overlay.appendChild(header);
      overlay.appendChild(content);
      
      // 문서에 오버레이 추가
      document.body.appendChild(overlay);
      
      // 오버레이를 드래그 가능하게 설정
      this.makeOverlayDraggable(overlay);
      
      // 애니메이션으로 등장 효과 추가
      setTimeout(() => {
        overlay.style.opacity = '1';
        overlay.style.transform = 'translateY(0)';
      }, 10);
      
      // 닫기 버튼에 이벤트 리스너 추가
      closeButton.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[디버그] 오버레이 닫기 버튼 클릭됨');
        this.removeNewsOverlay();
      });
      
      closeButton.addEventListener('mouseover', () => {
        closeButton.style.opacity = '1';
      });
      
      closeButton.addEventListener('mouseout', () => {
        closeButton.style.opacity = '0.7';
      });
      
      console.log('[디버그] 검증 결과 오버레이가 성공적으로 생성되었습니다.');
      
    } catch (error) {
      console.error('[오류] 검증 결과 오버레이 생성 중 오류 발생:', error);
      this.showErrorOverlay(`검증 결과를 표시하는 중 오류가 발생했습니다: ${error.message}`);
    }
  }

  truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
  }

  getTrustLevelMessage(score) {
    if (score >= 90) return '매우 신뢰할 수 있는 정보입니다.';
    if (score >= 70) return '대체로 신뢰할 수 있는 정보입니다.';
    if (score >= 50) return '부분적으로 정확한 정보입니다.';
    if (score >= 30) return '신뢰하기 어려운 정보가 포함되어 있습니다.';
    return '신뢰할 수 없는 정보일 가능성이 높습니다.';
  }

  // 검증 상태 확인 함수 추가
  async checkVerificationStatus(claimId) {
    console.log('[디버그] 검증 상태 확인 요청:', claimId);
    
    try {
      // 검증 상태 확인 API 호출 (엔드포인트 수정)
      const response = await fetch(`${this.serverUrl}/api/verify/status/${claimId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!response.ok) {
        throw new Error(`서버 응답 오류: ${response.status} ${response.statusText}`);
      }
      
      // 응답 데이터 파싱
      const data = await response.json();
      console.log('[디버그] 검증 상태 응답:', data);
      
      // 검증 결과 처리
      this.handleVerificationResults(data);
    } catch (error) {
      console.error('[오류] 검증 상태 확인 중 에러:', error);
      
      // 타이머가 있으면 중지
      if (this.verificationTimer) {
        clearInterval(this.verificationTimer);
        this.verificationTimer = null;
      }
      
      // 오류 메시지 표시
      this.showErrorOverlay(`검증 상태 확인 중 오류가 발생했습니다: ${error.message}`);
    }
  }
}

// 모듈 초기화
const factChecker = new ContentRecognitionModule();
console.log('FactChecker 콘텐츠 스크립트 로드됨'); 
console.log('FactChecker 콘텐츠 스크립트 로드됨'); 