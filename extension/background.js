/**
 * FactChecker 백그라운드 서비스 워커
 * 서버 연결 상태 관리 및 탭 간 통신 지원
 */

// 상태 변수
let connectionStatus = 'disconnected';

// 서버 URL 설정 (개발/프로덕션 환경에 따라 다르게 설정)
const BASE_SERVER_URL = 'http://localhost:3000';
const API_PATH = '/api';
const serverUrl = BASE_SERVER_URL + API_PATH;

console.log('[디버그] 서버 URL 설정:', {
  BASE_SERVER_URL,
  API_PATH,
  serverUrl,
  timestamp: new Date().toISOString(),
  environment: 'development'
});

let pendingRequests = new Map();
let activeConnections = new Map(); // 활성 연결 추적
let iconError = false; // 아이콘 오류 추적
let previousServerStatus = 'disconnected'; // 이전 서버 상태 초기화

// 서버 상태 및 설정
let serverStatus = {
  isConnected: false,
  lastChecked: null,
  url: BASE_SERVER_URL
};

// SSE 연결 관리
let sseConnection = null;

/**
 * 확장 프로그램 설치/업데이트 시 초기화
 */
chrome.runtime.onInstalled.addListener(async () => {
  console.log('FactChecker 확장 프로그램이 설치/업데이트 되었습니다.');
  
  // 서버 상태 확인
  try {
    const response = await fetch(`${serverUrl}/status`);
    if (response.ok) {
      const data = await response.json();
      console.log('백엔드 서버 상태:', data);
      serverStatus.isConnected = true;
      serverStatus.lastChecked = new Date().toISOString();
    } else {
      console.warn(`백엔드 서버 오류: ${response.status}`);
      serverStatus.isConnected = false;
    }
  } catch (error) {
    console.error('백엔드 서버 연결 오류:', error);
    serverStatus.isConnected = false;
  }
  
  // 로컬 스토리지 초기화
  try {
    chrome.storage.local.set({
      isActive: serverStatus.isConnected,
      lastChecked: serverStatus.lastChecked,
      serverStatus: serverStatus.isConnected ? 'connected' : 'disconnected',
      serverUrl: serverUrl
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
  console.log('[디버그] 컨텍스트 메뉴 클릭됨:', info.menuItemId);
  console.log('[디버그] 탭 정보:', {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    status: tab.status
  });
  
  if (info.menuItemId === 'factchecker-verify') {
    console.log('[디버그] 주장검증 메뉴 클릭됨:', {
      tabId: tab.id,
      url: tab.url,
      title: tab.title
    });
    
    // 서버 상태 확인
    if (!serverStatus.isConnected) {
      console.warn('[경고] 서버 연결이 없습니다. 연결 상태를 확인합니다.');
      checkServerConnection();
    } else {
      console.log('[디버그] 서버 연결 상태 양호:', serverStatus);
    }
    
    console.log('[디버그] 탭에 메시지 전송 시도 (verifyNewsContent):', tab.id);
    
    // 현재 탭에 뉴스 검증 요청 메시지 전송
    safelySendMessage(tab.id, { action: 'verifyNewsContent' })
      .then(response => {
        console.log('[디버그] 콘텐츠 스크립트 응답:', response);
      })
      .catch(error => {
        console.error('[오류] 메시지 전송 실패:', error);
        
        console.log('[디버그] 콘텐츠 스크립트 주입 시도:', tab.id);
        
        // 콘텐츠 스크립트가 응답하지 않는 경우, 스크립트 주입 시도
        injectContentScript(tab.id)
          .then(() => {
            console.log('[디버그] 콘텐츠 스크립트 주입 성공, 0.5초 후 메시지 재전송');
            
            // 스크립트 주입 후 짧은 대기 시간 후 재시도
            setTimeout(() => {
              console.log('[디버그] 메시지 재전송 시도:', tab.id);
              
              safelySendMessage(tab.id, { action: 'verifyNewsContent' })
                .then(retryResponse => {
                  console.log('[디버그] 재시도 후 응답:', retryResponse);
                })
                .catch(retryError => {
                  console.error('[오류] 재시도 후에도 실패:', retryError);
                  // 사용자에게 알림
                  chrome.notifications.create({
                    type: 'basic',
                    iconUrl: 'icons/icon48.png',
                    title: 'FactChecker 오류',
                    message: '뉴스 콘텐츠를 분석할 수 없습니다. 페이지를 새로고침하고 다시 시도해보세요.'
                  });
                });
            }, 500);
          })
          .catch(injectError => {
            console.error('[오류] 콘텐츠 스크립트 주입 실패:', injectError);
            
            // 사용자에게 알림
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'FactChecker 오류',
              message: '콘텐츠 스크립트를 주입할 수 없습니다. 이 페이지는 지원되지 않을 수 있습니다.'
            });
          });
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
    port.postMessage({ type: 'ping', serverStatus: serverStatus });
  } catch (error) {
    console.error(`[오류] 초기 ping 메시지 전송 실패: ${error.message}`);
  }
});

/**
 * 서버 연결 상태 확인
 */
function checkServerConnection() {
  console.log('[디버그] 서버 연결 확인 중...', serverUrl);
  
  // 서버 응답 타임아웃 설정
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
  
  fetch(serverUrl + '/health', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal
  })
  .then(response => {
    clearTimeout(timeoutId);
    if (response.ok) {
      return response.json();
    }
    throw new Error(`서버 응답 오류: ${response.status} ${response.statusText}`);
  })
  .then(data => {
    const isConnected = data && data.status === 'ok';
    console.log('[디버그] 서버 상태:', isConnected ? '연결됨' : '연결 안됨', data);
    
    serverStatus.isConnected = isConnected;
    serverStatus.lastChecked = new Date().toISOString();
    
    // 서비스 정보 저장 (API가 반환하는 경우)
    if (data.services) {
      serverStatus.services = data.services;
    }
    
    updateBadge(isConnected);
    
    // 이전 상태와 다른 경우에만 상태 변경 알림
    if (previousServerStatus !== isConnected) {
      previousServerStatus = isConnected;
      
      // 상태 저장 및 알림
      chrome.storage.local.set({ 
        serverConnected: isConnected,
        lastChecked: serverStatus.lastChecked,
        serverStatus: isConnected ? 'connected' : 'disconnected',
        serverServices: serverStatus.services || {}
      });
      
      // 모든 열린 팝업에 상태 변경 알림
      chrome.runtime.sendMessage({
        action: 'serverStatusChanged',
        isConnected: isConnected,
        timestamp: serverStatus.lastChecked,
        services: serverStatus.services
      }).catch(err => {
        // 팝업이 닫혀 있으면 무시 가능한 오류
        console.debug('팝업이 닫혀 있어 메시지 전송 실패', err);
      });
    }
  })
  .catch(error => {
    clearTimeout(timeoutId);
    console.error('서버 연결 확인 오류:', error);
    
    // AbortController에 의한 타임아웃인 경우
    const errorMessage = error.name === 'AbortError' ? 
      '서버 연결 시간 초과' : error.message;
    
    serverStatus.isConnected = false;
    serverStatus.lastChecked = new Date().toISOString();
    serverStatus.errorMessage = errorMessage;
    
    updateBadge(false);
    
    // 이전 상태와 다른 경우에만 상태 변경 알림
    if (previousServerStatus !== false) {
      previousServerStatus = false;
      
      // 상태 저장 및 알림
      chrome.storage.local.set({ 
        serverConnected: false,
        lastChecked: serverStatus.lastChecked,
        serverStatus: 'disconnected',
        errorMessage: errorMessage
      });
      
      // 모든 열린 팝업에 상태 변경 알림
      chrome.runtime.sendMessage({
        action: 'serverStatusChanged',
        isConnected: false,
        timestamp: serverStatus.lastChecked,
        error: errorMessage
      }).catch(err => {
        // 팝업이 닫혀 있으면 무시 가능한 오류
        console.debug('팝업이 닫혀 있어 메시지 전송 실패', err);
      });
    }
  });
}

/**
 * 서버 상태 주기적 확인
 */
async function checkServerStatus() {
  try {
    // API 서버 상태 확인
    const response = await fetch(`${serverUrl}/status`, {
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
 * @param {boolean|string} status - 연결 상태 (true/false 또는 'online'/'offline')
 */
function updateBadge(status) {
  try {
    if (!chrome || !chrome.action) {
      console.warn('[경고] chrome.action API를 찾을 수 없습니다.');
      return;
    }
    
    // boolean을 문자열로 변환
    const statusStr = typeof status === 'boolean' ? 
      (status ? 'online' : 'offline') : status;
    
    if (statusStr === 'online' || status === true) {
      try {
        chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' }); // 초록색
        chrome.action.setBadgeText({ text: '' });
        console.log('[디버그] 뱃지 업데이트: 온라인 상태');
      } catch (iconError) {
        console.warn('[경고] 아이콘 업데이트 실패 (온라인):', iconError);
      }
    } else {
      try {
        chrome.action.setBadgeBackgroundColor({ color: '#F44336' }); // 빨간색
        chrome.action.setBadgeText({ text: '!' });
        console.log('[디버그] 뱃지 업데이트: 오프라인 상태');
      } catch (iconError) {
        console.warn('[경고] 아이콘 업데이트 실패 (오프라인):', iconError);
      }
    }
    
    // 아이콘 설정 시도
    try {
      const iconPath = (statusStr === 'online' || status === true) ? 
        {
          16: '/icons/icon16.png',
          48: '/icons/icon48.png',
          128: '/icons/icon128.png'
        } : 
        {
          16: '/icons/icon16.png',
          48: '/icons/icon48.png',
          128: '/icons/icon128.png'
        };
      
      chrome.action.setIcon({ path: iconPath });
    } catch (setIconError) {
      console.warn('[경고] 아이콘 설정 시도 중 오류:', setIconError);
    }
  } catch (error) {
    console.error('[오류] 뱃지 업데이트 실패:', error);
  }
}

/**
 * 안전하게 탭에 메시지 전송 (Promise 기반)
 * @param {number} tabId - 메시지를 전송할 탭 ID
 * @param {object} message - 전송할 메시지
 * @returns {Promise<any>} - 응답 Promise
 */
function safelySendMessage(tabId, message) {
  console.log(`[디버그] safelySendMessage 호출됨: 탭ID=${tabId}, 메시지=`, message);
  
  // tabId 유효성 확인
  if (!tabId) {
    console.error('[오류] safelySendMessage: 유효하지 않은 tabId:', tabId);
    return Promise.reject(new Error('유효하지 않은 탭 ID'));
  }
  
  return new Promise((resolve, reject) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        // 오류 확인
        if (chrome.runtime.lastError) {
          console.error(`[오류] 메시지 전송 실패 (탭ID=${tabId}):`, chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        
        console.log(`[디버그] 메시지 전송 성공 (탭ID=${tabId}):`, response);
        resolve(response);
      });
    } catch (error) {
      console.error(`[오류] 메시지 전송 중 예외 발생 (탭ID=${tabId}):`, error);
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
    // 먼저 탭 정보 확인
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('[오류] 탭 정보 확인 실패:', chrome.runtime.lastError.message);
        reject(new Error(`탭 접근 오류: ${chrome.runtime.lastError.message}`));
        return;
      }
      
      // URL 검사 (chrome:// URL이나 기타 제한된 페이지는 스킵)
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('about:')) {
        console.warn(`[경고] 제한된 URL에는 스크립트를 주입할 수 없습니다: ${tab.url}`);
        reject(new Error(`제한된 URL: ${tab.url}`));
        return;
      }
      
      try {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          files: ['content/content.js']
        }, (results) => {
          if (chrome.runtime.lastError) {
            const errorMsg = chrome.runtime.lastError.message;
            console.error('[오류] 스크립트 주입 오류:', errorMsg);
            
            // 권한 부족 오류인 경우
            if (errorMsg.includes('permission') || errorMsg.includes('Cannot access contents')) {
              reject(new Error(`호스트 권한 오류: ${errorMsg}`));
            } else {
              reject(new Error(`스크립트 주입 오류: ${errorMsg}`));
            }
            return;
          }
          
          console.log('[디버그] 콘텐츠 스크립트 주입 완료:', results);
          
          // CSS도 주입
          chrome.scripting.insertCSS({
            target: { tabId: tabId },
            files: ['content/content.css']
          }, () => {
            if (chrome.runtime.lastError) {
              console.warn('[경고] CSS 주입 경고:', chrome.runtime.lastError.message);
            }
            resolve(true);
          });
        });
      } catch (error) {
        console.error('[오류] 스크립트 주입 예외:', error.message);
        reject(new Error(`스크립트 주입 예외: ${error.message}`));
      }
    });
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

// 주기적으로 서버 연결 상태 확인 (1초마다)
const connectionCheckInterval = 1000;
let intervalId = setInterval(checkServerConnection, connectionCheckInterval);

// 초기 연결 확인
checkServerConnection();

/**
 * 메시지 핸들러 (runtime.onMessage)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[디버그] 메시지 수신:', message, {
    sender: sender?.id || '불명',
    senderId: sender?.tab?.id || '불명',
    hasCallback: !!sendResponse
  });
  
  // 서버 상태 확인 요청 처리
  if (message && message.action === 'checkServerStatus') {
    console.log('[디버그] 서버 상태 확인 요청 처리');
    
    // 서버 상태를 응답에 포함하여 반환
    const response = {
      success: true,
      serverStatus: serverStatus
    };
    
    console.log('[디버그] 서버 상태 응답:', response);
    sendResponse(response);
    return true;
  }
  
  // 콘텐츠 스크립트 주입 요청 처리
  if (message && message.action === 'injectContentScript') {
    console.log('[디버그] 콘텐츠 스크립트 주입 요청 처리:', message.tabId);
    
    if (!message.tabId) {
      console.error('[오류] 탭 ID가 없습니다');
      sendResponse({ success: false, error: '탭 ID가 필요합니다' });
      return true;
    }
    
    // 비동기 응답을 위해 Promise 사용
    (async () => {
      try {
        console.log('[디버그] injectContentScript 함수 호출 시작:', message.tabId);
        
        // 콘텐츠 스크립트 주입
        const result = await injectContentScript(message.tabId);
        
        console.log('[디버그] 콘텐츠 스크립트 주입 결과:', result);
        
        // 결과 반환
        sendResponse({ success: true, result: result });
      } catch (error) {
        console.error('[오류] 콘텐츠 스크립트 주입 중 예외:', error);
        
        // 오류 응답
        sendResponse({
          success: false,
          error: `콘텐츠 스크립트 주입 오류: ${error.message}`
        });
      }
    })();
    
    // 비동기 응답을 위해 true 반환
    return true;
  }
  
  // 콘텐츠 검증 요청 처리
  if (message && message.action === 'verifyContent') {
    console.log('[디버그] 콘텐츠 검증 요청 처리 시작', {
      url: message.url ? (message.url.substring(0, 50) + '...') : 'none',
      hasTitle: !!message.title,
      contentLength: message.content ? message.content.length : 0,
      forceRefresh: !!message.forceRefresh,
      timestamp: message.timestamp || new Date().toISOString()
    });
    
    // 비동기 응답을 위해 Promise 사용
    (async () => {
      try {
        console.log('[디버그] verifyContent 함수 호출 시작');
        
        // 서버에 검증 요청
        const result = await verifyContent({
          url: message.url,
          title: message.title,
          content: message.content,
          forceRefresh: message.forceRefresh
        });
        
        console.log('[디버그] 검증 결과 수신:', {
          success: result.success,
          hasError: !!result.error,
          hasData: !!result.data,
          dataKeys: result.data ? Object.keys(result.data) : [],
          timestamp: new Date().toISOString()
        });
        
        // 결과 반환
        sendResponse(result);
      } catch (error) {
        console.error('[오류] 콘텐츠 검증 처리 중 예외:', error);
        
        // 오류 응답
        sendResponse({
          success: false,
          error: `검증 처리 중 오류가 발생했습니다: ${error.message}`
        });
      }
    })();
    
    // 비동기 응답을 위해 true 반환
    return true;
  }
  
  // 기타 메시지는 처리하지 않음
  return false;
});

/**
 * 콘텐츠 검증 함수
 * @param {Object} params - URL, 제목, 콘텐츠 등 검증에 필요한 파라미터
 * @returns {Promise<Object>} - 검증 결과
 */
async function verifyContent(params) {
  try {
    console.log('[디버그] 콘텐츠 검증 시작', {
      hasUrl: !!params.url,
      hasTitle: !!params.title,
      hasContent: !!params.content,
      contentLength: params.content ? params.content.length : 0,
      urlPreview: params.url ? params.url.substring(0, 30) + '...' : 'none',
      forceRefresh: !!params.forceRefresh,
      timestamp: new Date().toISOString()
    });
    
    // 필수 필드 확인
    if (!params.url || !params.content) {
      console.error('[오류] 필수 필드 누락:', { 
        hasUrl: !!params.url, 
        hasContent: !!params.content 
      });
      return {
        success: false,
        error: 'URL과 콘텐츠는 필수 항목입니다.'
      };
    }
    
    // 서버 연결 확인
    console.log('[디버그] 서버 상태 확인 시작');
    const serverHealth = await checkServerHealth();
    console.log('[디버그] 서버 상태 확인 결과:', serverHealth);
    
    if (!serverHealth.isConnected) {
      console.error('[오류] 서버에 연결할 수 없습니다:', serverHealth.error);
      return {
        success: false,
        error: '서버에 연결할 수 없습니다: ' + (serverHealth.error || '알 수 없는 오류')
      };
    }
    
    // API 요청 준비
    const requestData = {
      url: params.url,
      title: params.title || '',
      content: params.content,
      forceRefresh: !!params.forceRefresh
    };
    
    console.log('[디버그] 서버 요청 데이터 준비:', {
      url: requestData.url.substring(0, 50) + (requestData.url.length > 50 ? '...' : ''),
      title: requestData.title ? (requestData.title.substring(0, 30) + (requestData.title.length > 30 ? '...' : '')) : '(없음)',
      contentLength: requestData.content ? requestData.content.length : 0,
      contentPreview: requestData.content ? requestData.content.substring(0, 100) + '...' : '(없음)',
      forceRefresh: requestData.forceRefresh,
      timestamp: new Date().toISOString()
    });
    
    // API 요청 실행
    const apiUrl = `${serverUrl}/verify/enhanced`;
    console.log('[디버그] 서버 API 요청 시작:', apiUrl);
    
    // 타임아웃 설정
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30초 타임아웃
    
    try {
      console.log('[디버그] fetch 요청 시작:', {
        method: 'POST',
        url: apiUrl,
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': chrome.runtime.getManifest().version
        },
        bodySize: JSON.stringify(requestData).length,
        timestamp: new Date().toISOString()
      });
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Version': chrome.runtime.getManifest().version
        },
        body: JSON.stringify(requestData),
        signal: controller.signal
      });
      
      // 타임아웃 클리어
      clearTimeout(timeoutId);
      
      console.log('[디버그] 서버 응답 수신:', {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
        headers: {
          'content-type': response.headers.get('content-type'),
          'content-length': response.headers.get('content-length')
        },
        timestamp: new Date().toISOString()
      });
      
      // 응답 처리
      if (!response.ok) {
        let errorText;
        try {
          errorText = await response.text();
        } catch (e) {
          errorText = '응답 내용을 읽을 수 없습니다';
        }
        
        console.error(`[오류] 서버 응답 실패 (${response.status}):`, errorText);
        return {
          success: false,
          error: `서버 오류 (${response.status}): ${errorText || response.statusText}`
        };
      }
      
      // 응답 데이터 파싱
      console.log('[디버그] 서버 응답 파싱 시작');
      let responseData;
      try {
        responseData = await response.json();
        console.log('[디버그] 서버 응답 파싱 성공');
      } catch (err) {
        console.error('[오류] JSON 파싱 오류:', err);
        responseData = null;
      }
      
      if (!responseData) {
        return {
          success: false,
          error: '서버 응답을 처리할 수 없습니다'
        };
      }
      
      console.log('[디버그] 서버 응답 데이터:', {
        success: responseData.success,
        hasData: !!responseData.data,
        hasResult: !!responseData.result,
        resultKeys: responseData.result ? Object.keys(responseData.result) : [],
        dataKeys: responseData.data ? Object.keys(responseData.data) : []
      });
      
      // API 응답 구조 분석 - 결과가 data 필드에 있을수도, result 필드에 있을수도 있음
      let resultData = null;
      
      if (responseData.data) {
        console.log('[디버그] 응답에서 data 필드 발견');
        resultData = responseData.data;
      } else if (responseData.result) {
        console.log('[디버그] 응답에서 result 필드 발견');
        resultData = responseData.result;
      }
      
      // 데이터가 없는 경우
      if (!resultData) {
        console.error('[오류] 응답에 유효한 데이터가 없습니다');
        return {
          success: responseData.success,
          data: {},
          message: responseData.message || '데이터 없음'
        };
      }
      
      // 성공 응답
      return {
        success: true,
        data: resultData
      };
    } catch (fetchError) {
      // 타임아웃 클리어
      clearTimeout(timeoutId);
      
      // 타임아웃 오류 확인
      if (fetchError.name === 'AbortError') {
        console.error('[오류] 서버 요청 타임아웃');
        return {
          success: false,
          error: '서버 요청 시간이 초과되었습니다. 나중에 다시 시도해주세요.'
        };
      }
      
      console.error('[오류] 서버 요청 실패:', fetchError);
      return {
        success: false,
        error: `서버 요청 오류: ${fetchError.message}`
      };
    }
  } catch (error) {
    console.error('[오류] 콘텐츠 검증 처리 중 오류:', error);
    return {
      success: false,
      error: `검증 처리 오류: ${error.message}`
    };
  }
}

/**
 * 서버 상태 확인 (헬스체크)
 * @returns {Promise<{isConnected: boolean, error: string|null}>}
 */
async function checkServerHealth() {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      return {
        isConnected: data && data.status === 'ok',
        error: null
      };
    }
    
    return {
      isConnected: false,
      error: `서버 응답 코드: ${response.status}`
    };
  } catch (error) {
    console.error('[오류] 서버 상태 확인 실패:', error);
    return {
      isConnected: false,
      error: error.message
    };
  }
}

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
 * 웹 콘텐츠 추출 함수 (FireCrawl 대체)
 * @param {string} url 스크래핑할 URL
 * @returns {Promise<object>} 추출된 콘텐츠 객체
 */
async function scrapeUrlContent(url) {
  try {
    console.log('[콘텐츠 추출] URL 처리 시작:', url);
    
    // 서버 API를 통한 콘텐츠 추출 시도
    try {
      const serverApiUrl = `${serverUrl}/extract`;
      const response = await fetch(serverApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ url })
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data && data.success && data.content) {
          console.log('[콘텐츠 추출] 서버 API 추출 성공:', {
            title: data.title?.substring(0, 30) + '...',
            contentLength: data.content?.length || 0
          });
          
          return {
            success: true,
            title: data.title || '',
            content: data.content,
            summary: data.summary || '',
            keywords: data.keywords || []
          };
        }
      }
      
      console.warn('[콘텐츠 추출] 서버 API 추출 실패, 브라우저 추출 시도');
    } catch (serverError) {
      console.warn('[콘텐츠 추출] 서버 API 오류:', serverError.message);
    }
    
    // 현재 탭에서 콘텐츠 추출 시도
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const tabId = tabs[0].id;
      
      // content script에 메시지 전송하여 현재 페이지 콘텐츠 요청
      try {
        const extractResult = await chrome.tabs.sendMessage(tabId, {
          action: 'extractPageContent'
        });
        
        if (extractResult && extractResult.content) {
          console.log('[콘텐츠 추출] 콘텐츠 스크립트에서 추출 성공:', {
            title: extractResult.title?.substring(0, 30) + '...',
            contentLength: extractResult.content?.length || 0
          });
          
          return {
            success: true,
            title: extractResult.title || '',
            content: extractResult.content,
            summary: '',
            keywords: []
          };
        }
      } catch (extractError) {
        console.warn('[콘텐츠 추출] 콘텐츠 스크립트 추출 오류:', extractError.message);
      }
    }
    
    // 웹 검색 결과로 대체
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    const path = urlObj.pathname.split('/').filter(p => p).join(' ');
    
    const searchQuery = `${domain} ${path}`;
    console.log(`[콘텐츠 추출] 검색 대체: "${searchQuery}"`);
    
    // 웹 검색 수행
    const searchResults = await performWebSearch(searchQuery, { count: 3 });
    
    if (searchResults && searchResults.length > 0) {
      // 현재 URL과 동일하거나 유사한 결과 찾기
      const matchingResult = searchResults.find(item => 
        item.url === url || item.url.includes(domain)
      ) || searchResults[0];
      
      return {
        success: true,
        title: matchingResult.title || '',
        content: matchingResult.snippet || '',
        summary: '',
        keywords: [],
        source: 'search'
      };
    }
    
    throw new Error('콘텐츠를 추출할 수 없습니다.');
  } catch (error) {
    console.error('[콘텐츠 추출] 처리 오류:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * 서버 상태 확인 (통합 함수)
 */
function checkServiceStatus() {
  // 서버 상태 확인
  fetch(`${serverUrl}/status`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  })
  .then(response => {
    if (response.ok) {
      return response.json();
    }
    throw new Error('서버 응답 오류');
  })
  .then(data => {
    // 상태 정보 저장
    chrome.storage.local.set({
      serverStatus: {
        connected: true,
        timestamp: Date.now(),
        services: data.services || {}
      }
    });
    
    // 브라우저 뱃지 업데이트
    updateBadge('online');
    
    // 모든 활성 탭에 서버 상태 브로드캐스트
    broadcastToActiveTabs({
      action: 'serverStatusUpdate',
      status: 'online',
      services: data.services || {}
    });
  })
  .catch(error => {
    console.error('서버 상태 확인 오류:', error);
    
    // 상태 정보 저장
    chrome.storage.local.set({
      serverStatus: {
        connected: false,
        timestamp: Date.now(),
        error: error.message
      }
    });
    
    // 브라우저 뱃지 업데이트
    updateBadge('offline');
    
    // 모든 활성 탭에 서버 상태 브로드캐스트
    broadcastToActiveTabs({
      action: 'serverStatusUpdate',
      status: 'offline',
      error: error.message
    });
  });
}

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

/**
 * SSE 연결 설정
 */
async function setupSSEConnection() {
  try {
    if (sseConnection) {
      console.log('[팩트체커] 기존 SSE 연결 종료');
      sseConnection.close();
      sseConnection = null;
    }
    
    const clientId = Date.now().toString();
    console.log(`[팩트체커] SSE 연결 시도: ${serverUrl}/api/sse?clientId=${clientId}`);
    
    sseConnection = new EventSource(`${serverUrl}/api/sse?clientId=${clientId}`);
    
    sseConnection.onopen = () => {
      console.log('[팩트체커] SSE 연결 성공');
      connectionStatus = 'connected';
      updateBadge('online');
      
      // 연결 상태 저장
      chrome.storage.local.set({ 
        serverConnected: true,
        lastConnected: new Date().toISOString()
      });
    };
    
    sseConnection.onerror = (event) => {
      console.error('[팩트체커] SSE 연결 오류:', event);
      connectionStatus = 'disconnected';
      updateBadge('offline');
      
      // 연결 상태 저장
      chrome.storage.local.set({ 
        serverConnected: false,
        lastConnectionError: new Date().toISOString()
      });
      
      // 연결 종료 및 정리
      if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
      }
      
      // 5초 후 재연결 시도
      setTimeout(setupSSEConnection, 5000);
    };
    
    sseConnection.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] SSE 서버 연결 확인:', data);
        
        // 클라이언트 ID 저장
        if (data && data.clientId) {
          chrome.storage.local.set({ sseClientId: data.clientId });
        }
      } catch (error) {
        console.error('[팩트체커] SSE 연결 이벤트 처리 오류:', error);
      }
    });
    
    sseConnection.addEventListener('verification_result', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] 검증 결과 수신:', data);
        handleServerEvent(data, 'verification_result');
      } catch (error) {
        console.error('[팩트체커] 검증 결과 처리 오류:', error);
      }
    });
    
    sseConnection.addEventListener('verification_progress', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] 검증 진행 상황 수신:', data);
        handleServerEvent(data, 'verification_progress');
      } catch (error) {
        console.error('[팩트체커] 검증 진행 상황 처리 오류:', error);
      }
    });
    
    sseConnection.addEventListener('error', (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] 오류 이벤트 수신:', data);
        handleServerEvent(data, 'error');
      } catch (error) {
        console.error('[팩트체커] 오류 이벤트 처리 실패:', error);
      }
    });
    
    sseConnection.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[팩트체커] 일반 SSE 메시지 수신:', data);
        handleServerEvent(data, data.type || 'generic');
      } catch (error) {
        console.error('[팩트체커] SSE 메시지 처리 오류:', error);
      }
    };
  } catch (error) {
    console.error('[팩트체커] SSE 연결 설정 오류:', error);
    connectionStatus = 'disconnected';
    updateBadge('offline');
    
    // 연결 상태 저장
    chrome.storage.local.set({ 
      serverConnected: false,
      lastConnectionError: new Date().toISOString(),
      connectionErrorMessage: error.message
    });
    
    // 5초 후 재연결 시도
    setTimeout(setupSSEConnection, 5000);
  }
}

/**
 * 서버 이벤트 처리
 * @param {Object} data - 이벤트 데이터
 * @param {string} eventType - 이벤트 유형
 */
function handleServerEvent(data, eventType) {
  if (!data) return;
  
  console.log(`[팩트체커] 서버 이벤트 처리 - 유형: ${eventType}`);
  
  switch (eventType) {
    case 'verification_result':
      broadcastToActiveTabs({
        action: 'verificationResult',
        result: data
      });
      break;
      
    case 'verification_progress':
      broadcastToActiveTabs({
        action: 'verificationProgress',
        progress: data
      });
      break;
      
    case 'error':
      broadcastToActiveTabs({
        action: 'verificationError',
        error: data
      });
      break;
      
    case 'connected':
      console.log('[팩트체커] 서버 연결 설정 완료');
      connectionStatus = 'connected';
      updateBadge('online');
      
      // 연결 상태 저장
      chrome.storage.local.set({ 
        serverConnected: true,
        lastConnected: new Date().toISOString()
      });
      break;
      
    default:
      // 알 수 없는 이벤트 유형의 경우 아무 작업도 수행하지 않음
      console.log(`[팩트체커] 알 수 없는 이벤트 유형: ${eventType}`, data);
  }
}

/**
 * 활성 탭에 메시지 브로드캐스트
 */
async function broadcastToActiveTabs(message) {
  try {
    const tabs = await chrome.tabs.query({ active: true });
    for (const tab of tabs) {
      try {
        await safelySendMessage(tab.id, message);
      } catch (error) {
        console.warn(`[팩트체커] 탭 ${tab.id}에 메시지 전송 실패:`, error);
      }
    }
  } catch (error) {
    console.error('[팩트체커] 브로드캐스트 실패:', error);
  }
}

// 서버 연결 주기적 확인 (1초마다)
setInterval(checkServiceStatus, 1000);

// 초기 서버 상태 확인
checkServiceStatus(); 