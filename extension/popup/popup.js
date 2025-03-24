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
  const statusElement = document.getElementById('status');
  const serverStatusElement = document.getElementById('server-status');
  const claimsCountElement = document.getElementById('claims-count');
  const verifiedCountElement = document.getElementById('verified-count');
  
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
      } else {
        updateStatusElement(serverStatusElement, '오프라인', 'status-disconnected');
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
  
  // 초기 상태 업데이트
  updateExtensionStatus();
  checkServerStatus();
  
  // 주기적으로 통계 업데이트 (3초마다)
  setInterval(updateClaimsStats, 3000);
}); 