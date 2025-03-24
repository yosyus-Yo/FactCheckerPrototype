/**
 * 콘텐츠 추출 유틸리티
 * URL에서 뉴스 기사나 웹 페이지의 콘텐츠를 추출하는 기능을 제공합니다.
 */
const axios = require('axios');
const cheerio = require('cheerio');
const logger = require('./logger');
const { extract } = require('@extractus/article-extractor');
const { BrowserCrawler } = require('@crawlee/browser');

/**
 * URL에서 콘텐츠 추출 함수 (MCP 브라우저 활용)
 * @param {string} url - 콘텐츠를 추출할 URL
 * @returns {Promise<object>} - 추출된 title과 content
 */
async function extractFromUrl(url) {
  try {
    logger.info(`[콘텐츠 추출] URL에서 콘텐츠 추출 시작: ${url}`, { service: 'factchecker' });
    console.log(`[콘텐츠 추출] URL 요청 시작: ${url}`);
    
    const startTime = Date.now();
    
    // MCP 브라우저 기반 추출 시도
    const result = await extractWithMcpBrowser(url);
    
    if (result.title && result.content && result.content.length >= 100) {
      const processingTime = Date.now() - startTime;
      logger.info(`[콘텐츠 추출] MCP 브라우저 추출 성공 - 제목: ${result.title.substring(0, 40)}... (${result.title.length}자)`, { service: 'factchecker' });
      logger.info(`[콘텐츠 추출] 추출된 본문 길이: ${result.content.length}자, 처리 시간: ${processingTime}ms`, { service: 'factchecker' });
      
      return result;
    }
    
    // MCP 브라우저로 추출 실패 시 article-extractor 시도
    console.log(`[콘텐츠 추출] MCP 브라우저 추출 실패, article-extractor 시도`);
    // article-extractor 라이브러리를 사용하여 콘텐츠 추출
    const article = await extract(url, {
      contentLengthThreshold: 100 // 최소 100자 이상의 콘텐츠 필요
    }, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    });

    const processingTime = Date.now() - startTime;
    
    if (!article || !article.content || article.content.length < 100) {
      console.log(`[콘텐츠 추출] article-extractor로 충분한 콘텐츠를 추출하지 못함. 기존 방식으로 시도`);
      return await extractFromUrlLegacy(url);
    }
    
    // 추출 결과 로깅
    console.log(`[콘텐츠 추출] 성공: ${processingTime}ms 소요`);
    console.log(`[콘텐츠 추출] 제목: ${article.title ? article.title.substring(0, 40) + '...' : '(없음)'}`);
    console.log(`[콘텐츠 추출] 본문 길이: ${article.content ? article.content.length : 0}자`);
    
    if (article.content && article.content.length > 0) {
      console.log(`[콘텐츠 추출] 본문 샘플: "${article.content.substring(0, 100)}..."`);
    }
    
    logger.info(`[콘텐츠 추출] URL에서 콘텐츠 추출 완료 - 제목: ${article.title?.substring(0, 40)}... (${article.title?.length}자)`, { service: 'factchecker' });
    logger.info(`[콘텐츠 추출] 추출된 본문 길이: ${article.content?.length}자, 처리 시간: ${processingTime}ms`, { service: 'factchecker' });
    
    return {
      title: article.title || '',
      content: article.content || ''
    };
  } catch (error) {
    logger.error(`[콘텐츠 추출] 콘텐츠 추출 실패: ${error.message}`, { service: 'factchecker' });
    console.error(`[콘텐츠 추출] 오류:`, error);
    
    // 기존 추출 방식으로 폴백
    return await extractFromUrlLegacy(url);
  }
}

/**
 * MCP 브라우저를 사용하여 콘텐츠 추출
 * @param {string} url - 콘텐츠를 추출할 URL
 * @returns {Promise<object>} - 추출된 title과 content
 */
async function extractWithMcpBrowser(url) {
  try {
    console.log(`[콘텐츠 추출] MCP 브라우저로 추출 시도: ${url}`);
    
    let extractedTitle = '';
    let extractedContent = '';
    
    // puppeteer를 직접 사용하여 콘텐츠 추출
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    try {
      const page = await browser.newPage();
      
      // 사용자 에이전트 설정
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
      
      // 타임아웃 설정
      await page.setDefaultNavigationTimeout(60000);
      
      // 페이지 로드
      await page.goto(url, { waitUntil: 'networkidle2' });
      
      // 제목 추출 시도
      extractedTitle = await page.evaluate(() => {
        // 우선순위에 따른 제목 선택자
        const titleSelectors = [
          'meta[property="og:title"]',
          'meta[name="title"]',
          'meta[name="twitter:title"]',
          '.article_head .article_title',
          'h1.article_title',
          'h1.headline',
          'h1.title',
          '.article-title',
          '.headline',
          'h1',
          '.article-head h1',
          '.news-header h1',
          '.article-headline',
          'title'
        ];
        
        for (const selector of titleSelectors) {
          if (selector.startsWith('meta')) {
            const meta = document.querySelector(selector);
            if (meta && meta.getAttribute('content')) {
              return meta.getAttribute('content');
            }
          } else if (selector === 'title') {
            if (document.title) {
              return document.title;
            }
          } else {
            const element = document.querySelector(selector);
            if (element && element.textContent) {
              return element.textContent.trim();
            }
          }
        }
        
        return document.title || '';
      });
      
      // 본문 추출 시도
      extractedContent = await page.evaluate(() => {
        // 우선순위에 따른 본문 선택자
        const contentSelectors = [
          'article',
          '.article-body',
          '.article-content', 
          '.article_body',
          '.news-content',
          '.news_content',
          '.articleBody',
          '[itemprop="articleBody"]',
          '#articleBody',
          '#article-body',
          '#article_body',
          '#content',
          '#contents',
          '.content',
          '.contents',
          '.entry-content',
          '.post-content',
          '.story-content',
          '.news-cont-article',
          '.article-body-content'
        ];
        
        // 광고, 비필수 요소 제거를 위한 선택자
        const removeSelectors = [
          'script',
          'style',
          'iframe',
          'nav',
          'header',
          'footer',
          '.ads',
          '.advertisement',
          '.banner',
          '.menu',
          'figcaption',
          '.caption',
          '.copyright',
          '.credit'
        ];
        
        // 불필요한 요소 제거 (임시 복제본에서)
        const tempBody = document.body.cloneNode(true);
        
        removeSelectors.forEach(selector => {
          const elements = tempBody.querySelectorAll(selector);
          elements.forEach(el => el.remove());
        });
        
        // 선택자별로 본문 추출 시도
        let bestText = '';
        let bestLength = 0;
        
        for (const selector of contentSelectors) {
          const elements = tempBody.querySelectorAll(selector);
          
          elements.forEach(element => {
            const text = element.textContent.trim().replace(/\s+/g, ' ');
            if (text.length > bestLength) {
              bestText = text;
              bestLength = text.length;
            }
          });
          
          if (bestLength > 100) break;
        }
        
        // 본문을 찾지 못한 경우 모든 p 태그에서 추출
        if (bestLength < 100) {
          const paragraphs = tempBody.querySelectorAll('p');
          let pText = '';
          
          paragraphs.forEach(p => {
            const text = p.textContent.trim();
            if (text.length > 20) {
              pText += text + '\n\n';
            }
          });
          
          if (pText.length > bestLength) {
            bestText = pText;
            bestLength = pText.length;
          }
        }
        
        // p 태그에서도 추출 실패한 경우 body 전체 내용 사용
        if (bestLength < 100) {
          bestText = tempBody.textContent.trim()
            .replace(/\s+/g, ' ')
            .replace(/\n+/g, '\n');
        }
        
        return bestText;
      });
      
      console.log(`[MCP 브라우저] 추출 완료 - 제목: ${extractedTitle.length}자, 본문: ${extractedContent.length}자`);
    } finally {
      // 브라우저 종료
      await browser.close();
    }
    
    return {
      title: extractedTitle || '',
      content: extractedContent || ''
    };
  } catch (error) {
    console.error(`[MCP 브라우저] 추출 오류:`, error);
    return { title: '', content: '' };
  }
}

/**
 * 기존 URL 추출 함수 (폴백 용도로 보존)
 * @param {string} url - 콘텐츠를 추출할 URL
 * @returns {Promise<object>} - 추출된 title과 content
 */
async function extractFromUrlLegacy(url) {
  try {
    console.log(`[콘텐츠 추출] 레거시 방식으로 추출 시도: ${url}`);
    
    const startTime = Date.now();
    
    // Axios로 웹페이지 가져오기
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 10000
    }).catch(error => {
      console.error(`[콘텐츠 추출] URL 요청 실패: ${error.message}`);
      if (error.response) {
        console.error(`[콘텐츠 추출] 응답 상태: ${error.response.status} - ${error.response.statusText}`);
      }
      throw error;
    });
    
    const requestTime = Date.now() - startTime;
    console.log(`[콘텐츠 추출] URL 요청 완료: 응답 코드 ${response.status}, ${requestTime}ms 소요`);
    
    const html = response.data;
    
    // Cheerio로 HTML 파싱
    const $ = cheerio.load(html);
    
    // 제목 추출 (가능한 여러 선택자 시도)
    const titleSelectors = [
      'meta[property="og:title"]',
      'meta[name="title"]',
      'meta[name="twitter:title"]',
      '.article_head .article_title',
      'h1.article_title',
      'h1.headline',
      'h1.title',
      '.article-title',
      '.headline',
      'h1',
      '.article-head h1',
      '.news-header h1',
      '.article-headline',
      'title'
    ];
    
    let title = '';
    
    // 제목 추출 시도
    for (const selector of titleSelectors) {
      let titleElement;
      if (selector.startsWith('meta')) {
        titleElement = $(selector).attr('content');
      } else if (selector === 'title') {
        titleElement = $(selector).text();
      } else {
        const elements = $(selector);
        if (elements.length > 0) {
          titleElement = elements.first().text().trim();
        }
      }
      
      if (titleElement && titleElement.length > 0) {
        title = titleElement;
        break;
      }
    }
    
    // 콘텐츠 선택자 목록 (우선순위 순)
    const contentSelectors = [
      'article',
      '.article-body',
      '.article-content', 
      '.article_body',
      '.news-content',
      '.news_content',
      '.articleBody',
      '[itemprop="articleBody"]',
      '#articleBody',
      '#article-body',
      '#article_body',
      '#content',
      '#contents',
      '.content',
      '.contents',
      '.entry-content',
      '.post-content',
      '.story-content',
      '.news-cont-article',
      '.article-body-content'
    ];
    
    let content = '';
    let bestLength = 0;
    
    // 모든 선택자를 시도해서 가장 긴 콘텐츠를 추출
    for (const selector of contentSelectors) {
      try {
        const elements = $(selector);
        
        if (elements.length === 0) continue;
        
        // 불필요한 내용 제거
        elements.find('figcaption, figure > div, .caption, .copyright, .credit').remove();
        
        // 텍스트 추출 및 길이 확인
        const text = elements.text().trim();
        
        if (text.length > bestLength) {
          content = text;
          bestLength = text.length;
        }
      } catch (err) {
        console.error(`[콘텐츠 추출] 선택자 처리 중 오류:`, err);
      }
    }

    // 본문이 충분하지 않으면 모든 p 태그에서 텍스트 추출
    if (content.length < 100) {
      const paragraphs = $('p');
      
      let pContent = '';
      
      paragraphs.each((i, p) => {
        const text = $(p).text().trim();
        if (text.length > 20) { // 짧은 문단 제외
          pContent += text + '\n\n';
        }
      });
      
      if (pContent.length > content.length) {
        content = pContent;
      }
    }
    
    // p 태그에서도 충분한 내용이 추출되지 않으면 body 전체 내용 추출
    if (content.length < 100) {
      // 불필요한 태그 제거
      $('script, style, nav, header, footer, iframe, .ads, .advertisement, .banner, .menu').remove();
      
      // body 전체 텍스트 추출
      const bodyContent = $('body').text().trim()
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n');
      
      if (bodyContent.length > 0) {
        content = bodyContent;
      }
    }

    if (content.length === 0) {
      throw new Error('본문을 추출할 수 없습니다');
    }

    if (!title) {
      title = url.split('/').pop() || '제목 없음';
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[콘텐츠 추출] 레거시 방식 처리 완료 - 추출 시간: ${totalTime}ms, 제목: ${title.length}자, 본문: ${content.length}자`);
    
    return {
      title: title,
      content: content
    };
  } catch (error) {
    console.error(`[콘텐츠 추출] 레거시 방식 오류:`, error);
    throw new Error(`레거시 콘텐츠 추출 실패: ${error.message}`);
  }
}

module.exports = {
  extractFromUrl
}; 