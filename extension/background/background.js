/**
 * FactChecker 백그라운드 서비스 워커
 * 서버 연결 상태 관리 및 탭 간 통신 지원
 */

// 상태 변수
let connectionStatus = 'disconnected';
let serverUrl = 'http://localhost:3000';
let pendingRequests = new Map();

// 서버 상태 및 설정
let serverStatus = {
  isConnected: false,
  lastChecked: null,
  url: 'http://localhost:3000'
};

/**
 * 확장 프로그램 설치/업데이트 시 초기화
 */
chrome.runtime.onInstalled.addListener((details) => {
  // 로컬 스토리지 초기화
  chrome.storage.local.set({
    isActive: false,
    lastChecked: null,
    serverStatus: 'disconnected'
  });
  
  // 서버 상태 확인 시작
  checkServerStatus();
  
  // 컨텍스트 메뉴 생성 (우클릭 메뉴)
  chrome.contextMenus.create({
    id: 'factchecker-verify',
    title: '주장검증',
    contexts: ['page', 'selection'],
    documentUrlPatterns: [
      "<all_urls>"
    ]
  });
  
  console.log('FactChecker 백그라운드 스크립트 초기화 완료');
});

/**
 * 컨텍스트 메뉴 클릭 이벤트 처리
 */
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'factchecker-verify') {
    console.log('주장검증 메뉴 클릭됨:', tab.url);
    
    // 현재 탭에 뉴스 검증 요청 메시지 전송
    chrome.tabs.sendMessage(tab.id, { 
      action: 'verifyNewsContent'
    });
  }
});

/**
 * 서버 연결 상태 확인
 * @returns {Promise<boolean>} 연결 성공 여부
 */
async function checkServerConnection() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(`${serverUrl}/status`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      if (data.status === 'running') {
        connectionStatus = 'connected';
        updateBadge(true);
        console.log('서버 연결 상태: 연결됨');
        return true;
      }
    }
    
    connectionStatus = 'disconnected';
    updateBadge(false);
    console.log('서버 연결 상태: 연결 끊김');
    return false;
  } catch (error) {
    connectionStatus = 'disconnected';
    updateBadge(false);
    console.error('서버 연결 확인 오류:', error);
    return false;
  }
}

/**
 * 서버 상태 주기적 확인
 */
async function checkServerStatus() {
  try {
    // 마지막 확인 시간으로부터 10초 이내라면 캐시된 결과 사용
    const now = new Date();
    if (serverStatus.lastChecked && 
        (now - new Date(serverStatus.lastChecked)) < 10000 && 
        serverStatus.isConnected) {
      console.log('서버 상태 캐시 사용:', serverStatus.lastChecked);
      // 활성 탭의 popup에 캐시된 상태 전달
      updateActiveTabStatus();
      // 요청 스킵, 다음 주기 대기
      setTimeout(checkServerStatus, 60000); // 60초마다 체크
      return;
    }
    
    // API 서버 상태 확인
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 타임아웃
    
    const response = await fetch(`${serverUrl}/api/status`, {
      method: 'GET',
      headers: { 
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache' 
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      serverStatus = {
        isConnected: true,
        lastChecked: now.toISOString(),
        url: serverUrl,
        version: data.version || 'unknown',
        services: data.services || {}
      };
    } else {
      serverStatus.isConnected = false;
      serverStatus.lastChecked = now.toISOString();
    }
  } catch (error) {
    console.error('서버 상태 확인 오류:', error);
    serverStatus.isConnected = false;
    serverStatus.lastChecked = new Date().toISOString();
    serverStatus.error = error.message;
  } finally {
    // 결과 저장 및 알림
    chrome.storage.local.set({ serverStatus });
    
    // 활성 탭에 상태 전달
    updateActiveTabStatus();
    
    // 60초 후 다시 확인 (30초에서 60초로 증가)
    setTimeout(checkServerStatus, 60000);
  }
}

/**
 * 활성 탭에 서버 상태 업데이트 전송
 */
async function updateActiveTabStatus() {
  try {
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
  } catch (error) {
    console.error('상태 업데이트 전송 오류:', error);
  }
}

/**
 * 확장프로그램 배지 업데이트
 * @param {boolean} isConnected 연결 상태
 */
function updateBadge(isConnected) {
  try {
    chrome.action.setBadgeText({ 
      text: isConnected ? 'ON' : 'OFF' 
    });
    
    chrome.action.setBadgeBackgroundColor({ 
      color: isConnected ? '#4CAF50' : '#F44336' 
    });
  } catch (error) {
    console.error('배지 업데이트 오류:', error);
  }
}

/**
 * 안전하게 탭에 메시지 전송
 * @param {number} tabId 대상 탭 ID
 * @param {object} message 전송할 메시지
 * @returns {Promise} 전송 결과
 */
function safelySendMessage(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          console.warn(`메시지 전송 오류: ${lastError.message}`, { tabId, message });
          resolve({ success: false, error: lastError.message });
        } else {
          resolve(response || { success: true });
        }
      });
    } catch (error) {
      console.error('메시지 전송 예외:', error);
      resolve({ success: false, error: error.message });
    }
  });
}

/**
 * 현재 탭의 미디어 스트림 ID 가져오기
 * @param {number} tabId 대상 탭 ID
 * @returns {Promise<string>} 미디어 스트림 ID
 */
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
  console.log('백그라운드 메시지 수신:', message);
  
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
      else if (message.action === 'verifyNewsRequest') {
        // 뉴스 검증 요청을 서버로 전송
        if (!message.content) {
          response = { success: false, error: '검증할 콘텐츠가 없습니다' };
        } else {
          try {
            const apiResponse = await fetch(`${serverUrl}/api/verify-news`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                content: message.content,
                title: message.title || '',
                url: message.url || ''
              })
            });
            
            if (apiResponse.ok) {
              const data = await apiResponse.json();
              response = { success: true, data };
              
              // 결과를 요청한 탭에 전송
              if (sender && sender.tab && sender.tab.id) {
                chrome.tabs.sendMessage(sender.tab.id, {
                  action: 'newsVerificationResults',
                  results: data
                });
              }
            } else {
              response = { 
                success: false, 
                error: `서버 오류: ${apiResponse.status}` 
              };
            }
          } catch (error) {
            console.error('뉴스 검증 API 요청 오류:', error);
            response = { success: false, error: error.message };
          }
        }
      }
      else if (message.action === 'summarizeAndVerify') {
        response = await summarizeAndVerifyContent(message.data);
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
        chrome.action.setIcon({ 
          path: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png'
          },
          tabId: tabId
        });
        
        chrome.action.setTitle({ 
          title: 'FactChecker - 활성화 가능',
          tabId: tabId
        });
        
        chrome.action.enable(tabId);
        console.log('지원되는 사이트 감지:', tab.url);
      } else {
        // 지원되지 않는 사이트에서는 비활성화 상태로 표시
        chrome.action.setIcon({ 
          path: {
            16: 'icons/icon16.png',
            48: 'icons/icon48.png',
            128: 'icons/icon128.png'
          },
          tabId: tabId
        });
        
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
    
    // 검색 API 설정
    const apiConfig = {
      tavily: {
        enabled: true,
        apiKey: 'YOUR_TAVILY_API_KEY', // 실제 사용 시 환경변수 등으로 관리 필요
        endpoint: 'https://api.tavily.com/search'
      },
      braveSearch: {
        enabled: false,
        apiKey: 'YOUR_BRAVE_API_KEY', // 실제 사용 시 환경변수 등으로 관리 필요
        endpoint: 'https://api.search.brave.com/res/v1/web/search'
      }
    };
    
    // Tavily API 호출
    if (apiConfig.tavily.enabled) {
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
        return processSearchResults(data, claim);
      } else {
        console.error('Tavily API 오류:', await tavilyResponse.text());
      }
    }
    
    // Brave Search API 호출 (Tavily 실패 시 대체)
    if (apiConfig.braveSearch.enabled) {
      const braveResponse = await fetch(`${apiConfig.braveSearch.endpoint}?q=${encodeURIComponent(`팩트체크: ${claim}`)}`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiConfig.braveSearch.apiKey
        }
      });
      
      if (braveResponse.ok) {
        const data = await braveResponse.json();
        return processSearchResults(data, claim, 'brave');
      } else {
        console.error('Brave Search API 오류:', await braveResponse.text());
      }
    }
    
    // 모든 API 호출 실패 시 기본 결과 반환
    console.warn('모든 검색 API 호출 실패');
    return {
      success: false,
      error: '검색 서비스에 연결할 수 없습니다.'
    };
    
  } catch (error) {
    console.error('웹 검색 오류:', error);
    return {
      success: false,
      error: error.message
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

// 요약 및 검증 함수 추가 (다른 함수들 사이에 추가)
/**
 * 뉴스 콘텐츠를 요약하고 핵심 키워드를 추출하여 팩트체크 수행
 * @param {Object} newsData - 뉴스 콘텐츠 데이터
 * @returns {Promise<Object>} - 요약 및 검증 결과
 */
async function summarizeAndVerifyContent(newsData) {
  console.log('요약 및 검증 시작:', newsData?.title);
  
  try {
    if (!newsData || !newsData.content || newsData.content.length < 50) {
      return {
        success: false,
        error: '검증할 충분한 콘텐츠가 없습니다'
      };
    }
    
    // 서버 연결 확인
    if (!serverStatus.isConnected) {
      return {
        success: false,
        error: '서버에 연결할 수 없습니다'
      };
    }
    
    // API에 요약 생성 요청
    console.log('요약 생성 요청...');
    const summaryResponse = await fetch(`${serverUrl}/api/content/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: newsData.title,
        content: newsData.content,
        url: newsData.url
      })
    });
    
    if (!summaryResponse.ok) {
      throw new Error(`요약 생성 실패: ${summaryResponse.status} ${summaryResponse.statusText}`);
    }
    
    const summaryData = await summaryResponse.json();
    
    if (!summaryData.success || !summaryData.summary) {
      throw new Error('요약 생성 실패: 서버 응답 오류');
    }
    
    console.log('요약 생성 완료:', summaryData.summary);
    
    // 요약문으로 핵심 키워드 추출 및 검증 API 요청
    console.log('요약 기반 팩트체크 요청...');
    const verifyResponse = await fetch(`${serverUrl}/api/verify/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: summaryData.summary,
        url: newsData.url
      })
    });
    
    if (!verifyResponse.ok) {
      throw new Error(`팩트체크 실패: ${verifyResponse.status} ${verifyResponse.statusText}`);
    }
    
    const verificationResult = await verifyResponse.json();
    
    // 최종 결과 조합
    return {
      success: true,
      summary: summaryData.summary,
      keyword: verificationResult.keyword,
      verdict: verificationResult.verdict,
      trustScore: verificationResult.trustScore,
      explanation: verificationResult.explanation,
      sources: verificationResult.sources || [],
      url: newsData.url
    };
  } catch (error) {
    console.error('요약 및 검증 오류:', error);
    return {
      success: false,
      error: `요약 및 검증 실패: ${error.message}`
    };
  }
}

// 뉴스 콘텐츠 검증 요청
async function verifyNewsContent(newsData, sendResponse) {
  console.log('[백그라운드] 뉴스 콘텐츠 검증 요청 처리:', newsData);
  
  try {
    // API 엔드포인트
    const apiUrl = 'http://localhost:3000/api/verify';
    
    // API 요청
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        url: newsData.url,
        content: newsData.content
      })
    });
    
    // 응답이 성공적인지 확인
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[백그라운드] API 오류 응답 ${response.status}:`, errorText);
      sendResponse({
        success: false,
        message: `서버 오류: ${response.status} - ${errorText}`
      });
      return;
    }
    
    // 응답 JSON 파싱
    const data = await response.json();
    console.log('[백그라운드] API 응답:', data);
    
    // 응답 전달
    sendResponse({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('[백그라운드] 검증 요청 처리 중 오류:', error);
    sendResponse({
      success: false,
      message: `검증 요청 처리 중 오류: ${error.message}`
    });
  }
} 