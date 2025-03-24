/**
 * FactChecker 백그라운드 서비스 워커
 * 서버 연결 상태 관리 및 탭 간 통신 지원
 */

// 상태 변수
let connectionStatus = 'disconnected';
let serverUrl = 'http://localhost:3000';
let pendingRequests = new Map();
let activeConnections = new Map(); // 활성 연결 추적
let iconError = false; // 아이콘 오류 추적

// 서버 상태 및 설정
let serverStatus = {
  isConnected: false,
  lastChecked: null,
  url: 'http://localhost:3000'
};

/**
 * 확장 프로그램 설치/업데이트 시 초기화
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('FactChecker 확장 프로그램이 설치/업데이트 되었습니다.');
  
  // 서버 상태 확인
  try {
    const response = await fetch(`${serverUrl}/api/status`);
    if (response.ok) {
      const data = await response.json();
      console.log('백엔드 서버 상태:', data);
    } else {
      console.warn(`백엔드 서버 오류: ${response.status}`);
    }
  } catch (error) {
    console.error('백엔드 서버 연결 오류:', error);
  }
  
  // 로컬 스토리지 초기화
  try {
    chrome.storage.local.set({
      isActive: false,
      lastChecked: null,
      serverStatus: 'disconnected'
    });
  } catch (error) {
    console.error('로컬 스토리지 초기화 오류:', error);
  }
  
  // 서버 상태 확인 시작
  checkServerStatus();
  
  // 컨텍스트 메뉴 생성 (우클릭 메뉴)
  try {
    chrome.contextMenus.create({
      id: 'factchecker-verify',
      title: '주장검증',
      contexts: ['page', 'selection'],
      documentUrlPatterns: [
        "<all_urls>"
      ]
    });
  } catch (error) {
    console.error('컨텍스트 메뉴 생성 오류:', error);
  }
  
  console.log('FactChecker 백그라운드 스크립트 초기화 완료');
});

/**
 * 컨텍스트 메뉴 클릭 이벤트 처리
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'factchecker-verify') {
    console.log('[디버그] 주장검증 메뉴 클릭됨:', tab.url);
    
    // 현재 탭에 뉴스 검증 요청 메시지 전송
    safelySendMessage(tab.id, { action: 'verifyNewsContent' })
      .then(response => {
        console.log('[디버그] 콘텐츠 스크립트 응답:', response);
      })
      .catch(error => {
        console.error('[오류] 메시지 전송 실패:', error);
      });
  }
});

/**
 * 콘텐츠 스크립트와의 양방향 통신 처리
 */
chrome.runtime.onConnect.addListener((port) => {
  const portId = Date.now().toString();
  console.log(`[디버그] 새 연결 설정됨: ${port.name} (ID: ${portId})`);
  
  // 연결 추적 맵에 저장
  activeConnections.set(portId, {
    port: port,
    timestamp: Date.now(),
    lastPing: Date.now()
  });
  
  // 연결 해제 리스너
  port.onDisconnect.addListener(() => {
    console.log(`[디버그] 연결 해제됨: ${port.name} (ID: ${portId})`);
    
    // 연결 맵에서 제거
    activeConnections.delete(portId);
    
    // 오류 확인
    if (chrome.runtime.lastError) {
      console.error(`[오류] 연결 해제 오류: ${chrome.runtime.lastError.message}`);
    }
  });
  
  // 메시지 리스너
  port.onMessage.addListener((message) => {
    // 연결 정보 업데이트
    const connectionInfo = activeConnections.get(portId);
    if (connectionInfo) {
      connectionInfo.lastPing = Date.now();
    }
    
    // 메시지 핸들링
    if (message && message.type === 'pong') {
      console.log(`[디버그] 'pong' 메시지 수신: ${port.name} (ID: ${portId})`);
    }
  });
  
  // 최초 ping 메시지 전송
  try {
    port.postMessage({ type: 'ping' });
  } catch (error) {
    console.error(`[오류] 초기 ping 메시지 전송 실패: ${error.message}`);
  }
});

/**
 * 서버 연결 상태 확인
 */
async function checkServerConnection() {
  try {
    console.log('[백그라운드] 서버 연결 상태 확인 중...');
    
    const response = await fetch('http://localhost:3000/api/status', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      // 정책 제한으로 타임아웃 방지
      cache: 'no-cache',
      mode: 'cors',
      credentials: 'omit'
    });
    
    let isConnected = false;
    
    if (response.ok) {
      const data = await response.json();
      console.log('[백그라운드] 서버 응답:', data);
      
      // 정상 응답 수신
      isConnected = true;
      connectionStatus = 'connected';
      updateBadge(true);
      console.log('서버 연결 상태: 연결됨');
    } else {
      console.warn(`[백그라운드] 서버 연결 실패 (${response.status})`);
      connectionStatus = 'disconnected';
      updateBadge(false);
      console.log('서버 연결 상태: 연결 끊김');
    }
    
    // 상태가 변경된 경우만 업데이트
    if (connectionStatus !== previousServerStatus) {
      previousServerStatus = connectionStatus;
      
      // 로컬 스토리지 상태 업데이트
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ 
            serverStatus: connectionStatus,
            lastChecked: new Date().toISOString()
          });
        }
      } catch (storageError) {
        console.warn('[백그라운드] 스토리지 업데이트 실패:', storageError);
      }
      
      // 활성 탭의 popup에 상태 전달
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        try {
          chrome.runtime.sendMessage({ 
            action: 'serverStatusUpdate', 
            status: connectionStatus 
          });
        } catch (e) {
          // 팝업이 닫혀 있는 경우 오류 무시
        }
      }
    }
    
    return isConnected;
  } catch (error) {
    console.error('[백그라운드] 서버 연결 확인 오류:', error);
    
    // 오류 발생시 오프라인으로 간주
    connectionStatus = 'disconnected';
    updateBadge(false);
    
    // 상태가 변경된 경우만 업데이트
    if (connectionStatus !== previousServerStatus) {
      previousServerStatus = connectionStatus;
      
      // 로컬 스토리지 상태 업데이트
      try {
        if (chrome && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ 
            serverStatus: connectionStatus,
            lastChecked: new Date().toISOString()
          });
        }
      } catch (storageError) {
        console.warn('[백그라운드] 스토리지 업데이트 실패:', storageError);
      }
    }
    
    return false;
  }
}

/**
 * 서버 상태 주기적 확인
 */
async function checkServerStatus() {
  try {
    // API 서버 상태 확인
    const response = await fetch(`${serverUrl}/api/status`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      serverStatus = {
        isConnected: true,
        lastChecked: new Date().toISOString(),
        url: serverUrl,
        version: data.version || 'unknown',
        services: data.services || {}
      };
    } else {
      serverStatus.isConnected = false;
    }
  } catch (error) {
    console.error('서버 상태 확인 오류:', error);
    serverStatus.isConnected = false;
  } finally {
    // 결과 저장 및 알림
    chrome.storage.local.set({ serverStatus });
    
    // 활성 탭의 popup에 상태 전달
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      try {
        chrome.runtime.sendMessage({ 
          action: 'serverStatusUpdate', 
          status: serverStatus 
        });
      } catch (e) {
        // 팝업이 닫혀 있는 경우 오류 무시
      }
    }
    
    // 30초 후 다시 확인
    setTimeout(checkServerStatus, 30000);
  }
}

/**
 * 확장 프로그램 뱃지 업데이트
 * @param {string} status - 상태 ('online' 또는 'offline')
 */
function updateBadge(status) {
  try {
    if (!chrome || !chrome.action) {
      console.warn('[경고] chrome.action API를 찾을 수 없습니다.');
      return;
    }
    
    if (status === 'online') {
      try {
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // 초록색
        chrome.action.setBadgeText({ text: '' });
      } catch (iconError) {
        console.warn('[경고] 아이콘 업데이트 실패 (온라인):', iconError);
      }
    } else {
      try {
        chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // 빨간색
        chrome.action.setBadgeText({ text: '!' });
      } catch (iconError) {
        console.warn('[경고] 아이콘 업데이트 실패 (오프라인):', iconError);
      }
    }
    
    // 아이콘 설정 시도
    try {
      const iconPath = status === 'online' ? 
        '/icons/icon48.png' : 
        '/icons/icon48_offline.png';
      
      chrome.action.setIcon({ path: iconPath }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[경고] 아이콘 변경 실패:', chrome.runtime.lastError.message);
        }
      });
    } catch (setIconError) {
      console.warn('[경고] 아이콘 설정 시도 중 오류:', setIconError);
    }
  } catch (error) {
    console.error('[오류] 뱃지 업데이트 실패:', error);
  }
}

/**
 * 안전하게 탭에 메시지 전송
 * @param {number} tabId 대상 탭 ID
 * @param {object} message 전송할 메시지
 * @returns {Promise} 전송 결과
 */
function safelySendMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(`[오류] 메시지 전송 오류: ${lastError.message}`, { tabId, message });
          
          // 콘텐츠 스크립트가 로드되지 않은 경우, 스크립트 주입 시도
          if (lastError.message.includes('Receiving end does not exist') ||
              lastError.message.includes('Could not establish connection')) {
            
            injectContentScript(tabId)
              .then(() => {
                // 스크립트 주입 후 짧은 대기 시간
                setTimeout(() => {
                  // 다시 메시지 전송 시도
                  chrome.tabs.sendMessage(tabId, message, (retryResponse) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(`재시도 후에도 메시지 전송 실패: ${chrome.runtime.lastError.message}`));
                    } else {
                      resolve(retryResponse || { success: true, retried: true });
                    }
                  });
                }, 500);
              })
              .catch(error => {
                reject(new Error(`콘텐츠 스크립트 주입 실패: ${error.message}`));
              });
            return;
          }
          
          reject(new Error(lastError.message));
          return;
        }
        
        resolve(response || { success: true });
      });
    } catch (error) {
      console.error('[오류] 메시지 전송 시도 중 예외:', error.message);
      reject(error);
    }
  });
}

/**
 * 콘텐츠 스크립트 주입
 * @param {number} tabId 대상 탭 ID
 * @returns {Promise} 주입 결과
 */
function injectContentScript(tabId) {
  return new Promise((resolve, reject) => {
    try {
      chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content/content.js']
      }, (results) => {
        if (chrome.runtime.lastError) {
          reject(new Error(`스크립트 주입 오류: ${chrome.runtime.lastError.message}`));
          return;
        }
        
        console.log('[디버그] 콘텐츠 스크립트 주입 완료:', results);
        
        // CSS도 주입
        chrome.scripting.insertCSS({
          target: { tabId: tabId },
          files: ['content/content.css']
        }, () => {
          if (chrome.runtime.lastError) {
            console.warn(`CSS 주입 경고: ${chrome.runtime.lastError.message}`);
          }
          resolve(true);
        });
      });
    } catch (error) {
      reject(new Error(`스크립트 주입 예외: ${error.message}`));
    }
  });
}

/**
 * 활성 연결 상태를 모니터링하고 필요한 경우 ping 전송
 */
function monitorActiveConnections() {
  const now = Date.now();
  const timeout = 300000; // 5분 (300초) 타임아웃
  const pingInterval = 60000; // 1분 (60초) 마다 ping
  
  // 모든 활성 연결 확인
  for (const [portId, connection] of activeConnections.entries()) {
    // 연결 시간 초과 확인
    if (now - connection.timestamp > timeout) {
      console.log(`[디버그] 연결 시간 초과로 제거: ID ${portId}`);
      activeConnections.delete(portId);
      continue;
    }
    
    // 정기 ping 전송
    if (now - connection.lastPing > pingInterval) {
      try {
        connection.port.postMessage({ type: 'ping', timestamp: now });
        connection.lastPing = now;
        console.log(`[디버그] Ping 전송됨: ID ${portId}`);
      } catch (error) {
        console.error(`[오류] Ping 전송 실패: ${error.message}`);
        activeConnections.delete(portId);
      }
    }
  }
  
  // 1분마다 모니터링
  setTimeout(monitorActiveConnections, 60000);
}

// 이벤트 리스너 초기화 후 모니터링 시작
monitorActiveConnections();

// 현재 탭의 미디어 스트림 ID 가져오기
async function getTabMediaStreamId(tabId) {
  try {
    return new Promise((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ 
        consumerTabId: tabId 
      }, streamId => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.error('미디어 스트림 ID 획득 오류:', lastError);
          reject(new Error(lastError.message));
          return;
        }
        
        if (!streamId) {
          reject(new Error('미디어 스트림 ID를 가져올 수 없습니다'));
          return;
        }
        
        resolve(streamId);
      });
    });
  } catch (error) {
    console.error('탭 미디어 스트림 ID 가져오기 오류:', error);
    throw error;
  }
}

// 주기적으로 서버 연결 상태 확인 (30초마다)
const connectionCheckInterval = 30000;
let intervalId = setInterval(checkServerConnection, connectionCheckInterval);

// 초기 연결 확인
checkServerConnection();

// 메시지 수신 처리
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("[디버그] 백그라운드에서 메시지 수신:", message);
  
  // 메시지 처리 지연 방지를 위한 ID 생성
  const requestId = Date.now().toString();
  
  // 요청 처리 함수
  const processRequest = async () => {
    try {
      let response = { success: false };
      
      if (message.action === 'getConnectionStatus') {
        response = { status: connectionStatus };
      } 
      else if (message.action === 'getServerStatus') {
        response = { status: serverStatus };
      }
      else if (message.action === 'activateFactChecker' || message.action === 'deactivateFactChecker') {
        // 현재 활성 탭에 메시지 전송
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs && tabs[0]) {
          const actionToSend = message.action === 'activateFactChecker' ? 'activate' : 'deactivate';
          response = await safelySendMessage(tabs[0].id, { action: actionToSend });
        } else {
          response = { success: false, error: '활성 탭을 찾을 수 없습니다' };
        }
      }
      else if (message.action === 'requestMediaStreamId') {
        // 미디어 스트림 ID 요청 처리
        try {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          if (!tabs || !tabs[0]) {
            response = { success: false, error: '활성 탭을 찾을 수 없습니다' };
          } else {
            const streamId = await getTabMediaStreamId(tabs[0].id);
            response = { success: true, streamId };
          }
        } catch (error) {
          console.error('미디어 스트림 ID 요청 처리 오류:', error);
          response = { success: false, error: error.message };
        }
      }
      // 뉴스 콘텐츠 검증 요청 처리 (content.js에서 호출하는 액션)
      else if (message.action === 'verifyNewsContent') {
        console.log("[디버그] verifyNewsContent 액션 처리 시작");
        
        try {
          const data = message.data || {};
          const title = data.title || '';
          const url = data.url || '';
          
          if (!url) {
            response = { 
              success: false, 
              error: '검증할 URL이 없습니다' 
            };
          } else {
            console.log("[디버그] 검증 요청 데이터:", { 
              title: title.substring(0, 30) + '...', 
              url
            });
            
            // URL을 서버로 전송하여 콘텐츠 추출 및 검증 요청
            const apiResponse = await fetch(`${serverUrl}/api/verify-news`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                title: title,
                url: url
                // content 필드는 서버에서 URL로부터 추출하도록 제거
              })
            });
            
            if (apiResponse.ok) {
              const data = await apiResponse.json();
              
              console.log("[디버그] API 응답:", data);
              
              // 서버 응답 전달
              response = {
                success: true,
                ...data
              };
            } else {
              // 서버 오류 처리
              const errorData = await apiResponse.text();
              console.error('[오류] 서버 응답 오류:', apiResponse.status, errorData);
              
              response = { 
                success: false, 
                error: `서버 오류 (${apiResponse.status}): ${errorData}` 
              };
            }
          }
        } catch (error) {
          console.error('[오류] 뉴스 검증 처리 중 예외 발생:', error);
          response = { 
            success: false, 
            error: error.message || '뉴스 검증 처리 중 오류가 발생했습니다' 
          };
        }
      }
      else if (message.action === 'verifyNewsRequest') {
        console.log("[디버그] 뉴스 검증 요청 처리 시작");
        const processRequest = async () => {
          try {
            const content = message.content;
            const title = message.title || '';
            const url = message.url || '';
            
            console.log("[디버그] 검증 요청 데이터:", { title, url, contentLength: content?.length });
            
            // 타이틀과 내용으로 주장 추출
            const claimToVerify = title || content.substring(0, 200);
            
            // 웹 검색으로 주장 검증
            console.log("[디버그] 검증 시작:", claimToVerify);
            const verificationResult = await performWebSearch(claimToVerify);
            console.log("[디버그] 검증 결과:", verificationResult);
            
            sendResponse({
              success: true,
              data: {
                claim: claimToVerify,
                result: verificationResult,
                timestamp: new Date().toISOString()
              }
            });
          } catch (error) {
            console.error('[디버그] 주장 검증 처리 오류:', error);
            sendResponse({
              success: false,
              error: error.message || '주장 검증 처리 중 오류가 발생했습니다.'
            });
          }
        };
        
        processRequest();
        return true; // 비동기 응답 허용
      }
      
      // 응답 전송 (요청이 아직 처리 중인 경우에만)
      if (pendingRequests.has(requestId)) {
        pendingRequests.get(requestId)(response);
        pendingRequests.delete(requestId);
      }
    } catch (error) {
      console.error('요청 처리 오류:', error);
      
      // 오류 응답 전송
      if (pendingRequests.has(requestId)) {
        pendingRequests.get(requestId)({ success: false, error: error.message });
        pendingRequests.delete(requestId);
      }
    }
  };
  
  // 비동기 응답을 위한 처리
  pendingRequests.set(requestId, sendResponse);
  processRequest();
  
  return true; // 비동기 응답 가능하도록 true 반환
});

// 서비스 워커 활성 상태 유지를 위한 알람 설정
chrome.alarms.create('keepAlive', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // 주기적으로 서버 상태 확인
    checkServerStatus();
  }
});

// 탭 URL 변경 감지
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    try {
      // 지원되는 사이트인지 확인
      const isMediaSite = 
        tab.url.includes('youtube.com') || 
        tab.url.includes('tv.naver.com') || 
        tab.url.includes('tv.kakao.com');
        
      const isNewsSite = 
        tab.url.includes('news.naver.com') || 
        tab.url.includes('news.daum.net') ||
        tab.url.includes('yonhapnews.co.kr') ||
        tab.url.includes('yna.co.kr') ||
        tab.url.includes('chosun.com') ||
        tab.url.includes('donga.com') ||
        tab.url.includes('hani.co.kr') ||
        tab.url.includes('kmib.co.kr') ||
        tab.url.includes('khan.co.kr') ||
        tab.url.includes('mk.co.kr') ||
        tab.url.includes('mt.co.kr') ||
        tab.url.includes('sedaily.com');
      
      if (isMediaSite || isNewsSite) {
        // 지원되는 사이트에서 활성화 가능 상태로 변경
        try {
          chrome.action.setIcon({ 
            path: {
              16: '/icons/icon16.png',
              48: '/icons/icon48.png',
              128: '/icons/icon128.png'
            },
            tabId: tabId
          });
        } catch (iconError) {
          console.error('아이콘 설정 오류:', iconError);
        }
        
        chrome.action.setTitle({ 
          title: 'FactChecker - 활성화 가능',
          tabId: tabId
        });
        
        chrome.action.enable(tabId);
        console.log('지원되는 사이트 감지:', tab.url);
      } else {
        // 지원되지 않는 사이트에서는 비활성화 상태로 표시
        try {
          chrome.action.setIcon({ 
            path: {
              16: '/icons/icon16.png',
              48: '/icons/icon48.png',
              128: '/icons/icon128.png'
            },
            tabId: tabId
          });
        } catch (iconError) {
          console.error('아이콘 설정 오류:', iconError);
        }
        
        chrome.action.setTitle({ 
          title: 'FactChecker - 지원되지 않는 사이트',
          tabId: tabId
        });
        
        chrome.action.disable(tabId);
        console.log('지원되지 않는 사이트:', tab.url);
      }
    } catch (error) {
      console.error('탭 URL 처리 오류:', error);
    }
  }
});

/**
 * 주장 검증을 위한 웹 검색 수행
 * @param {string} claim 검증할 주장 텍스트
 * @param {object} options 검색 옵션
 * @returns {Promise<object>} 검색 결과
 */
async function performWebSearch(claim, options = {}) {
  try {
    console.log('웹 검색 시작:', claim);
    const startTime = performance.now();
    
    // 검색 API 설정
    const apiConfig = {
      tavily: {
        enabled: true,
        apiKey: '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', // 실제 사용 시 환경변수 등으로 관리 필요
        endpoint: 'https://api.tavily.com/search'
      },
      braveSearch: {
        enabled: false,
        apiKey: 'YOUR_BRAVE_API_KEY', // 실제 사용 시 환경변수 등으로 관리 필요
        endpoint: 'https://api.search.brave.com/res/v1/web/search'
      },
      serverAPI: {
        enabled: true,
        endpoint: 'http://localhost:3000/api/verify-news'
      }
    };
    
    // 표준화된 결과 템플릿
    const standardResult = {
      success: true,
      verified: false,
      confidence: 50,
      message: '검증 진행 중...',
      sources: [],
      timestamp: new Date().toISOString()
    };
    
    // 백엔드 API 호출 (타임아웃 설정)
    if (apiConfig.serverAPI.enabled) {
      try {
        console.log('백엔드 API를 통한 검증 시도:', claim);
        
        // API 연결 가능성 테스트
        try {
          const statusResponse = await fetch(`${apiConfig.serverAPI.endpoint.split('/api/')[0]}/api/status`);
          if (!statusResponse.ok) {
            console.warn(`백엔드 API 상태 오류: ${statusResponse.status}. 자체 검증으로 전환합니다.`);
            throw new Error('API 서버 연결 불가');
          }
        } catch (statusError) {
          console.warn('백엔드 API 상태 확인 실패:', statusError);
          throw new Error('API 서버 연결 불가');
        }
        
        const response = await fetch(apiConfig.serverAPI.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: claim,
            title: options.title || '',
            url: options.url || ''
          })
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('백엔드 API 응답:', data);
          
          // 서버 응답 포맷 변환
          if (data && data.verificationResults) {
            const result = {
              success: true,
              verified: data.verificationResults.truthScore > 60,
              confidence: data.verificationResults.truthScore,
              message: data.verificationResults.verdict || '검증 완료',
              sources: data.verificationResults.sources || [],
              timestamp: data.verificationResults.timestamp || new Date().toISOString()
            };
            
            // 성능 측정 및 로깅
            const endTime = performance.now();
            const processingTime = ((endTime - startTime) / 1000).toFixed(2);
            
            console.log(`===== 주장 검증 완료 (백엔드 API) - 처리 시간: ${processingTime}초 =====`);
            console.table({
              '주장': claim,
              '검증 결과': result.verified ? '사실' : (result.confidence > 30 ? '부분적 사실' : '허위'),
              '신뢰도': result.confidence + '%',
              '소스 수': result.sources.length,
              '처리 시간': processingTime + '초'
            });
            
            return result;
          }
          
          // 일반 응답인 경우 - 해당 필드가 있으면 반환, 없으면 표준 템플릿 사용
          const result = {
            success: true,
            verified: data.verified !== undefined ? data.verified : standardResult.verified,
            confidence: data.confidence || data.truthScore || standardResult.confidence,
            message: data.message || data.verdict || standardResult.message,
            sources: data.sources || [],
            timestamp: data.timestamp || new Date().toISOString()
          };
          
          // 성능 측정 및 로깅
          const endTime = performance.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);
          
          console.log(`===== 주장 검증 완료 (백엔드 API - 일반 응답) - 처리 시간: ${processingTime}초 =====`);
          console.table({
            '주장': claim,
            '검증 결과': result.verified ? '사실' : (result.confidence > 30 ? '부분적 사실' : '허위'),
            '신뢰도': result.confidence + '%',
            '소스 수': result.sources.length,
            '처리 시간': processingTime + '초'
          });
          
          return result;
        }
      } catch (error) {
        console.error('백엔드 API 호출 오류:', error);
        // 오류가 발생해도 계속 진행 (다른 API 시도)
      }
    }
    
    // Tavily API 호출
    if (apiConfig.tavily.enabled) {
      try {
        const tavilyResponse = await fetch(apiConfig.tavily.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiConfig.tavily.apiKey}`
          },
          body: JSON.stringify({
            query: `팩트체크: ${claim}`,
            search_depth: 'advanced',
            include_domains: ['news.naver.com', 'news.daum.net', 'yna.co.kr', 'yonhapnews.co.kr'],
            max_results: 5
          })
        });
        
        if (tavilyResponse.ok) {
          const data = await tavilyResponse.json();
          const result = processSearchResults(data, claim);
          
          // 타임스탬프 추가
          result.timestamp = new Date().toISOString();
          
          // 성능 측정 및 로깅
          const endTime = performance.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);
          
          console.log(`===== 주장 검증 완료 (Tavily API) - 처리 시간: ${processingTime}초 =====`);
          console.table({
            '주장': claim,
            '검증 결과': result.verified ? '사실' : (result.confidence > 30 ? '부분적 사실' : '허위'),
            '신뢰도': result.confidence + '%',
            '소스 수': result.sources.length,
            '처리 시간': processingTime + '초'
          });
          
          return result;
        } else {
          console.error('Tavily API 오류:', await tavilyResponse.text());
        }
      } catch (error) {
        console.error('Tavily API 호출 실패:', error);
        // 오류가 발생해도 계속 진행
      }
    }
    
    // Brave Search API 호출 (Tavily 실패 시 대체)
    if (apiConfig.braveSearch.enabled) {
      try {
        const braveResponse = await fetch(`${apiConfig.braveSearch.endpoint}?q=${encodeURIComponent(`팩트체크: ${claim}`)}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'X-Subscription-Token': apiConfig.braveSearch.apiKey
          }
        });
        
        if (braveResponse.ok) {
          const data = await braveResponse.json();
          const result = processSearchResults(data, claim, 'brave');
          
          // 타임스탬프 추가
          result.timestamp = new Date().toISOString();
          
          // 성능 측정 및 로깅
          const endTime = performance.now();
          const processingTime = ((endTime - startTime) / 1000).toFixed(2);
          
          console.log(`===== 주장 검증 완료 (Brave Search API) - 처리 시간: ${processingTime}초 =====`);
          console.table({
            '주장': claim,
            '검증 결과': result.verified ? '사실' : (result.confidence > 30 ? '부분적 사실' : '허위'),
            '신뢰도': result.confidence + '%',
            '소스 수': result.sources.length,
            '처리 시간': processingTime + '초'
          });
          
          return result;
        } else {
          console.error('Brave Search API 오류:', await braveResponse.text());
        }
      } catch (error) {
        console.error('Brave Search API 호출 실패:', error);
        // 오류가 발생해도 계속 진행
      }
    }
    
    // 모든 API 호출 실패 시 임시 결과 생성
    console.warn('모든 검색 API 호출 실패. 임시 결과 생성');
    
    // 성능 측정 및 로깅
    const endTime = performance.now();
    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
    
    console.log(`===== 주장 검증 완료 (임시 결과) - 처리 시간: ${processingTime}초 =====`);
    console.table({
      '주장': claim,
      '검증 결과': '알 수 없음',
      '신뢰도': '30%',
      '소스 수': 0,
      '처리 시간': processingTime + '초',
      '상태': '모든 API 호출 실패'
    });
    
    return {
      success: true,
      verified: false,
      confidence: 30,
      message: '검증 중입니다. 잠시 후 다시 확인해주세요.',
      sources: [],
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('웹 검색 오류:', error);
    return {
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 검색 결과 처리 및 분석
 * @param {object} searchData 검색 API 응답 데이터
 * @param {string} claim 검증 대상 주장
 * @param {string} provider 검색 제공자 (tavily 또는 brave)
 * @returns {object} 가공된 검증 결과
 */
function processSearchResults(searchData, claim, provider = 'tavily') {
  try {
    // 데이터 형식에 따라 결과 추출
    let results = [];
    
    if (provider === 'tavily') {
      results = searchData.results || [];
    } else if (provider === 'brave') {
      results = searchData.web?.results || [];
    }
    
    if (results.length === 0) {
      return {
        success: true,
        verified: false,
        confidence: 0,
        message: '검증 가능한 정보를 찾을 수 없습니다.',
        sources: []
      };
    }
    
    // 결과 분석 및 신뢰도 계산
    const sources = results.map(result => ({
      title: result.title || '',
      url: result.url || '',
      snippet: result.content || result.description || '',
      score: calculateRelevanceScore(claim, result.content || result.description || '')
    }));
    
    // 신뢰도 평균 계산
    const avgConfidence = sources.reduce((sum, source) => sum + source.score, 0) / sources.length;
    
    // 순위별 가중치 적용
    const weightedConfidence = sources.slice(0, 3)
      .reduce((sum, source, index) => sum + (source.score * (1 - index * 0.2)), 0) / 
      Math.min(sources.length, 3);
    
    // 결과 판정
    const verificationResult = {
      success: true,
      verified: weightedConfidence > 0.6,
      confidence: Math.round(weightedConfidence * 100),
      sources: sources.slice(0, 5),
      message: weightedConfidence > 0.8 ? '주장이 사실로 확인됨' :
               weightedConfidence > 0.6 ? '주장이 대체로 사실로 확인됨' :
               weightedConfidence > 0.4 ? '주장의 일부만 사실로 확인됨' :
               weightedConfidence > 0.2 ? '주장이 대체로 사실이 아님' :
                                          '주장이 사실이 아님'
    };
    
    return verificationResult;
    
  } catch (error) {
    console.error('검색 결과 처리 오류:', error);
    return {
      success: false,
      error: '검색 결과 분석 중 오류가 발생했습니다.'
    };
  }
}

/**
 * 주장과 검색 결과의 연관성 점수 계산
 * @param {string} claim 주장 텍스트
 * @param {string} content 검색 결과 내용
 * @returns {number} 0~1 사이의 연관성 점수
 */
function calculateRelevanceScore(claim, content) {
  if (!claim || !content) return 0;
  
  try {
    // 주요 키워드 추출
    const keywords = extractKeywords(claim);
    
    // 키워드 일치 점수 계산
    let matchScore = 0;
    keywords.forEach(keyword => {
      const regex = new RegExp(keyword, 'gi');
      const matches = content.match(regex);
      if (matches) {
        matchScore += matches.length * (keyword.length > 3 ? 2 : 1);
      }
    });
    
    // 전체 텍스트 유사도 (간단한 구현)
    const claimLower = claim.toLowerCase();
    const contentLower = content.toLowerCase();
    
    // 부정 표현 점검 (상반된 주장 탐지)
    const negationTerms = ['아니', '없', '불가능', '거짓', '틀린', '오류'];
    const hasNegationInClaim = negationTerms.some(term => claimLower.includes(term));
    const hasNegationInContent = negationTerms.some(term => contentLower.includes(term));
    
    // 부정 표현이 한쪽에만 있으면 점수 감소
    const negationPenalty = (hasNegationInClaim !== hasNegationInContent) ? 0.3 : 0;
    
    // 최종 점수 계산 (키워드 일치 + 내용 길이 고려)
    const lengthFactor = Math.min(1, content.length / 500);
    const normalizedScore = Math.min(1, (matchScore / (keywords.length * 3)) * lengthFactor);
    
    // 신뢰도 감소 요인 적용
    return Math.max(0, normalizedScore - negationPenalty);
    
  } catch (error) {
    console.error('연관성 점수 계산 오류:', error);
    return 0;
  }
}

/**
 * 텍스트에서 주요 키워드 추출
 * @param {string} text 원본 텍스트
 * @returns {string[]} 주요 키워드 배열
 */
function extractKeywords(text) {
  if (!text) return [];
  
  // 불용어(stopwords) 정의
  const stopwords = ['이', '그', '저', '것', '수', '를', '은', '는', '이', '가', '과', '에', '의', '에서', '로', '으로'];
  
  // 텍스트 정제 및 단어 분리
  const words = text
    .replace(/[^\w\s가-힣]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 1 && !stopwords.includes(word));
  
  // 중복 제거 및 반환
  return [...new Set(words)];
} 