/**
 * FactChecker 팩트체킹 기능 관련 자바스크립트
 * 팩트체킹 기능과 관련된 클라이언트 측 스크립트를 제공합니다.
 */

// 신뢰도 점수를 시각적 표현으로 변환
function trustScoreToVisual(score) {
  if (score >= 0.9) return '매우 높음';
  if (score >= 0.7) return '높음';
  if (score >= 0.4) return '중간';
  if (score >= 0.2) return '낮음';
  return '매우 낮음';
}

// 상태 코드를 한글 텍스트로 변환
function statusToText(status) {
  const statusMap = {
    'VERIFIED_TRUE': '사실',
    'VERIFIED_FALSE': '거짓',
    'PARTIALLY_TRUE': '부분 사실',
    'UNVERIFIED': '미확인',
    'DISPUTED': '논쟁 중'
  };
  
  return statusMap[status] || '미확인';
}

// 신뢰도에 따른 색상 코드 반환
function getTrustScoreColor(score) {
  if (score >= 0.7) return '#4CAF50'; // 녹색
  if (score >= 0.4) return '#FFC107'; // 노란색
  return '#F44336'; // 빨간색
}

// 검증 상태에 따른 아이콘 클래스 반환
function getStatusIconClass(status) {
  switch (status) {
    case 'VERIFIED_TRUE':
      return 'check-circle';
    case 'VERIFIED_FALSE':
      return 'cancel';
    case 'PARTIALLY_TRUE':
      return 'help';
    default:
      return 'help-outline';
  }
}

// 검증 상태에 따른 배경색 반환
function getStatusBackgroundColor(status) {
  switch (status) {
    case 'VERIFIED_TRUE':
      return 'rgba(76, 175, 80, 0.1)';
    case 'VERIFIED_FALSE':
      return 'rgba(244, 67, 54, 0.1)';
    case 'PARTIALLY_TRUE':
      return 'rgba(255, 193, 7, 0.1)';
    default:
      return 'rgba(158, 158, 158, 0.1)';
  }
}

// 주장에 대한 팩트체킹 요청
async function requestFactCheck(claim) {
  try {
    const response = await fetch('/api/factcheck', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ claim })
    });
    
    if (!response.ok) {
      throw new Error('팩트체킹 요청이 실패했습니다.');
    }
    
    return await response.json();
  } catch (error) {
    console.error('팩트체킹 요청 중 오류:', error);
    throw error;
  }
}

// 설명 텍스트에서 중요 부분 강조
function highlightExplanation(explanation) {
  // 키워드에 따른 강조 처리
  const keywords = {
    '사실': 'true',
    '거짓': 'false',
    '부분적': 'partial',
    '확인됨': 'true',
    '확인되지 않음': 'unverified',
    '일부 사실': 'partial'
  };
  
  let result = explanation;
  
  // 키워드 강조
  for (const [keyword, className] of Object.entries(keywords)) {
    const regex = new RegExp(`(${keyword})`, 'gi');
    result = result.replace(regex, `<span class="highlight-${className}">$1</span>`);
  }
  
  return result;
}

// 예측된 신뢰도 표시 생성
function createTrustScoreIndicator(score) {
  const visualScore = trustScoreToVisual(score);
  const color = getTrustScoreColor(score);
  
  return `
    <div class="trust-score-indicator" style="color: ${color}">
      <div class="score-value">${Math.round(score * 100)}%</div>
      <div class="score-label">${visualScore}</div>
    </div>
  `;
}

// 검증 결과 요약 카드 생성
function createResultSummaryCard(result) {
  const statusText = statusToText(result.status);
  const backgroundColor = getStatusBackgroundColor(result.status);
  const trustScoreIndicator = createTrustScoreIndicator(result.trustScore);
  
  return `
    <div class="result-summary-card" style="background-color: ${backgroundColor}">
      <div class="result-status ${result.status.toLowerCase()}">${statusText}</div>
      ${trustScoreIndicator}
      <div class="result-summary">${result.explanation.split('.')[0]}.</div>
    </div>
  `;
}

// 소스 카드 목록 생성
function createSourceCards(sources) {
  if (!sources || sources.length === 0) {
    return '<p class="no-sources">제공된 소스가 없습니다.</p>';
  }
  
  let html = '<div class="source-cards">';
  
  sources.forEach(source => {
    const credibility = source.credibility || 0.7;
    const credibilityText = trustScoreToVisual(credibility);
    const credibilityColor = getTrustScoreColor(credibility);
    
    html += `
      <div class="source-card">
        <div class="source-name">
          <a href="${source.url}" target="_blank">${source.name}</a>
        </div>
        <div class="source-credibility" style="color: ${credibilityColor}">
          신뢰도: ${credibilityText}
        </div>
      </div>
    `;
  });
  
  html += '</div>';
  return html;
} 