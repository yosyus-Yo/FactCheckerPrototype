(() => {
  // Material Icons 스타일시트 추가
  if (!document.querySelector('link[href*="Material+Icons"]')) {
    const linkElement = document.createElement('link');
    linkElement.rel = 'stylesheet';
    linkElement.href = 'https://fonts.googleapis.com/icon?family=Material+Icons';
    document.head.appendChild(linkElement);
  }

  console.log('[FactChecker] 콘텐츠 스크립트 초기화 시작...');

  // 팩트체크 오버레이 컴포넌트
  class FactCheckOverlay {
    constructor() {
      if (FactCheckOverlay.instance) {
        return FactCheckOverlay.instance;
      }
      FactCheckOverlay.instance = this;

      this.container = null;
    this.isActive = false;
      this.setupOverlay();
      this.setupMessageListener();
      
      // 디버그 로그
      console.log('[FactChecker] 오버레이 초기화 완료');
    }

    setupOverlay() {
      // 기존 오버레이 제거
      const existingOverlay = document.getElementById('fact-check-overlay');
      if (existingOverlay) {
        existingOverlay.remove();
      }

      // 새 오버레이 생성
      this.container = document.createElement('div');
      this.container.id = 'fact-check-overlay';
      this.container.style.display = 'none';
      this.container.style.padding = '20px';
      this.container.style.maxHeight = '80vh';
      this.container.style.zIndex = '2147483647'; // 최대 z-index 값으로 설정
      this.container.style.border = '2px solid #1a73e8'; // 테두리 추가
      this.container.style.transition = 'opacity 0.3s ease-in-out, transform 0.3s ease-in-out';

      // 헤더 추가
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '20px';

      const title = document.createElement('h2');
      title.textContent = 'FactChecker';
      title.style.margin = '0';
      title.style.fontSize = '18px';
      title.style.fontWeight = '600';
      title.style.color = '#1a73e8';

      const closeButton = document.createElement('button');
      closeButton.innerHTML = '<span class="material-icons">close</span>';
      closeButton.style.background = 'none';
      closeButton.style.border = 'none';
      closeButton.style.cursor = 'pointer';
      closeButton.style.color = '#5f6368';
      closeButton.style.fontSize = '20px';
      closeButton.style.padding = '4px';
      closeButton.addEventListener('click', () => this.hide());

      header.appendChild(title);
      header.appendChild(closeButton);
      this.container.appendChild(header);

      // 콘텐츠 영역 추가
      const content = document.createElement('div');
      content.id = 'fact-check-content';
      this.container.appendChild(content);

      // 문서에 추가
      document.body.appendChild(this.container);
    }

    show() {
      if (this.container) {
        // 애니메이션을 위한 초기 스타일 설정
        this.container.style.opacity = '0';
        this.container.style.transform = 'translateY(-20px)';
        this.container.style.display = 'block';
        
        // 강제 리플로우 유발
        this.container.offsetHeight;
        
        // 애니메이션 적용
        this.container.style.opacity = '1';
        this.container.style.transform = 'translateY(0)';
        
        // 표시 상태 저장
        this.isActive = true;
        
        console.log('[FactChecker] 오버레이 표시됨');
      }
    }

    hide() {
      if (this.container) {
        // 애니메이션 적용
        this.container.style.opacity = '0';
        this.container.style.transform = 'translateY(-20px)';
        
        // 애니메이션 완료 후 display 속성 변경
        setTimeout(() => {
          this.container.style.display = 'none';
          // 상태 업데이트
          this.isActive = false;
        }, 300); // 트랜지션 시간과 일치
        
        console.log('[FactChecker] 오버레이 숨김');
      }
    }

    showLoading() {
      const content = document.getElementById('fact-check-content');
      if (!content) return;
      
      content.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <div class="loading-bar">
            <div class="loading-indicator"></div>
          </div>
          <p style="margin-top: 20px; color: #5f6368;">뉴스 콘텐츠 검증 중...</p>
        </div>
      `;
      
      this.show();
    }

    showError(message) {
      const content = document.getElementById('fact-check-content');
      if (!content) return;
      
      content.innerHTML = `
        <div style="text-align: center; padding: 40px 20px;">
          <span class="material-icons" style="font-size: 48px; color: #f44336;">error_outline</span>
          <p style="margin-top: 16px; color: #f44336; font-weight: 500;">${message || '알 수 없는 오류가 발생했습니다.'}</p>
          <button id="retry-button" style="margin-top: 20px; padding: 8px 16px; background-color: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">재시도</button>
        </div>
      `;
      
      // 재시도 버튼 클릭 이벤트
      const retryButton = document.getElementById('retry-button');
      if (retryButton) {
        retryButton.addEventListener('click', () => {
          this.verifyCurrentPage();
        });
      }
      
      this.show();
    }

    showResult(data) {
      const content = document.getElementById('fact-check-content');
      if (!content) return;
      
      if (!data) {
        this.showError('검증 결과를 받아오지 못했습니다.');
        return;
      }
      
      // 메타데이터 변수 설정
      const metadata = data.metadata || {};
      
      // 점수에 따른 색상 및 아이콘 설정
      let trustColor, trustIcon, trustText;
      const score = data.trustScore || 0;
      
      if (score >= 0.8) {
        trustColor = '#4CAF50';
        trustIcon = 'verified';
        trustText = '신뢰할 수 있음';
      } else if (score >= 0.5) {
        trustColor = '#FF9800';
        trustIcon = 'warning';
        trustText = '부분적으로 신뢰할 수 있음';
      } else {
        trustColor = '#F44336';
        trustIcon = 'dangerous';
        trustText = '신뢰할 수 없음';
      }
      
      // 소스 섹션 생성
      let sourcesHTML = '';
      if (data.sources && data.sources.length > 0) {
        data.sources.forEach(source => {
          sourcesHTML += `
            <div class="source-item">
              <div class="source-title">
                <a href="${source.url}" target="_blank" style="color: #1a73e8; text-decoration: none;">${source.title || '제목 없음'}</a>
              </div>
              <div class="source-snippet">${source.content || '내용 없음'}</div>
              <div class="source-relevance">관련성: ${Math.round(source.relevanceScore * 100)}%</div>
            </div>
          `;
        });
      } else {
        sourcesHTML = '<p style="color: #666; font-style: italic;">참고 자료를 찾을 수 없습니다.</p>';
      }
      
      // 관련 아티클 섹션 생성
      let relatedArticlesHTML = '';
      if (data.relatedArticles && data.relatedArticles.length > 0) {
        data.relatedArticles.forEach(article => {
          relatedArticlesHTML += `
            <div style="margin-bottom: 8px;">
              <a href="${article.url}" target="_blank" style="color: #1a73e8; text-decoration: none;">
                ${article.title || article.url}
              </a>
              <span style="font-size: 11px; color: #666; margin-left: 8px;">${article.source || ''}</span>
            </div>
          `;
        });
      }
      
      // 주요 포인트 섹션 생성
      let mainPointsHTML = '';
      if (data.mainPoints && data.mainPoints.length > 0) {
        data.mainPoints.forEach(point => {
          mainPointsHTML += `<li style="margin-bottom: 8px;">${point}</li>`;
        });
        mainPointsHTML = `<ul style="padding-left: 20px;">${mainPointsHTML}</ul>`;
      }
      
      // 검증된 주장 섹션
      let claimsHTML = '';
      if (data.verifiedClaims && data.verifiedClaims.length > 0) {
        data.verifiedClaims.forEach(claim => {
          claimsHTML += `
            <div class="claim-text">
              ${claim.text}
            </div>
          `;
        });
      }
      
      // HTML 생성
      content.innerHTML = `
        <div style="padding: 0 0 20px">
          <div class="score-badge">
            <span class="material-icons" style="font-size: 32px; color: ${trustColor};">${trustIcon}</span>
            <span class="score-number" style="color: ${trustColor};">${Math.round(score * 100)}%</span>
          </div>
          
          <div class="verdict ${score >= 0.8 ? 'true' : (score >= 0.5 ? 'partly-true' : 'false')}">
            <strong>검증 결과:</strong> ${data.verdict || trustText}
          </div>
          
          <div style="margin-bottom: 15px;">
            <div class="section-title">요약</div>
            <p style="margin: 0; line-height: 1.5; color: #333;">${data.summary || '요약 정보가 없습니다.'}</p>
          </div>
          
          ${data.verifiedClaims && data.verifiedClaims.length > 0 ? `
            <div style="margin-bottom: 15px;">
              <div class="section-title">검증된 주장</div>
              ${claimsHTML}
            </div>
          ` : ''}
          
          ${data.mainPoints && data.mainPoints.length > 0 ? `
            <div style="margin-bottom: 15px;">
              <div class="section-title">주요 분석 포인트</div>
              ${mainPointsHTML}
            </div>
          ` : ''}
          
          <div style="margin-bottom: 15px;">
            <div class="section-title">참고 자료</div>
            ${sourcesHTML}
          </div>
          
          ${relatedArticlesHTML ? `
            <div style="margin-bottom: 15px;">
              <div class="section-title">관련 기사</div>
              ${relatedArticlesHTML}
            </div>
          ` : ''}
          
          <div class="footer">
            분석 시간: ${metadata.verifiedAt ? new Date(metadata.verifiedAt).toLocaleString() : new Date().toLocaleString()}
          </div>
        </div>
      `;
      
      this.show();
    }

    extractNewsContent() {
      console.log('[FactChecker] 뉴스 콘텐츠 추출 시작');
      
      // 현재 URL 정확하게 추출
      const url = window.location.href || document.URL || '';
      console.log('[FactChecker] 현재 URL:', url);
      
      // URL 검증
      let validUrl = url;
      try {
        // URL 형식 검증
        new URL(url);
      } catch (e) {
        console.error('[FactChecker] 잘못된 URL 형식:', url, e);
        validUrl = window.location.origin || '';
      }
      
      // 뉴스 매체 확인 (도메인 기반)
      const domain = validUrl ? new URL(validUrl).hostname : '';
      const isNewsSite = domain && (
        domain.includes('news.naver.com') ||
        domain.includes('news.daum.net') ||
        domain.includes('yna.co.kr') ||
        domain.includes('yonhapnews.co.kr') ||
        domain.includes('chosun.com') ||
        domain.includes('donga.com') ||
        domain.includes('hani.co.kr') ||
        domain.includes('joins.com') ||
        domain.includes('kmib.co.kr') ||
        domain.includes('khan.co.kr') ||
        domain.includes('mt.co.kr') ||
        domain.includes('mk.co.kr')
      );
      console.log('[FactChecker] 뉴스 사이트 여부:', isNewsSite);
      
      // 제목 추출 시도 (사이트별 맞춤 선택자 + 일반 선택자)
      let title = '';
      
      // 1. 메타 태그 확인
      const metaTags = {
        // Open Graph 태그
        ogTitle: document.querySelector('meta[property="og:title"]'),
        // 트위터 카드
        twitterTitle: document.querySelector('meta[name="twitter:title"]'),
        // 일반 메타 태그
        metaTitle: document.querySelector('meta[name="title"]'),
        // 아티클 태그
        articleTitle: document.querySelector('meta[property="article:title"]')
      };
      
      // 2. 사이트별 맞춤 선택자
      const siteTitleSelectors = {
        'news.naver.com': ['.media_end_head_title', '#articleTitle', '.end_tit'],
        'news.daum.net': ['.tit_view', '.tit_news'],
        'yna.co.kr': ['.tit-article', '.headline-title'],
        'chosun.com': ['.article-header h1', '.news_title'],
        'donga.com': ['.article_title'],
        'hani.co.kr': ['.title'],
        'kmib.co.kr': ['.nwsti'],
        'khan.co.kr': ['.headline'],
        'mt.co.kr': ['.news_head_style1 .title'],
        'mk.co.kr': ['.view_tit']
      };
      
      // 3. 일반 선택자
      const generalTitleSelectors = [
        'h1.title', 'h1.headline', 'h1.article-title', 'h1.entry-title',
        'article h1', '.article-title', '.news-title', '.headline',
        '.title-area h1', '.viewTitle', '.view_tit', '.article_head h1'
      ];
      
      // 메타 태그에서 제목 추출 시도
      if (metaTags.ogTitle) {
        title = metaTags.ogTitle.getAttribute('content');
        console.log('[FactChecker] Open Graph 제목 추출:', title);
      } else if (metaTags.twitterTitle) {
        title = metaTags.twitterTitle.getAttribute('content');
        console.log('[FactChecker] Twitter 제목 추출:', title);
      } else if (metaTags.articleTitle) {
        title = metaTags.articleTitle.getAttribute('content');
        console.log('[FactChecker] Article 제목 추출:', title);
      } else if (metaTags.metaTitle) {
        title = metaTags.metaTitle.getAttribute('content');
        console.log('[FactChecker] Meta 제목 추출:', title);
      }
      
      // 제목이 없는 경우 사이트별 맞춤 선택자 시도
      if (!title && domain) {
        for (const [site, selectors] of Object.entries(siteTitleSelectors)) {
          if (domain.includes(site)) {
            for (const selector of selectors) {
              const element = document.querySelector(selector);
              if (element) {
                title = element.textContent.trim();
                console.log(`[FactChecker] 사이트 맞춤 선택자(${selector}) 제목 추출:`, title);
        break;
      }
    }
            if (title) break;
          }
        }
      }
      
      // 제목이 여전히 없는 경우 일반 선택자 시도
      if (!title) {
        for (const selector of generalTitleSelectors) {
      const element = document.querySelector(selector);
          if (element) {
            title = element.textContent.trim();
            console.log(`[FactChecker] 일반 선택자(${selector}) 제목 추출:`, title);
            break;
          }
        }
      }
      
      // 최후의 방법: 문서 title 사용
      if (!title) {
        title = document.title;
        console.log('[FactChecker] 문서 제목 사용:', title);
      }
      
      // 콘텐츠 추출 시도
      let content = '';
      
      // 1. 사이트별 맞춤 선택자
      const siteContentSelectors = {
        'news.naver.com': ['#articleBodyContents', '#articeBody', '.article_body'],
        'news.daum.net': ['.article_view', '#article'],
        'yna.co.kr': ['.article', '.content-body'],
        'chosun.com': ['.article-body', '#news_body_id'],
        'donga.com': ['.article_txt'],
        'hani.co.kr': ['.article-text', '.article-contents'],
        'kmib.co.kr': ['#articleBody'],
        'khan.co.kr': ['.art_body'],
        'mt.co.kr': ['.news_cnt_detail_wrap'],
        'mk.co.kr': ['#article_body', '.view_content']
      };
      
      // 2. 일반 콘텐츠 선택자
      const generalContentSelectors = [
        'article', '.article-body', '.article-content', '.news-content',
        '.article_body', '.article_content', '.story-body', '#articleBody',
        '#article-body', '.entry-content', '.post-content', '.content-article',
        '.news-article-content', 'main .content'
      ];
      
      // 3. 단락 수집 선택자
      const paragraphSelectors = 'p, article p, .article-body p, .news-content p, .article_content p';
      
      // 메타 설명 가져오기
      const metaDescription = document.querySelector('meta[name="description"]');
      const ogDescription = document.querySelector('meta[property="og:description"]');
      
      // 사이트별 맞춤 선택자로 콘텐츠 추출 시도
      if (domain) {
        for (const [site, selectors] of Object.entries(siteContentSelectors)) {
          if (domain.includes(site)) {
            for (const selector of selectors) {
              const element = document.querySelector(selector);
              if (element) {
                content = element.textContent.trim();
                console.log(`[FactChecker] 사이트 맞춤 선택자(${selector})로 콘텐츠 추출: ${content.length}자`);
                break;
              }
            }
            if (content) break;
          }
        }
      }
      
      // 콘텐츠가 없으면 일반 선택자 시도
      if (!content || content.length < 100) {
        for (const selector of generalContentSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            content = element.textContent.trim();
            console.log(`[FactChecker] 일반 선택자(${selector})로 콘텐츠 추출: ${content.length}자`);
          break;
        }
      }
      }
      
      // 콘텐츠가 여전히 부족하면 단락 수집
      if (!content || content.length < 100) {
        const paragraphs = Array.from(document.querySelectorAll(paragraphSelectors));
        const filteredParagraphs = paragraphs
          .filter(p => p.textContent.trim().length > 20)
          .map(p => p.textContent.trim());
        
        if (filteredParagraphs.length > 0) {
          content = filteredParagraphs.join('\n\n');
          console.log(`[FactChecker] 단락에서 콘텐츠 추출: ${content.length}자, ${filteredParagraphs.length}개 단락`);
        }
      }
      
      // 콘텐츠가 여전히 부족하면 메타 설명 사용
      if (!content || content.length < 100) {
        if (ogDescription) {
          content = ogDescription.getAttribute('content');
          console.log('[FactChecker] OG 설명에서 콘텐츠 추출:', content);
        } else if (metaDescription) {
          content = metaDescription.getAttribute('content');
          console.log('[FactChecker] 메타 설명에서 콘텐츠 추출:', content);
        }
      }
      
      // 마지막 방법: 본문 전체 텍스트
      if (!content || content.length < 100) {
        content = document.body.innerText;
        console.log(`[FactChecker] 본문 전체 텍스트 추출: ${content.length}자`);
      }
      
      // 콘텐츠 정리: 연속 공백 및 줄바꿈 처리
      if (content) {
        content = content
          .replace(/\s+/g, ' ')
          .replace(/\n+/g, '\n')
          .trim();
      }
      
      // 콘텐츠가 충분한지 확인
      if (!content || content.length < 50) {
        console.warn('[FactChecker] 충분한 콘텐츠를 추출하지 못함');
        return null;
      }
      
      // 출력 요약
      console.log('[FactChecker] 콘텐츠 추출 완료');
      console.log('[FactChecker] URL:', validUrl);
      console.log('[FactChecker] 제목:', title);
      console.log('[FactChecker] 본문 길이:', content.length);
      
      return {
        url: validUrl,
        title: title,
        content: content
      };
    }

    verifyCurrentPage(options = {}) {
      console.log('[FactChecker] 현재 페이지 검증 시작...', {
        url: window.location.href,
        documentReady: document.readyState,
        timestamp: new Date().toISOString(),
        options
      });
      this.showLoading();
      
      // 콘텐츠 추출
      console.log('[FactChecker] 콘텐츠 추출 시작');
      const extractedContent = this.extractNewsContent();
      console.log('[FactChecker] 콘텐츠 추출 결과:', extractedContent ? '성공' : '실패', {
        hasUrl: extractedContent?.url ? true : false,
        hasTitle: extractedContent?.title ? true : false,
        contentLength: extractedContent?.content ? extractedContent.content.length : 0
      });
      
      if (!extractedContent) {
        console.error('[FactChecker] 콘텐츠 추출 실패');
        this.showError('뉴스 콘텐츠를 추출할 수 없습니다.');
        return;
      }
      
      // URL 재확인
      if (!extractedContent.url) {
        console.error('[FactChecker] URL이 없습니다. 현재 문서 URL을 사용합니다.');
        extractedContent.url = document.URL || window.location.href || '';
      }
      
      // 콘텐츠 길이 확인
      if (!extractedContent.content || extractedContent.content.length < 10) {
        console.error('[FactChecker] 콘텐츠가 너무 짧습니다:', extractedContent.content);
        this.showError('분석할 뉴스 콘텐츠가 충분하지 않습니다.');
        return;
      }
      
      console.log('[FactChecker] 검증 요청 데이터:', {
        url: extractedContent.url.substring(0, 50) + '...',
        title: extractedContent.title ? extractedContent.title.substring(0, 30) + '...' : '(없음)',
        contentLength: extractedContent.content ? extractedContent.content.length : 0,
        forceRefresh: !!options.forceRefresh
      });
      
      // 서버 상태 확인 요청 전송
      console.log('[FactChecker] 서버 상태 확인 요청 전송');
      
      // 먼저 서버 상태 확인
      chrome.runtime.sendMessage({
        action: 'checkServerStatus'
      }, statusResponse => {
        console.log('[FactChecker] 서버 상태 응답 수신:', statusResponse);
        
        if (chrome.runtime.lastError) {
          console.error('[FactChecker] 서버 상태 확인 오류:', chrome.runtime.lastError.message);
          this.showError('백그라운드 서비스와 통신할 수 없습니다. 확장 프로그램을 다시 로드해주세요.');
          return;
        }
        
        if (!statusResponse || !statusResponse.serverStatus || !statusResponse.serverStatus.isConnected) {
          console.error('[FactChecker] 서버가 연결되지 않음:', statusResponse);
          this.showError('서버에 연결할 수 없습니다. 서버 상태를 확인하세요.');
          return;
        }
        
        console.log('[FactChecker] 서버 연결 확인됨, 검증 요청 전송:', new Date().toISOString());
        
        // 확장 프로그램 백그라운드 스크립트에 메시지 전송
        chrome.runtime.sendMessage({
          action: 'verifyContent',
          url: extractedContent.url,
          title: extractedContent.title,
          content: extractedContent.content,
          forceRefresh: !!options.forceRefresh,
          timestamp: new Date().toISOString()
        }, response => {
          console.log('[FactChecker] 검증 응답 수신 시간:', new Date().toISOString());
          
          if (chrome.runtime.lastError) {
            console.error('[FactChecker] 메시지 전송 오류:', chrome.runtime.lastError.message);
            this.showError('서버 연결에 실패했습니다. 확장 프로그램이 활성화되어 있는지 확인해주세요.');
            return;
          }
          
          console.log('[FactChecker] 검증 응답 데이터:', response);
          
          if (response && response.success) {
            if (response.data) {
              this.showResult(response.data);
            } else if (response.result) {
              this.showResult(response.result);
            } else {
              console.error('[FactChecker] 응답에 데이터가 없습니다:', response);
              this.showError('서버에서 유효한 응답을 받지 못했습니다.');
            }
          } else {
            const errorMsg = response?.error || '콘텐츠 검증 중 오류가 발생했습니다.';
            console.error('[FactChecker] 검증 오류:', errorMsg);
            this.showError(errorMsg);
          }
        });
      });
    }

    setupMessageListener() {
      console.log('[FactChecker] 메시지 리스너 설정 시작', {
        timestamp: new Date().toISOString(),
        context: 'content.js'
      });
      
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('[FactChecker] 메시지 수신:', message, {
          sender: sender?.id || '불명',
          hasCallback: !!sendResponse,
          timestamp: new Date().toISOString(),
          messageAction: message?.action
        });
        
        if (message.action === 'verifyNewsContent') {
          console.log('[FactChecker] 뉴스 콘텐츠 검증 요청 수신', {
            timestamp: new Date().toISOString(),
            documentState: document.readyState,
            forceRefresh: !!message.forceRefresh
          });
          
          this.verifyCurrentPage({
            forceRefresh: !!message.forceRefresh
          });
          
          sendResponse({ success: true, message: '검증 시작됨' });
          return true;
        }
        
        if (message.action === 'hideOverlay') {
          console.log('[FactChecker] 오버레이 숨김 요청 수신');
          this.hide();
          sendResponse({ success: true });
          return true;
        }
        
        if (message.action === 'getStats') {
          console.log('[FactChecker] 통계 요청 수신');
          // 통계 정보 (임시 구현)
          const stats = {
            success: true,
            detected: 1,
            verified: this.container && this.container.style.display === 'block' ? 1 : 0
          };
          console.log('[FactChecker] 통계 응답:', stats);
          sendResponse(stats);
          return true;
        }
        
        console.log('[FactChecker] 알 수 없는 메시지 액션:', message.action);
        return false;
      });
      
      console.log('[FactChecker] 메시지 리스너 설정 완료', {
        timestamp: new Date().toISOString()
      });
    }
  }

  // FactCheckOverlay 인스턴스 생성
  const overlay = new FactCheckOverlay();

  console.log('[FactChecker] 콘텐츠 스크립트 초기화 완료');
})(); 