const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 改進的網站內容抓取函數
async function fetchWebsiteContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      maxRedirects: 5
    });
    
    const $ = cheerio.load(response.data);
    
    // 移除script和style標籤
    $('script, style, noscript, iframe').remove();
    
    // 獲取多種標題來源
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') ||
                  $('meta[name="twitter:title"]').attr('content') ||
                  $('meta[property="og:site_name"]').attr('content') ||
                  url.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
    
    // 獲取多種描述來源
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') ||
                       $('meta[name="twitter:description"]').attr('content') ||
                       $('.description').text().trim() ||
                       $('p').first().text().trim() ||
                       '';
    
    // 獲取關鍵字
    const keywords = $('meta[name="keywords"]').attr('content') || '';
    
    // 獲取作者/公司資訊
    const author = $('meta[name="author"]').attr('content') ||
                   $('meta[property="og:site_name"]').attr('content') ||
                   '';
    
    // 獲取頁面類型
    const pageType = $('meta[property="og:type"]').attr('content') || '';
    
    // 獲取更豐富的內容
    let contentText = '';
    
    // 優先從特定區域獲取內容
    if ($('main').length > 0) {
      contentText = $('main').text();
    } else if ($('article').length > 0) {
      contentText = $('article').text();
    } else if ($('.content, .post-content, .entry-content').length > 0) {
      contentText = $('.content, .post-content, .entry-content').text();
    } else {
      contentText = $('body').text();
    }
    
    // 獲取所有標題（h1-h6）
    const headings = [];
    $('h1, h2, h3, h4, h5, h6').each(function() {
      const headingText = $(this).text().trim();
      if (headingText && headingText.length > 0) {
        headings.push(headingText);
      }
    });
    
    // 獲取導航連結
    const navLinks = [];
    $('nav a, .nav a, .menu a').each(function() {
      const linkText = $(this).text().trim();
      if (linkText && linkText.length > 0) {
        navLinks.push(linkText);
      }
    });
    
    const rawContent = contentText.replace(/\s+/g, ' ').trim().substring(0, 1500);
    
    return {
      title: title.substring(0, 150),
      description: description.substring(0, 500),
      keywords: keywords.substring(0, 200),
      author: author.substring(0, 100),
      pageType: pageType,
      rawContent: rawContent,
      headings: headings.slice(0, 10),
      navLinks: navLinks.slice(0, 10),
      url: url
    };
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    
    // 嘗試使用網路搜尋作為備用方案
    try {
      const searchData = await searchWebInfo(url);
      return searchData;
    } catch (searchError) {
      console.error(`Search fallback failed for ${url}:`, searchError.message);
      
      const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
      return {
        title: siteName,
        description: '',
        keywords: '',
        author: '',
        pageType: '',
        rawContent: '',
        headings: [],
        navLinks: [],
        url: url
      };
    }
  }
}

// 網路搜尋備用功能
async function searchWebInfo(url) {
  try {
    const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
    const searchQuery = `site:${siteName} 介紹 功能 用途`;
    
    // 使用 Gemini 模擬搜尋結果分析
    const searchPrompt = `
請根據以下網站 URL 提供該網站的基本資訊：${url}

請提供：
1. 網站名稱
2. 網站主要功能描述
3. 網站類型
4. 主要用途

回傳 JSON 格式：
{
  "title": "網站名稱",
  "description": "功能描述",
  "pageType": "網站類型",
  "rawContent": "用途說明"
}
`;
    
    const result = await model.generateContent(searchPrompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const searchData = JSON.parse(jsonString);
    
    return {
      title: searchData.title || siteName,
      description: searchData.description || '',
      keywords: '',
      author: '',
      pageType: searchData.pageType || '',
      rawContent: searchData.rawContent || '',
      headings: [],
      navLinks: [],
      url: url
    };
  } catch (error) {
    console.error(`Search info failed for ${url}:`, error.message);
    throw error;
  }
}

// 使用 LLM 深度分析網站功能
async function analyzeWebsiteFunction(url, websiteData) {
  const prompt = `
你是一個專業的網站分析師。請根據以下詳細的網站資訊，提供繁體中文的深度分析。

# 網站資訊
- **URL**: ${url}
- **標題**: ${websiteData.title || '未知'}
- **描述**: ${websiteData.description || '無描述'}
- **關鍵字**: ${websiteData.keywords || '無關鍵字'}
- **作者/公司**: ${websiteData.author || '未知'}
- **頁面類型**: ${websiteData.pageType || '未知'}
- **頁面標題**: ${websiteData.headings.length > 0 ? websiteData.headings.join(', ') : '無標題'}
- **導航連結**: ${websiteData.navLinks.length > 0 ? websiteData.navLinks.join(', ') : '無導航'}
- **內容摘要**: ${websiteData.rawContent || '無內容'}

# 分析要求
請提供以下資訊：
1. **工具名稱**: 網站的正確中文名稱或服務名稱
2. **詳細功能介紹**: 60-100字的詳細描述，包含：
   - 具體功能和用途
   - 主要特色和優勢
   - 適用場景和目標用戶
   - 技術特點或創新點

# 分析指導原則
- 基於實際網站內容進行分析，不要編造資訊
- 如果是AI工具，請說明具體的AI功能類型
- 如果是開發工具，請說明開發語言或平台
- 如果是商業工具，請說明業務場景
- 避免使用"專業工具"、"線上平台"等模糊詞語
- 重點描述核心功能，而非一般性描述

# 回傳格式
請嚴格按照JSON格式回傳：
{
  "title": "具體的工具或服務名稱",
  "info": "60-100字的詳細功能描述，包含具體用途、特色和適用場景"
}

請確保描述內容具體、實用且基於實際網站資訊。
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const analysis = JSON.parse(jsonString);
    
    // 驗證和改進回應品質
    let info = analysis.info || analysis.function || '';
    let title = analysis.title || websiteData.title || '';
    
    // 如果描述太短或太籠統，嘗試重新生成
    if (info.length < 60 || info.includes('專業工具') || info.includes('線上平台')) {
      const enhancedPrompt = `
根據網站 ${url} 的資訊：
標題：${websiteData.title}
描述：${websiteData.description}
內容：${websiteData.rawContent}

請提供一個60-100字的具體功能描述，必須包含：
1. 工具的確切功能
2. 解決什麼問題
3. 主要使用場景
4. 核心特色

不要使用"專業工具"、"線上平台"等模糊詞語。
只回傳功能描述文字，不要JSON格式：
`;
      
      try {
        const enhancedResult = await model.generateContent(enhancedPrompt);
        const enhancedResponse = await enhancedResult.response;
        const enhancedInfo = enhancedResponse.text().trim();
        
        if (enhancedInfo.length >= 60) {
          info = enhancedInfo;
        }
      } catch (enhancedError) {
        console.error('Enhanced analysis failed:', enhancedError);
      }
    }
    
    // 確保長度在合理範圍內
    if (info.length < 60) {
      // 根據URL和網站內容生成更具體的描述
      const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
      const domainKeywords = siteName.toLowerCase();
      
      if (domainKeywords.includes('ai') || domainKeywords.includes('gpt') || domainKeywords.includes('chat')) {
        info = `${title} 是一個AI驅動的智能助手平台，提供自然語言處理、對話問答、內容生成等功能。支援多種語言模型，能夠協助用戶進行創作、研究、程式開發等任務，適合個人與企業使用。`;
      } else if (domainKeywords.includes('design') || domainKeywords.includes('figma') || domainKeywords.includes('canva')) {
        info = `${title} 是一個專業的設計工具平台，提供圖形設計、原型製作、協作編輯等功能。支援多種設計格式，內建豐富的模板和素材庫，適合設計師、產品經理和創意工作者使用。`;
      } else if (domainKeywords.includes('code') || domainKeywords.includes('dev') || domainKeywords.includes('github')) {
        info = `${title} 是一個程式開發相關的工具平台，提供程式碼編輯、版本控制、專案管理等功能。支援多種程式語言，具備智能代碼提示和除錯功能，適合開發者和技術團隊使用。`;
      } else if (domainKeywords.includes('video') || domainKeywords.includes('audio') || domainKeywords.includes('media')) {
        info = `${title} 是一個多媒體處理工具，提供影片編輯、音訊處理、格式轉換等功能。支援多種媒體格式，具備智能編輯和特效功能，適合內容創作者和媒體工作者使用。`;
      } else {
        info = `${title} 提供專業的線上服務，具備多項實用功能，包含資料處理、工作流程自動化、使用者介面友善等特色。適用於提升工作效率和生產力的各種應用場景。`;
      }
    }
    
    // 限制長度在100字以內
    if (info.length > 100) {
      info = info.substring(0, 97) + '...';
    }
    
    return {
      title: title,
      info: info
    };
  } catch (error) {
    console.error(`深度分析網站功能失敗：${url}`, error);
    
    // 根據網站資訊生成備用描述
    const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
    const title = websiteData.title || siteName;
    
    let fallbackInfo = '';
    const domainKeywords = siteName.toLowerCase();
    const contentKeywords = (websiteData.description + ' ' + websiteData.rawContent).toLowerCase();
    
    if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
      fallbackInfo = `${title} 是一個AI技術驅動的智能工具，提供機器學習、數據分析、自動化處理等功能，能夠幫助用戶解決複雜的數據處理和決策問題，提升工作效率和準確性。`;
    } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || contentKeywords.includes('visual')) {
      fallbackInfo = `${title} 是一個創意設計工具，提供視覺設計、創意製作、多媒體編輯等功能，支援設計師和創作者進行專業級的作品製作，具備豐富的設計資源和直觀的操作介面。`;
    } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard')) {
      fallbackInfo = `${title} 是一個數據分析平台，提供數據視覺化、報表生成、統計分析等功能，幫助企業和個人從數據中獲得洞察，支援決策制定和業務優化。`;
    } else {
      fallbackInfo = `${title} 提供專業的線上服務，具備完整的功能套件和使用者友善的介面設計，能夠滿足用戶的多樣化需求，適用於提升工作效率和解決實際問題的各種場景。`;
    }
    
    return {
      title: title,
      info: fallbackInfo
    };
  }
}

// 批次分析多個網站功能 (8個一組)
async function analyzeBatchWebsiteFunctions(websiteDataList) {
  if (!websiteDataList || websiteDataList.length === 0) {
    return [];
  }

  const prompt = `
你是一個專業的網站分析師。請分析以下網站列表，為每個網站提供繁體中文的詳細描述。

# 網站列表分析
${websiteDataList.map((data, index) => `
## 網站 ${index + 1}
- **URL**: ${data.url}
- **標題**: ${data.title || '未知'}
- **描述**: ${data.description || '無描述'}
- **關鍵字**: ${data.keywords || '無關鍵字'}
- **作者/公司**: ${data.author || '未知'}
- **頁面類型**: ${data.pageType || '未知'}
- **主要標題**: ${data.headings.length > 0 ? data.headings.slice(0, 5).join(', ') : '無標題'}
- **導航功能**: ${data.navLinks.length > 0 ? data.navLinks.slice(0, 5).join(', ') : '無導航'}
- **內容摘要**: ${data.rawContent || '無內容'}
`).join('\n')}

# 分析要求
請為每個網站提供：
1. **工具名稱**: 網站的正確中文名稱或服務名稱
2. **詳細功能介紹**: 60-100字的詳細描述，包含：
   - 具體功能和用途
   - 主要特色和優勢
   - 適用場景和目標用戶
   - 技術特點或創新點

# 分析指導原則
- 基於實際網站內容進行分析，不要編造資訊
- 如果是AI工具，請說明具體的AI功能類型（如：自然語言處理、圖像生成、代碼生成等）
- 如果是開發工具，請說明支援的程式語言或開發平台
- 如果是設計工具，請說明設計類型和應用場景
- 如果是商業工具，請說明解決的業務問題
- 避免使用"專業工具"、"線上平台"等模糊詞語
- 重點描述核心功能和實際價值

# 回傳格式
請嚴格按照JSON陣列格式回傳，按照輸入順序：
[
  {"title": "網站1的具體工具名稱", "info": "60-100字的詳細功能描述"},
  {"title": "網站2的具體工具名稱", "info": "60-100字的詳細功能描述"},
  ...
]

請確保每個描述都具體、實用且基於實際網站資訊。
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    let analysisResults = JSON.parse(jsonString);
    
    if (!Array.isArray(analysisResults)) {
      analysisResults = [analysisResults];
    }
    
    // 確保返回的數量與輸入相同，並處理每個結果
    const processedResults = websiteDataList.map((data, index) => {
      let analysis = analysisResults[index] || {
        title: data.title,
        info: ''
      };
      
      // 確保 info 欄位長度適中且內容豐富
      let info = analysis.info || '';
      let title = analysis.title || data.title || '';
      
      // 如果回應太簡短或太籠統，使用智能預設描述
      if (info.length < 60 || info.includes('專業工具') || info.includes('線上平台')) {
        const siteName = data.url.replace(/^https?:\/\//, '').split('/')[0];
        const domainKeywords = siteName.toLowerCase();
        const contentKeywords = (data.description + ' ' + data.rawContent).toLowerCase();
        
        if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning') || contentKeywords.includes('gpt') || contentKeywords.includes('chat')) {
          info = `${title} 是一個AI驅動的智能工具，提供自然語言處理、機器學習分析、智能問答等功能。支援多種AI模型，能夠協助用戶進行內容創作、數據分析、自動化任務處理，適合研究者、開發者和商業用戶使用。`;
        } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || domainKeywords.includes('design')) {
          info = `${title} 是一個專業的設計創作平台，提供圖形設計、視覺創作、原型製作等功能。內建豐富的設計模板和素材庫，支援多人協作編輯，適合設計師和創意工作者使用。`;
        } else if (contentKeywords.includes('code') || contentKeywords.includes('development') || contentKeywords.includes('programming') || contentKeywords.includes('github') || contentKeywords.includes('dev')) {
          info = `${title} 是一個程式開發和技術工具平台，提供代碼編輯、專案管理、版本控制等功能。支援多種程式語言和開發框架，具備智能提示和自動化功能，適合開發者和技術團隊使用。`;
        } else if (contentKeywords.includes('video') || contentKeywords.includes('audio') || contentKeywords.includes('media') || contentKeywords.includes('editor')) {
          info = `${title} 是一個多媒體編輯工具，提供影片剪輯、音訊處理、特效製作等功能。支援多種媒體格式，具備專業級的編輯功能和豐富的特效庫，適合內容創作者、影片製作者和媒體工作者使用。`;
        } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard') || contentKeywords.includes('chart')) {
          info = `${title} 是一個數據分析和視覺化平台，提供數據處理、統計分析、圖表製作等功能。支援多種數據來源和視覺化類型，具備即時更新和協作分享功能，適合數據分析師、業務人員和決策者使用。`;
        } else if (contentKeywords.includes('productivity') || contentKeywords.includes('task') || contentKeywords.includes('management') || contentKeywords.includes('workflow')) {
          info = `${title} 是一個生產力和專案管理工具，提供任務管理、工作流程自動化、團隊協作等功能。支援多種整合應用，具備智能提醒和進度追蹤功能，適合專案經理、團隊領導和企業用戶使用。`;
        } else {
          info = `${title} 提供專業的線上服務解決方案，具備完整的功能模組和直觀的操作介面。支援多種應用場景和客製化需求，能夠有效提升使用者的工作效率和產品體驗，適合各行業的專業人士使用。`;
        }
      }
      
      // 確保長度在合理範圍內
      if (info.length < 60) {
        info = `${info}。此工具具備先進的技術架構和使用者友善的介面設計，能夠滿足專業用戶的高標準需求。`;
      }
      
      // 限制長度在100字以內
      if (info.length > 100) {
        info = info.substring(0, 97) + '...';
      }
      
      return {
        title: title,
        info: info
      };
    });
    
    return processedResults;
  } catch (error) {
    console.error('批次分析網站功能失敗：', error);
    
    // 備用方案：為每個網站生成智能預設描述
    return websiteDataList.map(data => {
      const siteName = data.url.replace(/^https?:\/\//, '').split('/')[0];
      const title = data.title || siteName;
      const domainKeywords = siteName.toLowerCase();
      const contentKeywords = (data.description + ' ' + data.rawContent).toLowerCase();
      
      let defaultInfo = '';
      
      if (contentKeywords.includes('ai') || contentKeywords.includes('gpt') || contentKeywords.includes('chat') || domainKeywords.includes('ai')) {
        defaultInfo = `${title} 是一個AI技術驅動的智能助手平台，提供自然語言處理、對話問答、內容生成等功能。支援多種AI模型和應用場景，能夠協助用戶進行創作、研究和問題解決，提升工作效率和創新能力。`;
      } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || domainKeywords.includes('design')) {
        defaultInfo = `${title} 是一個創意設計和視覺製作平台，提供圖形設計、原型製作、多媒體編輯等功能。內建豐富的設計資源和模板庫，支援團隊協作和版本管理，適合設計師和創意工作者使用。`;
      } else if (contentKeywords.includes('code') || contentKeywords.includes('dev') || domainKeywords.includes('code')) {
        defaultInfo = `${title} 是一個程式開發和技術工具平台，提供代碼編輯、專案管理、版本控制等功能。支援多種程式語言和開發框架，具備智能提示和自動化功能，適合開發者和技術團隊使用。`;
      } else {
        defaultInfo = `${title} 提供專業的數位服務解決方案，具備完整的功能套件和現代化的使用者介面。支援多種應用場景和客製化需求，能夠有效提升工作效率和使用者體驗，適合各領域的專業人士使用。`;
      }
      
      return {
        title: title,
        info: defaultInfo
      };
    });
  }
}

// 批量抓取並分析網站內容 (改為8個一組批次處理)
async function fetchMultipleWebsiteContents(urls) {
  const BATCH_SIZE = 8; // 每批處理8個URL
  const allResults = [];
  
  // 先並行抓取所有網站內容
  const websitePromises = urls.slice(0, 20).map(async (url) => {
    try {
      const websiteData = await fetchWebsiteContent(url);
      return websiteData;
    } catch (error) {
      console.error(`Failed to fetch ${url}:`, error.message);
      return {
        title: url.replace(/^https?:\/\//, '').split('/')[0],
        description: '',
        keywords: '',
        author: '',
        pageType: '',
        rawContent: '',
        headings: [],
        navLinks: [],
        url: url
      };
    }
  });
  
  const websiteDataList = await Promise.all(websitePromises);
  
  // 將網站資料分組，每組8個
  for (let i = 0; i < websiteDataList.length; i += BATCH_SIZE) {
    const batch = websiteDataList.slice(i, i + BATCH_SIZE);
    console.log(`處理第 ${Math.floor(i / BATCH_SIZE) + 1} 批，包含 ${batch.length} 個網站`);
    
    try {
      // 批次分析這一組網站
      const batchResults = await analyzeBatchWebsiteFunctions(batch);
      allResults.push(...batchResults);
    } catch (error) {
      console.error(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批分析失敗：`, error);
      
      // 如果批次分析失敗，為該批次提供預設結果
      const fallbackResults = batch.map(data => {
        const siteName = data.url.replace(/^https?:\/\//, '').split('/')[0];
        const title = data.title || siteName;
        const domainKeywords = siteName.toLowerCase();
        const contentKeywords = (data.description + ' ' + data.rawContent).toLowerCase();
        
        let fallbackInfo = '';
        
        if (contentKeywords.includes('ai') || contentKeywords.includes('gpt') || domainKeywords.includes('ai')) {
          fallbackInfo = `${title} 是一個AI技術平台，提供智能分析、自然語言處理、機器學習等功能。支援多種AI應用場景，能夠協助用戶進行智能化的數據處理和決策支援，適合技術開發者和企業用戶使用。`;
        } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || domainKeywords.includes('design')) {
          fallbackInfo = `${title} 是一個設計創作工具，提供視覺設計、創意製作、多媒體編輯等功能。內建豐富的設計元素和模板資源，支援團隊協作和專案管理，適合設計師和創意專業人士使用。`;
        } else if (contentKeywords.includes('code') || contentKeywords.includes('dev') || domainKeywords.includes('code')) {
          fallbackInfo = `${title} 是一個開發工具平台，提供程式編輯、專案管理、版本控制等功能。支援多種開發語言和框架，具備智能代碼提示和自動化部署功能，適合軟體開發者和技術團隊使用。`;
        } else {
          fallbackInfo = `${title} 提供專業的數位解決方案，具備完整的功能模組和現代化的使用者介面。支援多種應用需求和客製化設定，能夠有效提升工作效率和使用體驗，適合各領域專業人士使用。`;
        }
        
        return {
          title: title,
          info: fallbackInfo
        };
      });
      allResults.push(...fallbackResults);
    }
  }
  
  return allResults;
}

// 解析包含多個連結的訊息
async function parseMessage(message) {
  // 修正URL正則表達式，支援更多格式
  const urlMatches = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
  
  console.log('Found URLs:', urlMatches);
  
  if (urlMatches && urlMatches.length > 1) {
    // 處理多個連結的情況
    return await parseMultipleLinks(message, urlMatches);
  } else {
    // 處理單個連結或無連結的情況
    return await parseSingleMessage(message);
  }
}

async function parseMultipleLinks(message, urls) {
  // 確保所有URL都有協議前綴
  const fullUrls = urls.map(url => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'https://' + url;
    }
    return url;
  });
  
  console.log(`處理 ${fullUrls.length} 個網址`);
  
  const prompt = `
請分析以下文本中的工具連結，為每個連結提取繁體中文的基本資訊。

請為每個連結從文本中提取：
1. 工具的中文名稱或功能描述
2. 工具的主要用途或類型

回傳 JSON 陣列格式：
[{"url":"完整網址","title":"工具名稱","description":"從文本中提取的功能說明"}]

文本內容：
"""${message}"""

連結列表：
${fullUrls.map((url, index) => `${index + 1}. ${url}`).join('\n')}

請確保所有回答都使用繁體中文。
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    let linkData = JSON.parse(jsonString);
    
    if (!Array.isArray(linkData)) {
      linkData = [linkData];
    }
    
    // 如果LLM沒有回傳所有URL，補充缺失的
    if (linkData.length < fullUrls.length) {
      const processedUrls = new Set(linkData.map(item => item.url));
      
      for (const url of fullUrls) {
        if (!processedUrls.has(url)) {
          linkData.push({
            url: url,
            title: url.replace(/^https?:\/\//, '').split('/')[0],
            description: '數位工具'
          });
        }
      }
    }
    
    // 批量分析網站內容 (使用新的8個一組批次處理)
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    // 建立最終資料
    const enrichedData = fullUrls.map((url, index) => {
      const linkInfo = linkData.find(item => item.url === url) || {
        title: url.replace(/^https?:\/\//, '').split('/')[0],
        description: '數位工具'
      };
      
      const websiteData = websiteAnalysis[index] || {
        title: linkInfo.title,
        info: linkInfo.description
      };
      
      return {
        category: "Link",
        title: websiteData.title || linkInfo.title,
        content: linkInfo.description, // 保持原始從訊息中提取的內容
        info: websiteData.info || '這個工具提供專業的線上服務，具備完整的功能套件和現代化的使用者介面，能夠有效提升工作效率和使用者體驗，適合各種專業應用場景。', // 網站深度分析的功能介紹
        url: url,
        apiKey: "",
        documentInfo: ""
      };
    });
    
    console.log(`建立 ${enrichedData.length} 個項目`);
    return enrichedData;
  } catch (error) {
    console.error('解析連結時發生錯誤：', error);
    
    // 備用方案 (使用新的8個一組批次處理)
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    const fallbackData = fullUrls.map((url, index) => ({
      category: "Link",
      title: websiteAnalysis[index]?.title || url.replace(/^https?:\/\//, '').split('/')[0],
      content: '從用戶訊息中提取的連結', // 原始內容
      info: websiteAnalysis[index]?.info || '這個工具提供專業的數位服務解決方案，具備先進的技術架構和使用者友善的介面設計，能夠滿足多樣化的應用需求，提升工作效率和使用體驗。', // 功能介紹
      url: url,
      apiKey: "",
      documentInfo: ""
    }));
    
    return fallbackData;
  }
}

async function parseSingleMessage(message) {
  const prompt = `
你是一個智能訊息分類助手。請將以下用戶訊息解析為結構化數據。請嚴格按照 JSON 格式輸出，不要包含任何額外的文字或解釋。如果某個字段無法從訊息中提取，請使用空字串或 null。

輸出 JSON 格式應為：
{
  "category": "", // 類別：可以是 "Note" (筆記), "Todo" (待辦事項), "Link" (連結), "API_Key" (API金鑰), "Document" (文件), "Idea" (想法), "Other" (其他)
  "title": "", // 訊息的簡要標題，如果沒有明確標題，請從內容中提取關鍵詞
  "content": "", // 訊息的詳細內容
  "url": "", // 如果訊息包含URL，請提取
  "apiKey": "", // 如果訊息包含API金鑰，請提取
  "documentInfo": "" // 如果訊息是關於文件，請提取文件相關資訊
}

用戶訊息：
"""${message}"""
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // 清理回應並解析JSON
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const parsedData = JSON.parse(jsonString);
    
    // 檢測URL
    const urlMatch = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
    if (urlMatch && urlMatch.length > 0) {
      let url = urlMatch[0];
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      parsedData.url = url;
      parsedData.category = "Link";
      
      // 如果是單個連結，使用深度分析
      try {
        const websiteData = await fetchWebsiteContent(url);
        const analysis = await analyzeWebsiteFunction(url, websiteData);
        
        if (analysis) {
          parsedData.title = analysis.title || parsedData.title;
          parsedData.info = analysis.info;
        }
      } catch (analysisError) {
        console.error('Single link analysis failed:', analysisError);
        // 使用備用分析
        const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
        parsedData.title = parsedData.title || siteName;
        parsedData.info = `${parsedData.title} 提供專業的線上服務，具備現代化的功能設計和使用者友善的操作介面，能夠滿足用戶的多樣化需求，提升工作效率和使用體驗。`;
      }
    }
    
    return [parsedData]; // 返回陣列格式保持一致性
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 檢測URL的備用方案
    const urlMatch = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
    const isUrl = urlMatch && urlMatch.length > 0;
    
    let analysis = null;
    let url = '';
    if (isUrl) {
      url = urlMatch[0];
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      
      try {
        const websiteData = await fetchWebsiteContent(url);
        analysis = await analyzeWebsiteFunction(url, websiteData);
      } catch (analysisError) {
        console.error('Fallback analysis failed:', analysisError);
        const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
        analysis = {
          title: siteName,
          info: `${siteName} 提供專業的數位服務解決方案，具備完整的功能架構和直觀的使用者介面，能夠有效滿足用戶需求並提升工作效率。`
        };
      }
    }
    
    // Fallback to a default structure if LLM parsing fails
    return [{
      category: isUrl ? "Link" : "Other",
      title: analysis ? analysis.title : message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      content: message, // 保持原始訊息內容
      info: analysis ? analysis.info : '', // 網站功能介紹
      url: isUrl ? url : "",
      apiKey: "",
      documentInfo: ""
    }];
  }
}

module.exports = {
  parseMessage,
};
