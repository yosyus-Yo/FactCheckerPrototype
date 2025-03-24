/**
 * FactChecker 애플리케이션 메인 자바스크립트 파일
 */

// 전역 변수
let currentClaims = [];
let currentVerificationResult = null;
let detectedClaims = [];
let currentStreamSessionId = null; // 스트림 세션 ID

// DOM 요소
const contentTypeSelect = document.getElementById('content-type');
const contentTextarea = document.getElementById('content-text');
const analyzeButton = document.getElementById('analyze-btn');
const claimsContainer = document.getElementById('claims-container');
const verificationStatus = document.getElementById('verification-status');
const verificationResults = document.getElementById('verification-results');
const startArButton = document.getElementById('start-ar');
const resultsContainer = document.getElementById('results-container');

// 스트림 분석을 위한 UI 요소 생성
const streamContainer = document.createElement('div');
streamContainer.id = 'stream-container';
streamContainer.className = 'stream-container hidden';
streamContainer.innerHTML = `
  <h3>실시간 미디어 스트림 분석</h3>
  <div class="input-group">
    <label for="stream-url">미디어 스트림 URL</label>
    <input type="text" id="stream-url" placeholder="스트림 URL을 입력하세요">
  </div>
  <div class="input-group">
    <label for="stream-type">스트림 유형</label>
    <select id="stream-type">
      <option value="LIVE">실시간</option>
      <option value="VOD">VOD</option>
    </select>
  </div>
  <div class="button-group">
    <button id="start-stream-btn" class="primary-btn">스트림 분석 시작</button>
    <button id="stop-stream-btn" class="secondary-btn" disabled>분석 중단</button>
  </div>
  <div id="stream-status" class="status-container hidden">
    <div class="progress-container">
      <div class="progress-bar" style="width: 0%"></div>
    </div>
    <p class="status-message">준비 중...</p>
  </div>
  <div id="stream-results" class="stream-results hidden">
    <h4>실시간 분석 결과</h4>
    <div class="transcript-container">
      <h5>트랜스크립트</h5>
      <div id="transcript-content" class="transcript-content"></div>
    </div>
    <div class="detected-claims-container">
      <h5>감지된 주장</h5>
      <ul id="stream-claims-list" class="claims-list"></ul>
    </div>
  </div>
`;

// 페이지에 스트림 컨테이너 추가
resultsContainer.appendChild(streamContainer);

// 스트림 관련 UI 요소 선택
const streamUrlInput = document.getElementById('stream-url');
const streamTypeSelect = document.getElementById('stream-type');
const startStreamButton = document.getElementById('start-stream-btn');
const stopStreamButton = document.getElementById('stop-stream-btn');
const streamStatus = document.getElementById('stream-status');
const streamResults = document.getElementById('stream-results');
const transcriptContent = document.getElementById('transcript-content');
const streamClaimsList = document.getElementById('stream-claims-list');

// 추가 버튼
const detectClaimsButton = document.createElement('button');
detectClaimsButton.id = 'detect-claims-btn';
detectClaimsButton.textContent = '주장 감지하기';
detectClaimsButton.className = 'secondary-btn';

// 스트림 분석 버튼 추가
const streamAnalyzeButton = document.createElement('button');
streamAnalyzeButton.id = 'stream-analyze-btn';
streamAnalyzeButton.textContent = '스트림 분석';
streamAnalyzeButton.className = 'secondary-btn';

// 버튼 삽입
if (analyzeButton && analyzeButton.parentNode) {
  analyzeButton.parentNode.insertBefore(detectClaimsButton, analyzeButton.nextSibling);
}
if (detectClaimsButton && detectClaimsButton.parentNode) {
  detectClaimsButton.parentNode.insertBefore(streamAnalyzeButton, detectClaimsButton.nextSibling);
}

// 이벤트 리스너 등록
document.addEventListener('DOMContentLoaded', initApp);
analyzeButton.addEventListener('click', analyzeContent);
detectClaimsButton.addEventListener('click', detectClaims);
startArButton.addEventListener('click', startArVisualization);
streamAnalyzeButton.addEventListener('click', toggleStreamAnalysisUI);
startStreamButton.addEventListener('click', startStreamAnalysis);
stopStreamButton.addEventListener('click', stopStreamAnalysis);

/**
 * 앱 초기화
 */
function initApp() {
  console.log('FactChecker 앱 초기화');
  
  // AR 버튼 비활성화 (검증 결과가 있을 때만 활성화)
  startArButton.disabled = true;
  
  // SSE 연결 설정
  setupEventSource();
  
  // 지원되는 주장 유형 가져오기
  fetchClaimTypes();
}

/**
 * Server-Sent Events 연결 설정
 */
function setupEventSource() {
  const eventSource = new EventSource('/api/facts/stream');
  
  eventSource.onopen = () => {
    console.log('SSE 연결이 열렸습니다.');
  };
  
  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerEvent(data);
    } catch (error) {
      console.error('SSE 데이터 파싱 오류:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE 연결 오류:', error);
    // 연결 재시도
    setTimeout(() => {
      setupEventSource();
    }, 3000);
  };
}

/**
 * 서버 이벤트 처리
 * @param {Object} data - 서버에서 전송한 이벤트 데이터
 */
function handleServerEvent(data) {
  console.log('서버 이벤트 수신:', data);
  
  if (data.eventType === 'verification_progress') {
    updateVerificationProgress(data);
  } else if (data.eventType === 'verification_result') {
    displayVerificationResult(data);
  } else if (data.eventType === 'stream_analysis_progress') {
    updateStreamProgress(data);
  } else if (data.eventType === 'stream_claims_detected') {
    handleNewStreamClaims(data);
  } else if (data.eventType === 'stream_analysis_completed') {
    handleStreamCompletion(data);
  } else if (data.eventType === 'stream_analysis_error') {
    handleStreamError(data);
  }
}

/**
 * 검증 진행상황 업데이트
 * @param {Object} data - 진행상황 데이터
 */
function updateVerificationProgress(data) {
  const progressBar = verificationStatus.querySelector('.progress-bar');
  const statusMessage = verificationStatus.querySelector('.status-message');
  
  progressBar.style.width = `${data.progress}%`;
  statusMessage.textContent = data.status;
}

/**
 * 콘텐츠 분석 실행
 */
async function analyzeContent() {
  // 입력 검증
  const contentType = contentTypeSelect.value;
  const content = contentTextarea.value.trim();
  
  if (!content) {
    alert('분석할 콘텐츠를 입력해주세요.');
    return;
  }
  
  // UI 업데이트 - 로딩 상태
  analyzeButton.disabled = true;
  analyzeButton.textContent = '분석 중...';
  claimsContainer.innerHTML = '<p class="analyzing">콘텐츠를 분석 중입니다...</p>';
  
  // 진행 상태 초기화
  const progressBar = verificationStatus.querySelector('.progress-bar');
  const statusMessage = verificationStatus.querySelector('.status-message');
  progressBar.style.width = '0%';
  statusMessage.textContent = '분석 시작...';
  
  try {
    // API 호출
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content,
        contentType
      })
    });
    
    if (!response.ok) {
      throw new Error('분석 요청이 실패했습니다.');
    }
    
    const result = await response.json();
    console.log('분석 결과:', result);
    
    // 결과 표시
    displayAnalysisResults(result);
  } catch (error) {
    console.error('분석 중 오류 발생:', error);
    claimsContainer.innerHTML = `<p class="error">오류 발생: ${error.message}</p>`;
  } finally {
    // UI 상태 복원
    analyzeButton.disabled = false;
    analyzeButton.textContent = '분석 시작';
  }
}

/**
 * 분석 결과 표시
 * @param {Object} result - 분석 결과 데이터
 */
function displayAnalysisResults(result) {
  // 현재 클레임 저장
  currentClaims = result.result.claims || [];
  
  // 클레임이 없는 경우
  if (!currentClaims.length) {
    claimsContainer.innerHTML = '<p class="no-claims">검증할 주장을 찾을 수 없습니다.</p>';
    return;
  }
  
  // 클레임 목록 표시
  let claimsHtml = '';
  currentClaims.forEach((claim, index) => {
    claimsHtml += `
      <div class="claim-item" data-id="${claim._id || claim.id || index}">
        <p class="claim-text">${claim.text}</p>
        <p class="claim-confidence">신뢰도: ${Math.round(claim.confidence * 100)}%</p>
      </div>
    `;
  });
  
  claimsContainer.innerHTML = claimsHtml;
  
  // 저장된 클레임이 있는 경우 (팩트체킹 시작됨)
  if (result.result.savedClaim) {
    statusMessage.textContent = '팩트체킹 진행 중...';
    progressBar.style.width = '30%';
  }
}

/**
 * 검증 결과 표시
 * @param {Object} data - 검증 결과 데이터
 */
function displayVerificationResult(data) {
  // 현재 검증 결과 저장
  currentVerificationResult = data.result;
  
  // AR 버튼 활성화
  startArButton.disabled = false;
  
  // 상태 코드에 따른 클래스 결정
  let statusClass = 'unverified';
  let statusText = '미확인';
  
  switch (data.result.status) {
    case 'VERIFIED_TRUE':
      statusClass = 'true';
      statusText = '사실';
      break;
    case 'VERIFIED_FALSE':
      statusClass = 'false';
      statusText = '거짓';
      break;
    case 'PARTIALLY_TRUE':
      statusClass = 'partial';
      statusText = '부분 사실';
      break;
  }
  
  // 소스 목록 생성
  let sourcesHtml = '';
  if (data.result.sources && data.result.sources.length) {
    sourcesHtml = `
      <div class="result-sources">
        <h4>출처:</h4>
        <ul class="source-list">
    `;
    
    data.result.sources.forEach(source => {
      sourcesHtml += `
        <li class="source-item">
          <a href="${source.url}" target="_blank">${source.name}</a>
        </li>
      `;
    });
    
    sourcesHtml += `
        </ul>
      </div>
    `;
  }
  
  // 결과 HTML 생성
  const resultHtml = `
    <div class="verification-result">
      <span class="result-status ${statusClass}">${statusText}</span>
      <p class="result-explanation">${data.result.explanation}</p>
      ${sourcesHtml}
    </div>
  `;
  
  // 결과 표시
  verificationResults.innerHTML = resultHtml;
  
  // 상태 표시 업데이트
  const progressBar = verificationStatus.querySelector('.progress-bar');
  const statusMessage = verificationStatus.querySelector('.status-message');
  progressBar.style.width = '100%';
  statusMessage.textContent = '검증 완료';
}

/**
 * AR 시각화 시작
 */
function startArVisualization() {
  if (!currentVerificationResult) {
    alert('시각화할 검증 결과가 없습니다.');
    return;
  }
  
  // AR 시각화 스크립트 호출
  if (typeof initARVisualization === 'function') {
    initARVisualization(currentVerificationResult);
  } else {
    console.error('AR 시각화 스크립트가 로드되지 않았습니다.');
    alert('AR 시각화를 초기화할 수 없습니다.');
  }
}

/**
 * 주장 감지 API 호출
 */
async function detectClaims() {
  // 입력 검증
  const content = contentTextarea.value.trim();
  
  if (!content) {
    alert('분석할 텍스트를 입력해주세요.');
    return;
  }
  
  // UI 업데이트 - 로딩 상태
  detectClaimsButton.disabled = true;
  detectClaimsButton.textContent = '주장 감지 중...';
  claimsContainer.innerHTML = '<p class="analyzing">주장을 감지 중입니다...</p>';
  
  try {
    // API 호출
    const response = await fetch('/api/detect-claims', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: content
      })
    });
    
    if (!response.ok) {
      throw new Error('주장 감지 요청이 실패했습니다.');
    }
    
    const result = await response.json();
    console.log('주장 감지 결과:', result);
    
    // 결과 저장
    detectedClaims = result.result.claims || [];
    
    // 결과 표시
    displayDetectedClaims(result.result);
  } catch (error) {
    console.error('주장 감지 중 오류 발생:', error);
    claimsContainer.innerHTML = `<p class="error">오류 발생: ${error.message}</p>`;
  } finally {
    // UI 상태 복원
    detectClaimsButton.disabled = false;
    detectClaimsButton.textContent = '주장 감지하기';
  }
}

/**
 * 감지된 주장 표시
 * @param {Object} result - 주장 감지 결과
 */
function displayDetectedClaims(result) {
  const claims = result.claims;
  const summary = result.summary;
  
  // 주장이 없는 경우
  if (!claims || claims.length === 0) {
    claimsContainer.innerHTML = '<p class="no-claims">감지된 주장이 없습니다.</p>';
    return;
  }
  
  // 요약 정보 생성
  let summaryHtml = `
    <div class="claims-summary">
      <h3>주장 감지 결과 요약</h3>
      <p>총 ${summary.totalClaims}개의 주장이 감지되었습니다.</p>
      <p>평균 우선순위: ${(summary.averagePriority * 100).toFixed(1)}%</p>
      <div class="type-distribution">
        <h4>유형별 분포:</h4>
        <ul>
  `;
  
  for (const [type, count] of Object.entries(summary.typeDistribution)) {
    summaryHtml += `<li>${type}: ${count}개</li>`;
  }
  
  summaryHtml += `
        </ul>
      </div>
    </div>
  `;
  
  // 주장 목록 생성
  let claimsHtml = '<div class="claims-list">';
  
  claims.forEach((claim, index) => {
    // 우선순위에 따른 색상 결정
    const priorityColor = getPriorityColor(claim.priority);
    
    claimsHtml += `
      <div class="claim-item" data-id="${index}">
        <div class="claim-header">
          <span class="claim-type">${claim.type}</span>
          <span class="claim-priority" style="color: ${priorityColor}">
            우선순위: ${(claim.priority * 100).toFixed(1)}%
          </span>
        </div>
        <p class="claim-text">${claim.text}</p>
        <p class="claim-confidence">신뢰도: ${(claim.confidence * 100).toFixed(1)}%</p>
        ${claim.explanation ? `<p class="claim-explanation">설명: ${claim.explanation}</p>` : ''}
      </div>
    `;
  });
  
  claimsHtml += '</div>';
  
  // 최종 HTML 조합
  claimsContainer.innerHTML = summaryHtml + claimsHtml;
}

/**
 * 우선순위에 따른 색상 반환
 * @param {number} priority - 우선순위 점수 (0-1)
 * @returns {string} - 색상 코드
 */
function getPriorityColor(priority) {
  if (priority >= 0.8) return '#4CAF50'; // 녹색 (높음)
  if (priority >= 0.5) return '#FFC107'; // 노란색 (중간)
  return '#9E9E9E'; // 회색 (낮음)
}

/**
 * 지원되는 주장 유형 가져오기
 */
async function fetchClaimTypes() {
  try {
    const response = await fetch('/api/claim-types');
    if (response.ok) {
      const data = await response.json();
      console.log('지원되는 주장 유형:', data.result.types);
    }
  } catch (error) {
    console.error('주장 유형 가져오기 실패:', error);
  }
}

/**
 * 스트림 분석 UI 토글
 */
function toggleStreamAnalysisUI() {
  const isHidden = streamContainer.classList.contains('hidden');
  
  if (isHidden) {
    streamContainer.classList.remove('hidden');
    streamAnalyzeButton.textContent = '스트림 분석 닫기';
    // 다른 컨테이너 숨기기
    claimsContainer.classList.add('hidden');
  } else {
    streamContainer.classList.add('hidden');
    streamAnalyzeButton.textContent = '스트림 분석';
    claimsContainer.classList.remove('hidden');
  }
}

/**
 * 스트림 분석 시작
 */
async function startStreamAnalysis() {
  // 입력 검증
  const streamUrl = streamUrlInput.value.trim();
  const streamType = streamTypeSelect.value;
  
  if (!streamUrl) {
    alert('분석할 미디어 스트림 URL을 입력해주세요.');
    return;
  }
  
  // UI 업데이트 - 로딩 상태
  startStreamButton.disabled = true;
  stopStreamButton.disabled = false;
  streamStatus.classList.remove('hidden');
  streamResults.classList.remove('hidden');
  
  // 상태 초기화
  const progressBar = streamStatus.querySelector('.progress-bar');
  const statusMessage = streamStatus.querySelector('.status-message');
  progressBar.style.width = '0%';
  statusMessage.textContent = '스트림 연결 중...';
  transcriptContent.innerHTML = '';
  streamClaimsList.innerHTML = '';
  
  try {
    // API 호출
    const response = await fetch('/api/stream-analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        mediaUrl: streamUrl,
        streamType: streamType
      })
    });
    
    if (!response.ok) {
      throw new Error('스트림 분석 요청이 실패했습니다.');
    }
    
    const result = await response.json();
    console.log('스트림 분석 시작 결과:', result);
    
    // 세션 ID 저장
    currentStreamSessionId = result.result.sessionId;
    
  } catch (error) {
    console.error('스트림 분석 시작 중 오류 발생:', error);
    statusMessage.textContent = `오류: ${error.message}`;
    
    // UI 상태 복원
    startStreamButton.disabled = false;
    stopStreamButton.disabled = true;
  }
}

/**
 * 스트림 분석 중단
 */
async function stopStreamAnalysis() {
  if (!currentStreamSessionId) {
    return;
  }
  
  try {
    // 실제 구현에서는 서버에 중단 요청 전송
    console.log('스트림 분석 중단 요청:', currentStreamSessionId);
    
    // UI 상태 복원
    startStreamButton.disabled = false;
    stopStreamButton.disabled = true;
    
    const statusMessage = streamStatus.querySelector('.status-message');
    statusMessage.textContent = '분석이 중단되었습니다.';
    
  } catch (error) {
    console.error('스트림 분석 중단 중 오류 발생:', error);
  }
}

/**
 * 스트림 분석 진행 상황 업데이트
 * @param {Object} data - 진행 상황 데이터
 */
function updateStreamProgress(data) {
  if (!streamStatus.classList.contains('hidden')) {
    const progressBar = streamStatus.querySelector('.progress-bar');
    const statusMessage = streamStatus.querySelector('.status-message');
    
    progressBar.style.width = `${data.progress}%`;
    statusMessage.textContent = `${data.status} (${data.progress}%)`;
  }
}

/**
 * 스트림에서 감지된 주장 처리
 * @param {Object} data - 감지된 주장 데이터
 */
function handleNewStreamClaims(data) {
  // 새로운 주장을 목록에 추가
  data.claims.forEach(claim => {
    const claimItem = document.createElement('li');
    claimItem.className = 'claim-item';
    
    const claimText = document.createElement('p');
    claimText.className = 'claim-text';
    claimText.textContent = claim.text;
    
    const claimMeta = document.createElement('div');
    claimMeta.className = 'claim-meta';
    claimMeta.innerHTML = `
      <span class="claim-confidence">신뢰도: ${Math.round(claim.confidence * 100)}%</span>
      <span class="claim-type">${claim.type || '기타'}</span>
      <span class="claim-time">${new Date(claim.timestamp).toLocaleTimeString()}</span>
    `;
    
    const verifyButton = document.createElement('button');
    verifyButton.className = 'small-btn';
    verifyButton.textContent = '검증';
    verifyButton.onclick = () => verifyStreamClaim(claim);
    
    claimItem.appendChild(claimText);
    claimItem.appendChild(claimMeta);
    claimItem.appendChild(verifyButton);
    streamClaimsList.appendChild(claimItem);
  });
  
  // 트랜스크립트 업데이트 - 실제 구현에서는 데이터에서 최신 트랜스크립트를 가져옴
  if (data.transcript) {
    transcriptContent.textContent = data.transcript;
  }
}

/**
 * 스트림 분석 완료 처리
 * @param {Object} data - 완료 데이터
 */
function handleStreamCompletion(data) {
  const statusMessage = streamStatus.querySelector('.status-message');
  statusMessage.textContent = '분석이 완료되었습니다.';
  
  // 진행 표시줄 100%로 설정
  const progressBar = streamStatus.querySelector('.progress-bar');
  progressBar.style.width = '100%';
  
  // 전체 트랜스크립트 표시
  if (data.result && data.result.transcript) {
    transcriptContent.textContent = data.result.transcript;
  }
  
  // UI 상태 복원
  startStreamButton.disabled = false;
  stopStreamButton.disabled = true;
  
  // 세션 ID 초기화
  currentStreamSessionId = null;
}

/**
 * 스트림 분석 오류 처리
 * @param {Object} data - 오류 데이터
 */
function handleStreamError(data) {
  const statusMessage = streamStatus.querySelector('.status-message');
  statusMessage.textContent = `오류: ${data.error}`;
  
  // UI 상태 복원
  startStreamButton.disabled = false;
  stopStreamButton.disabled = true;
  
  // 세션 ID 초기화
  currentStreamSessionId = null;
}

/**
 * 스트림에서 감지된 주장 검증
 * @param {Object} claim - 검증할 주장
 */
async function verifyStreamClaim(claim) {
  try {
    // API 호출
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        content: claim.text,
        contentType: 'TEXT'
      })
    });
    
    if (!response.ok) {
      throw new Error('주장 검증 요청이 실패했습니다.');
    }
    
    const result = await response.json();
    console.log('주장 검증 결과:', result);
    
    // 결과 표시 (여기서는 간단히 알림만 표시)
    alert(`"${claim.text}" 주장의 검증이 시작되었습니다.`);
    
  } catch (error) {
    console.error('주장 검증 중 오류 발생:', error);
    alert(`주장 검증 중 오류 발생: ${error.message}`);
  }
} 