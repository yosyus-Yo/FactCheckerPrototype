/**
 * FactChecker 확장프로그램 팝업 스크립트
 * 서버 연결 상태 확인 및 사용자 인터페이스 관리
 */

document.addEventListener('DOMContentLoaded', function() {
  // UI 요소 참조
  const activateButton = document.getElementById('activate-button');
  const deactivateButton = document.getElementById('deactivate-button');
  const captureButton = document.getElementById('capture-button');
  const stopCaptureButton = document.getElementById('stop-capture-button');
  const verifyButton = document.getElementById('verify-button');
  const statusElement = document.getElementById('status');
  const serverStatusElement = document.getElementById('server-status');
  const claimsCountElement = document.getElementById('claims-count');
  const verifiedCountElement = document.getElementById('verified-count');
  const searchServiceStatusElement = document.getElementById('search-service-status');
  
  // 상태 변수
  let isActive = false;
  let isCapturing = false;
  
  /**
   * 서버 상태 확인
   */
  function checkServerStatus() {
    chrome.runtime.sendMessage({ action: 'getServerStatus' }, response => {
      if (chrome.runtime.lastError) {
        console.error('서버 상태 확인 오류:', chrome.runtime.lastError);
        updateStatusElement(serverStatusElement, '연결 실패', 'status-error');
        return;
      }
      
      if (response && response.isConnected) {
        updateStatusElement(serverStatusElement, '연결됨', 'status-connected');
        
        // 서비스 상태 업데이트
        if (response.services) {
          const searchServiceAvailable = 
            (response.services.brave_search === 'available' || 
             response.services.tavily === 'available');
             
          updateStatusElement(
            searchServiceStatusElement, 
            searchServiceAvailable ? '사용 가능' : '사용 불가', 
            searchServiceAvailable ? 'status-connected' : 'status-error'
          );
        }
      } else {
        updateStatusElement(serverStatusElement, '오프라인', 'status-disconnected');
        updateStatusElement(searchServiceStatusElement, '연결 안됨', 'status-disconnected');
      }
    });
  }
  
  /**
   * 상태 요소 업데이트
   * @param {HTMLElement} element 업데이트할 요소
   * @param {string} text 표시할 텍스트
   * @param {string} className 적용할 클래스
   */
  function updateStatusElement(element, text, className) {
    if (element) {
      element.textContent = text;
      element.className = 'status-value ' + className;
    }
  }
  
  /**
   * 확장프로그램 상태 업데이트
   */
  function updateExtensionStatus() {
    chrome.storage.local.get(['isActive', 'isCapturing'], function(result) {
      isActive = result.isActive || false;
      isCapturing = result.isCapturing || false;
      
      updateStatusElement(statusElement, isActive ? '활성화됨' : '비활성화됨', 
        isActive ? 'status-connected' : 'status-disconnected');
      
      // 버튼 표시 상태 업데이트
      if (activateButton && deactivateButton) {
        activateButton.style.display = isActive ? 'none' : 'inline-block';
        deactivateButton.style.display = isActive ? 'inline-block' : 'none';
      }
      
      if (captureButton && stopCaptureButton) {
        captureButton.style.display = (isActive && !isCapturing) ? 'inline-block' : 'none';
        stopCaptureButton.style.display = (isActive && isCapturing) ? 'inline-block' : 'none';
      }
      
      // 주장검증 버튼 활성화/비활성화
      if (verifyButton) {
        verifyButton.disabled = !isActive;
      }
    });
  }
  
  /**
   * 주장 통계 업데이트
   */
  function updateClaimsStats() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'getStats'}, function(response) {
          if (chrome.runtime.lastError) {
            console.warn('통계 요청 오류:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.success) {
            if (claimsCountElement) {
              claimsCountElement.textContent = response.detected || 0;
            }
            if (verifiedCountElement) {
              verifiedCountElement.textContent = response.verified || 0;
            }
          }
        });
      }
    });
  }
  
  /**
   * 주장검증 버튼 클릭 이벤트
   */
  function onVerifyClick() {
    if (!verifyButton) return;
    
    console.log('주장검증 버튼 클릭됨', {
      timestamp: new Date().toISOString(),
      context: 'popup.js'
    });
    
    // 분석 중 상태로 변경
    updateButton('analyzing');
    
    // 현재 활성 탭 가져오기
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) {
        console.error('활성 탭을 찾을 수 없습니다.');
        updateButton('error');
        return;
      }
      
      const tabId = tabs[0].id;
      const tabUrl = tabs[0].url;
      
      console.log('활성 탭 정보:', {
        tabId: tabId,
        tabUrl: tabUrl,
        timestamp: new Date().toISOString()
      });
      
      // 서버 상태 확인
      chrome.runtime.sendMessage({ action: 'checkServerStatus' }, function(statusResponse) {
        console.log('서버 상태 응답:', statusResponse, {
          timestamp: new Date().toISOString()
        });
        
        // 서버가 연결되지 않은 경우
        if (!statusResponse || !statusResponse.serverStatus || !statusResponse.serverStatus.isConnected) {
          console.error('서버에 연결할 수 없습니다.');
          alert('서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해주세요.');
          updateButton('error');
          return;
        }
        
        // 콘텐츠 스크립트에 메시지 전송
        console.log('콘텐츠 스크립트에 verifyNewsContent 메시지 전송:', {
          tabId: tabId,
          action: 'verifyNewsContent',
          timestamp: new Date().toISOString()
        });
        
        chrome.tabs.sendMessage(tabId, {
          action: 'verifyNewsContent', 
          forceRefresh: true
        }, function(response) {
          if (chrome.runtime.lastError) {
            console.error('주장검증 요청 오류:', chrome.runtime.lastError, {
              errorMessage: chrome.runtime.lastError.message,
              timestamp: new Date().toISOString()
            });
            
            // 콘텐츠 스크립트 주입 시도
            console.log('콘텐츠 스크립트 주입 시도:', {
              tabId: tabId,
              timestamp: new Date().toISOString()
            });
            
            // 백그라운드 스크립트에 콘텐츠 스크립트 주입 요청
            chrome.runtime.sendMessage({
              action: 'injectContentScript',
              tabId: tabId
            }, function(injectResponse) {
              console.log('콘텐츠 스크립트 주입 결과:', injectResponse, {
                timestamp: new Date().toISOString()
              });
              
              if (injectResponse && injectResponse.success) {
                // 잠시 기다린 후 다시 메시지 전송
                setTimeout(() => {
                  console.log('주장검증 요청 재시도:', {
                    tabId: tabId,
                    timestamp: new Date().toISOString()
                  });
                  
                  chrome.tabs.sendMessage(tabId, {
                    action: 'verifyNewsContent',
                    forceRefresh: true
                  }, function(retryResponse) {
                    console.log('주장검증 재시도 응답:', retryResponse, {
                      timestamp: new Date().toISOString()
                    });
                    
                    // 성공 시 팝업 닫기
                    if (retryResponse && retryResponse.success) {
                      setTimeout(() => window.close(), 500);
                    }
                  });
                }, 500);
              } else {
                console.error('콘텐츠 스크립트 주입 실패', {
                  timestamp: new Date().toISOString()
                });
                alert('콘텐츠 스크립트를 주입할 수 없습니다. 페이지를 새로고침 후 다시 시도해주세요.');
                updateButton('error');
              }
            });
          } else {
            console.log('주장검증 응답:', response, {
              timestamp: new Date().toISOString()
            });
            
            // 성공 시 팝업 닫기
            if (response && response.success) {
              setTimeout(() => window.close(), 500);
            }
          }
        });
      });
    });
  }
  
  /**
   * 버튼 상태 업데이트 함수
   * @param {string} state - 버튼 상태 ('default', 'analyzing', 'error')
   */
  function updateButton(state) {
    if (!verifyButton) return;
    
    switch (state) {
      case 'analyzing':
        verifyButton.textContent = '분석 중...';
        verifyButton.disabled = true;
        verifyButton.className = 'btn btn-secondary';
        break;
      case 'error':
        verifyButton.textContent = '주장 검증';
        verifyButton.disabled = false;
        verifyButton.className = 'btn btn-danger';
        break;
      default:
        verifyButton.textContent = '주장 검증';
        verifyButton.disabled = false;
        verifyButton.className = 'btn btn-primary';
    }
  }
  
  /**
   * 활성화 버튼 클릭 이벤트
   */
  function onActivateClick() {
    if (!activateButton) return;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'activate'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('활성화 오류:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.success) {
            chrome.storage.local.set({isActive: true});
            updateExtensionStatus();
          }
        });
      }
    });
  }
  
  /**
   * 비활성화 버튼 클릭 이벤트
   */
  function onDeactivateClick() {
    if (!deactivateButton) return;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'deactivate'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('비활성화 오류:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.success) {
            chrome.storage.local.set({isActive: false});
            updateExtensionStatus();
          }
        });
      }
    });
  }
  
  /**
   * 화면 캡처 시작 버튼 클릭 이벤트
   */
  function onCaptureClick() {
    if (!captureButton) return;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'startCapture'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('화면 캡처 시작 오류:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.success) {
            chrome.storage.local.set({isCapturing: true});
            updateExtensionStatus();
          }
        });
      }
    });
  }
  
  /**
   * 화면 캡처 중지 버튼 클릭 이벤트
   */
  function onStopCaptureClick() {
    if (!stopCaptureButton) return;
    
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length > 0 && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'stopCapture'}, function(response) {
          if (chrome.runtime.lastError) {
            console.error('화면 캡처 중지 오류:', chrome.runtime.lastError);
            return;
          }
          
          if (response && response.success) {
            chrome.storage.local.set({isCapturing: false});
            updateExtensionStatus();
          }
        });
      }
    });
  }
  
  // 서버 상태 변경 리스너
  chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
    if (message.action === 'serverStatusChanged') {
      updateStatusElement(serverStatusElement, 
        message.isConnected ? '연결됨' : '오프라인',
        message.isConnected ? 'status-connected' : 'status-disconnected');
    }
    return true;
  });
  
  // 이벤트 리스너 등록
  if (activateButton) {
    activateButton.addEventListener('click', onActivateClick);
  }
  
  if (deactivateButton) {
    deactivateButton.addEventListener('click', onDeactivateClick);
  }
  
  if (captureButton) {
    captureButton.addEventListener('click', onCaptureClick);
  }
  
  if (stopCaptureButton) {
    stopCaptureButton.addEventListener('click', onStopCaptureClick);
  }
  
  if (verifyButton) {
    verifyButton.addEventListener('click', onVerifyClick);
  }
  
  // 페이지 로드 시 상태 업데이트
  checkServerStatus();
  updateExtensionStatus();
  updateClaimsStats();
  
  // 5초마다 상태 새로고침
  setInterval(checkServerStatus, 5000);
}); 