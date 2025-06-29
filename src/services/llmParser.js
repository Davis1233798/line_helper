const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 定義標準分類和子標籤
const VALID_CATEGORIES = [
  "其他", "運動與健身", "飲食", "娛樂", "旅遊", "創造力", 
  "生產力工具", "資訊與閱讀", "遊戲", "購物", "教育", "財經", "社交"
];

// 定義細緻的子分類標籤
const CATEGORY_TAGS = {
  "生產力工具": ["會議", "會議記錄", "筆記", "專案管理", "時間管理", "待辦事項", "文檔", "協作", "自動化", "AI助手", "代碼編輯", "雲端服務"],
  "創造力": ["設計", "影片編輯", "音樂製作", "繪圖", "3D建模", "圖像生成", "創作平台", "素材庫", "模板"],
  "資訊與閱讀": ["新聞", "部落格", "學習資源", "資料庫", "搜尋", "百科", "研究", "知識管理"],
  "教育": ["線上課程", "語言學習", "技能培訓", "考試準備", "教學工具", "學習平台"],
  "娛樂": ["影音平台", "串流服務", "音樂平台", "娛樂內容", "播客"],
  "遊戲": ["遊戲平台", "遊戲工具", "遊戲開發", "電競", "模擬器"],
  "社交": ["社群媒體", "通訊軟體", "論壇", "交友平台", "即時通訊"],
  "購物": ["電商平台", "比價服務", "商品搜尋", "優惠券", "購物助手"],
  "財經": ["投資平台", "理財工具", "加密貨幣", "股票交易", "金融分析", "記帳"],
  "運動與健身": ["健身應用", "運動追蹤", "健康管理", "體能訓練", "營養"],
  "飲食": ["美食應用", "食譜", "餐廳服務", "營養管理", "料理學習", "外送"],
  "旅遊": ["旅遊規劃", "住宿預訂", "交通服務", "旅遊資訊", "地圖導航"]
};

// 日期提取和行事曆功能
function extractDateTimeInfo(websiteData) {
  const content = `${websiteData.title} ${websiteData.description} ${websiteData.rawContent}`;
  
  // 匹配各種日期格式
  const datePatterns = [
    // 民國年格式: 114/07/01, 114/07/11
    /(\d{3})\/(\d{1,2})\/(\d{1,2})/g,
    // 西元年格式: 2025/07/01, 2025-07-01
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,
    // 中文日期格式: 7月1日, 七月一日
    /(\d{1,2}|\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)[\u6708](\d{1,2}|\u4e00|\u4e8c|\u4e09|\u56db|\u4e94|\u516d|\u4e03|\u516b|\u4e5d|\u5341)[\u65e5]/g
  ];
  
  const events = [];
  let match;
  
  // 提取日期
  for (const pattern of datePatterns) {
    while ((match = pattern.exec(content)) !== null) {
      let year, month, day;
      
      if (match[1].length === 3) {
        // 民國年轉西元年
        year = parseInt(match[1]) + 1911;
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      } else if (match[1].length === 4) {
        // 西元年
        year = parseInt(match[1]);
        month = parseInt(match[2]);
        day = parseInt(match[3]);
      }
      
      if (year && month && day) {
        // 檢查是否為報名截止日期
        const contextBefore = content.substring(Math.max(0, match.index - 20), match.index);
        const contextAfter = content.substring(match.index + match[0].length, match.index + match[0].length + 20);
        const context = contextBefore + match[0] + contextAfter;
        
        const isDeadline = /報名.*?截止|截止.*?報名|報名.*?時間|活動.*?時間/.test(context);
        
        if (isDeadline) {
          // 提取對應的時間
          const timeMatch = content.substring(match.index, match.index + 100).match(/(\d{1,2}):(\d{2})/);
          const hour = timeMatch ? parseInt(timeMatch[1]) : 23;
          const minute = timeMatch ? parseInt(timeMatch[2]) : 59;
          
          events.push({
            type: 'deadline',
            title: '報名截止',
            date: new Date(year, month - 1, day, hour, minute),
            description: `活動報名截止時間: ${year}年${month}月${day}日 ${hour}:${String(minute).padStart(2, '0')}`
          });
        }
      }
    }
  }
  
  return events;
}

// 生成 Google 行事曆連結
function generateGoogleCalendarLink(event) {
  const startDate = event.date;
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 預設1小時
  
  const formatDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${formatDate(startDate)}/${formatDate(endDate)}`,
    details: event.description,
    location: '',
    sf: 'true',
    output: 'xml'
  });
  
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// 生成 Apple 行事曆連結 (ICS 格式)
function generateAppleCalendarLink(event) {
  const startDate = event.date;
  const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
  
  const formatDate = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };
  
  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Line Notion Bot//Event//EN',
    'BEGIN:VEVENT',
    `DTSTART:${formatDate(startDate)}`,
    `DTEND:${formatDate(endDate)}`,
    `SUMMARY:${event.title}`,
    `DESCRIPTION:${event.description}`,
    `UID:${Date.now()}@linenotionbot.com`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  
  return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
}

// 生成行事曆資訊
function generateCalendarInfo(events) {
  if (!events || events.length === 0) {
    return null;
  }
  
  return events.map(event => ({
    type: event.type,
    title: event.title,
    date: event.date.toISOString(),
    description: event.description,
    googleCalendarUrl: generateGoogleCalendarLink(event),
    appleCalendarUrl: generateAppleCalendarLink(event)
  }));
}

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

// 使用 LLM 深度分析網站功能並分類
async function analyzeWebsiteFunction(url, websiteData) {
  const prompt = `
你是一個專業的網站分析師。請根據以下詳細的網站資訊，提供繁體中文的深度分析和分類。

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
2. **類別分類**: 必須從以下類別中選擇一個："其他", "運動與健身", "飲食", "娛樂", "旅遊", "創造力", "生產力工具", "資訊與閱讀", "遊戲", "購物", "教育", "財經", "社交"
3. **詳細功能介紹**: 請嚴格控制在60-100字以內的詳細描述

# 分類指導原則
- **生產力工具**: AI助手、開發工具、辦公軟體、專案管理、自動化工具、代碼編輯器、雲端服務
- **創造力**: 設計軟體、影片編輯、音樂製作、繪圖工具、創作平台、3D建模、圖像生成
- **資訊與閱讀**: 新聞網站、部落格、學習資源、資料庫、文檔工具、搜尋引擎、百科
- **教育**: 線上課程、教學平台、學習工具、技能培訓、語言學習、考試準備
- **娛樂**: 影音平台、串流服務、娛樂內容、音樂平台（非遊戲）
- **遊戲**: 專門的遊戲平台、遊戲工具、遊戲開發、電競相關
- **社交**: 社群媒體、通訊軟體、論壇、交友平台、協作工具
- **購物**: 電商平台、購物工具、比價服務、商品搜尋
- **財經**: 投資平台、理財工具、加密貨幣、股票交易、金融分析
- **運動與健身**: 健身應用、運動追蹤、健康管理、體能訓練
- **飲食**: 美食應用、食譜、餐廳服務、營養管理、料理學習
- **旅遊**: 旅遊規劃、住宿預訂、交通服務、旅遊資訊、地圖導航

# 回傳格式
請嚴格按照JSON格式回傳：
{
  "title": "具體的工具或服務名稱",
  "category": "主要分類類別（必須從上述13個類別中選擇）",
  "tags": ["相關的子標籤1", "相關的子標籤2"],
  "info": "嚴格60-100字的詳細功能描述，包含具體用途、特色和適用場景"
}

注意：
- category 必須是主要分類
- tags 應該包含2-4個相關的細分標籤，讓分類更精確
- 例如：category: "生產力工具", tags: ["會議", "會議記錄", "協作"]

請確保描述內容具體、實用且基於實際網站資訊，且字數嚴格控制在60-100字範圍內。
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
    let category = analysis.category || '其他';
    let tags = analysis.tags || [];
    
    // 驗證分類是否有效
    if (!VALID_CATEGORIES.includes(category)) {
      category = '其他';
    }
    
    // 處理和驗證標籤
    if (!Array.isArray(tags) || tags.length === 0) {
      // 如果沒有標籤，根據分類提供預設標籤
      if (CATEGORY_TAGS[category]) {
        tags = CATEGORY_TAGS[category].slice(0, 2); // 預設取前兩個標籤
      }
    }
    
    // 確保標籤數量合理 (2-4個)
    if (tags.length > 4) {
      tags = tags.slice(0, 4);
    } else if (tags.length < 2 && CATEGORY_TAGS[category]) {
      // 補足標籤
      const additionalTags = CATEGORY_TAGS[category].filter(tag => !tags.includes(tag));
      tags = [...tags, ...additionalTags].slice(0, 3);
    }
    
    // 如果描述太短，生成備用描述
    if (info.length < 60) {
      const siteName = websiteData.title || url.replace(/^https?:\/\//, '').split('/')[0];
      const domainKeywords = url.toLowerCase();
      const contentKeywords = (websiteData.description + ' ' + websiteData.rawContent).toLowerCase();
      
      if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
        info = `${siteName} 是一個AI技術驅動的智能工具，提供機器學習、數據分析、自動化處理等功能，能夠幫助用戶解決複雜的數據處理和決策問題，提升工作效率和準確性。`;
        category = '生產力工具';
      } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || contentKeywords.includes('visual')) {
        info = `${siteName} 是一個創意設計工具，提供視覺設計、創意製作、多媒體編輯等功能，支援設計師和創作者進行專業級的作品製作，具備豐富的設計資源和直觀的操作介面。`;
        category = '創造力';
      } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard')) {
        info = `${siteName} 是一個數據分析平台，提供數據視覺化、報表生成、統計分析等功能，幫助企業和個人從數據中獲得洞察，支援決策制定和業務優化。`;
        category = '生產力工具';
      } else {
        info = `${siteName} 提供專業的線上服務，具備完整的功能套件和使用者友善的介面設計，能夠滿足用戶的多樣化需求，適用於提升工作效率和解決實際問題的各種場景。`;
      }
    }
    
    // 提取行事曆資訊
    const events = extractDateTimeInfo(websiteData);
    const calendarInfo = generateCalendarInfo(events);
    
    return {
      title: title,
      category: category,
      tags: tags,
      info: info,
      calendarInfo: calendarInfo
    };
  } catch (error) {
    console.error(`深度分析網站功能失敗：${url}`, error);
    
    // 根據網站資訊生成備用描述和分類
    const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
    const title = websiteData.title || siteName;
    
    let fallbackInfo = '';
    let fallbackCategory = '其他';
    const domainKeywords = siteName.toLowerCase();
    const contentKeywords = (websiteData.description + ' ' + websiteData.rawContent).toLowerCase();
    
    if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
      fallbackInfo = `${title} 是一個AI技術驅動的智能工具，提供機器學習、數據分析、自動化處理等功能，能夠幫助用戶解決複雜的數據處理和決策問題，提升工作效率和準確性。`;
      fallbackCategory = '生產力工具';
    } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || contentKeywords.includes('visual')) {
      fallbackInfo = `${title} 是一個創意設計工具，提供視覺設計、創意製作、多媒體編輯等功能，支援設計師和創作者進行專業級的作品製作，具備豐富的設計資源和直觀的操作介面。`;
      fallbackCategory = '創造力';
    } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard')) {
      fallbackInfo = `${title} 是一個數據分析平台，提供數據視覺化、報表生成、統計分析等功能，幫助企業和個人從數據中獲得洞察，支援決策制定和業務優化。`;
      fallbackCategory = '生產力工具';
    } else {
      fallbackInfo = `${title} 提供專業的線上服務，具備完整的功能套件和使用者友善的介面設計，能夠滿足用戶的多樣化需求，適用於提升工作效率和解決實際問題的各種場景。`;
    }
    
    // 提取行事曆資訊
    const events = extractDateTimeInfo(websiteData);
    const calendarInfo = generateCalendarInfo(events);
    
    return {
      title: title,
      category: fallbackCategory,
      info: fallbackInfo,
      calendarInfo: calendarInfo
    };
  }
}

// 批次分析多個網站功能 (8個一組)
async function analyzeBatchWebsiteFunctions(websiteDataList) {
  if (!websiteDataList || websiteDataList.length === 0) {
    return [];
  }

  const websiteInfoText = websiteDataList.map((data, index) => {
    return `## 網站 ${index + 1}
- **URL**: ${data.url}
- **標題**: ${data.title || '未知'}
- **描述**: ${data.description || '無描述'}
- **關鍵字**: ${data.keywords || '無關鍵字'}
- **作者/公司**: ${data.author || '未知'}
- **頁面類型**: ${data.pageType || '未知'}
- **主要標題**: ${data.headings.length > 0 ? data.headings.slice(0, 5).join(', ') : '無標題'}
- **導航功能**: ${data.navLinks.length > 0 ? data.navLinks.slice(0, 5).join(', ') : '無導航'}
- **內容摘要**: ${data.rawContent || '無內容'}`;
  }).join('\n\n');

  const prompt = `
你是一個專業的網站分析師。請分析以下網站列表，為每個網站提供繁體中文的詳細描述和分類。

# 網站列表分析
${websiteInfoText}

# 分析要求
請為每個網站提供：
1. **工具名稱**: 網站的正確中文名稱或服務名稱
2. **類別分類**: 必須從以下類別中選擇一個："其他", "運動與健身", "飲食", "娛樂", "旅遊", "創造力", "生產力工具", "資訊與閱讀", "遊戲", "購物", "教育", "財經", "社交"
3. **詳細功能介紹**: 請嚴格控制在60-100字以內的詳細描述

# 分類指導原則
- **生產力工具**: AI助手、開發工具、辦公軟體、專案管理、自動化工具、代碼編輯器、雲端服務
- **創造力**: 設計軟體、影片編輯、音樂製作、繪圖工具、創作平台、3D建模、圖像生成
- **資訊與閱讀**: 新聞網站、部落格、學習資源、資料庫、文檔工具、搜尋引擎、百科
- **教育**: 線上課程、教學平台、學習工具、技能培訓、語言學習、考試準備
- **娛樂**: 影音平台、串流服務、娛樂內容、音樂平台（非遊戲）
- **遊戲**: 專門的遊戲平台、遊戲工具、遊戲開發、電競相關
- **社交**: 社群媒體、通訊軟體、論壇、交友平台、協作工具
- **購物**: 電商平台、購物工具、比價服務、商品搜尋
- **財經**: 投資平台、理財工具、加密貨幣、股票交易、金融分析
- **運動與健身**: 健身應用、運動追蹤、健康管理、體能訓練
- **飲食**: 美食應用、食譜、餐廳服務、營養管理、料理學習
- **旅遊**: 旅遊規劃、住宿預訂、交通服務、旅遊資訊、地圖導航

# 回傳格式
請嚴格按照JSON陣列格式回傳，按照輸入順序：
[
  {"title": "網站1的具體工具名稱", "category": "主要分類", "tags": ["子標籤1", "子標籤2"], "info": "嚴格60-100字的詳細功能描述"},
  {"title": "網站2的具體工具名稱", "category": "主要分類", "tags": ["子標籤1", "子標籤2"], "info": "嚴格60-100字的詳細功能描述"}
]

注意：每個網站都要包含 tags 陣列，提供2-4個相關的細分標籤

請確保每個描述都具體、實用且基於實際網站資訊，且字數嚴格控制在60-100字範圍內。
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
        category: '其他',
        info: ''
      };
      
      // 確保 info 欄位長度適中且內容豐富
      let info = analysis.info || '';
      let title = analysis.title || data.title || '';
      let category = analysis.category || '其他';
      let tags = analysis.tags || [];
      
      // 驗證分類是否有效
      if (!VALID_CATEGORIES.includes(category)) {
        category = '其他';
      }
      
      // 處理和驗證標籤
      if (!Array.isArray(tags) || tags.length === 0) {
        // 如果沒有標籤，根據分類提供預設標籤
        if (CATEGORY_TAGS[category]) {
          tags = CATEGORY_TAGS[category].slice(0, 2);
        }
      }
      
      // 確保標籤數量合理 (2-4個)
      if (tags.length > 4) {
        tags = tags.slice(0, 4);
      } else if (tags.length < 2 && CATEGORY_TAGS[category]) {
        const additionalTags = CATEGORY_TAGS[category].filter(tag => !tags.includes(tag));
        tags = [...tags, ...additionalTags].slice(0, 3);
      }
      
      // 如果回應太簡短，使用智能預設描述
      if (info.length < 60) {
        const siteName = data.url.replace(/^https?:\/\//, '').split('/')[0];
        const domainKeywords = siteName.toLowerCase();
        const contentKeywords = (data.description + ' ' + data.rawContent).toLowerCase();
        
        if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
          info = `${title} 是一個AI驅動的智能工具，提供自然語言處理、機器學習分析、智能問答等功能。支援多種AI模型，能夠協助用戶進行內容創作、數據分析、自動化任務處理，適合研究者、開發者和商業用戶使用。`;
          category = '生產力工具';
        } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || domainKeywords.includes('design')) {
          info = `${title} 是一個專業的設計創作平台，提供圖形設計、視覺創作、原型製作等功能。內建豐富的設計模板和素材庫，支援多人協作編輯，適合設計師和創意工作者使用。`;
          category = '創造力';
        } else if (contentKeywords.includes('code') || contentKeywords.includes('development') || contentKeywords.includes('programming')) {
          info = `${title} 是一個程式開發和技術工具平台，提供代碼編輯、專案管理、版本控制等功能。支援多種程式語言和開發框架，具備智能提示和自動化功能，適合開發者和技術團隊使用。`;
          category = '生產力工具';
        } else {
          info = `${title} 提供專業的線上服務解決方案，具備完整的功能模組和直觀的操作介面。支援多種應用場景和客製化需求，能夠有效提升使用者的工作效率和產品體驗，適合各行業的專業人士使用。`;
        }
      }
      
      // 提取行事曆資訊
      const events = extractDateTimeInfo(data);
      const calendarInfo = generateCalendarInfo(events);
      
      return {
        title: title,
        category: category,
        tags: tags,
        info: info,
        calendarInfo: calendarInfo
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
      let defaultCategory = '其他';
      
      if (contentKeywords.includes('ai') || contentKeywords.includes('gpt') || contentKeywords.includes('chat')) {
        defaultInfo = `${title} 是一個AI技術驅動的智能助手平台，提供自然語言處理、對話問答、內容生成等功能。支援多種AI模型和應用場景，能夠協助用戶進行創作、研究和問題解決，提升工作效率和創新能力。`;
        defaultCategory = '生產力工具';
      } else if (contentKeywords.includes('design') || contentKeywords.includes('creative')) {
        defaultInfo = `${title} 是一個創意設計和視覺製作平台，提供圖形設計、原型製作、多媒體編輯等功能。內建豐富的設計資源和模板庫，支援團隊協作和版本管理，適合設計師和創意工作者使用。`;
        defaultCategory = '創造力';
      } else if (contentKeywords.includes('code') || contentKeywords.includes('dev')) {
        defaultInfo = `${title} 是一個程式開發和技術工具平台，提供代碼編輯、專案管理、版本控制等功能。支援多種程式語言和開發框架，具備智能提示和自動化功能，適合開發者和技術團隊使用。`;
        defaultCategory = '生產力工具';
      } else {
        defaultInfo = `${title} 提供專業的數位服務解決方案，具備完整的功能套件和現代化的使用者介面。支援多種應用場景和客製化需求，能夠有效提升工作效率和使用者體驗，適合各領域的專業人士使用。`;
      }
      
      return {
        title: title,
        category: defaultCategory,
        tags: CATEGORY_TAGS[defaultCategory] ? CATEGORY_TAGS[defaultCategory].slice(0, 2) : [],
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
        let fallbackCategory = '其他';
        
        if (contentKeywords.includes('ai') || contentKeywords.includes('gpt')) {
          fallbackInfo = `${title} 是一個AI技術平台，提供智能分析、自然語言處理、機器學習等功能。支援多種AI應用場景，能夠協助用戶進行智能化的數據處理和決策支援，適合技術開發者和企業用戶使用。`;
          fallbackCategory = '生產力工具';
        } else if (contentKeywords.includes('design') || contentKeywords.includes('creative')) {
          fallbackInfo = `${title} 是一個設計創作工具，提供視覺設計、創意製作、多媒體編輯等功能。內建豐富的設計元素和模板資源，支援團隊協作和專案管理，適合設計師和創意專業人士使用。`;
          fallbackCategory = '創造力';
        } else if (contentKeywords.includes('code') || contentKeywords.includes('dev')) {
          fallbackInfo = `${title} 是一個開發工具平台，提供程式編輯、專案管理、版本控制等功能。支援多種開發語言和框架，具備智能代碼提示和自動化部署功能，適合軟體開發者和技術團隊使用。`;
          fallbackCategory = '生產力工具';
        } else {
          fallbackInfo = `${title} 提供專業的數位解決方案，具備完整的功能模組和現代化的使用者介面。支援多種應用需求和客製化設定，能夠有效提升工作效率和使用體驗，適合各領域專業人士使用。`;
        }
        
        // 提取行事曆資訊
        const events = extractDateTimeInfo(data);
        const calendarInfo = generateCalendarInfo(events);
        
        return {
          title: title,
          category: fallbackCategory,
          info: fallbackInfo,
          calendarInfo: calendarInfo
        };
      });
      allResults.push(...fallbackResults);
    }
  }
  
  return allResults;
}

// 解析包含多個連結的訊息
async function parseMessage(message) {
  // 改進的URL正則表達式，支援完整的URL格式包含查詢參數
  const urlMatches = message.match(/https?:\/\/[^\s]+|(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?:\/[^\s]*)?/g);
  
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
    
    // 批量分析網站內容
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    // 建立最終資料
    const enrichedData = fullUrls.map((url, index) => {
      const linkInfo = linkData.find(item => item.url === url) || {
        title: url.replace(/^https?:\/\//, '').split('/')[0],
        description: '數位工具'
      };
      
      const websiteData = websiteAnalysis[index] || {
        title: linkInfo.title,
        category: '其他',
        info: linkInfo.description
      };
      
      return {
        category: websiteData.category || "其他",
        tags: websiteData.tags || [],
        title: websiteData.title || linkInfo.title,
        content: linkInfo.description, 
        info: websiteData.info || '這個工具提供專業的線上服務，具備完整的功能套件和現代化的使用者介面，能夠有效提升工作效率和使用者體驗，適合各種專業應用場景。',
        url: url,
        apiKey: "",
        documentInfo: "",
        calendarInfo: websiteData.calendarInfo || null
      };
    });
    
    console.log(`建立 ${enrichedData.length} 個項目`);
    return enrichedData;
  } catch (error) {
    console.error('解析連結時發生錯誤：', error);
    
    // 備用方案
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    const fallbackData = fullUrls.map((url, index) => ({
      category: websiteAnalysis[index]?.category || "其他",
      tags: websiteAnalysis[index]?.tags || [],
      title: websiteAnalysis[index]?.title || url.replace(/^https?:\/\//, '').split('/')[0],
      content: '從用戶訊息中提取的連結',
      info: websiteAnalysis[index]?.info || '這個工具提供專業的數位服務解決方案，具備先進的技術架構和使用者友善的介面設計，能夠滿足多樣化的應用需求，提升工作效率和使用體驗。',
      url: url,
      apiKey: "",
      documentInfo: "",
      calendarInfo: websiteAnalysis[index]?.calendarInfo || null
    }));
    
    return fallbackData;
  }
}

async function parseSingleMessage(message) {
  const prompt = `
你是一個智能訊息分類助手。請將以下用戶訊息解析為結構化數據。請嚴格按照 JSON 格式輸出，不要包含任何額外的文字或解釋。如果某個字段無法從訊息中提取，請使用空字串或 null。

輸出 JSON 格式應為：
{
  "category": "", // 類別：必須是以下其中一個："其他", "運動與健身", "飲食", "娛樂", "旅遊", "創造力", "生產力工具", "資訊與閱讀", "遊戲", "購物", "教育", "財經", "社交"
  "title": "", // 訊息的簡要標題，如果沒有明確標題，請從內容中提取關鍵詞
  "content": "", // 訊息的詳細內容
  "url": "", // 如果訊息包含URL，請提取
  "apiKey": "", // 如果訊息包含API金鑰，請提取
  "documentInfo": "" // 如果訊息是關於文件，請提取文件相關資訊
}

分類指導原則：
- "生產力工具": AI助手、開發工具、辦公軟體、專案管理、自動化工具
- "創造力": 設計軟體、影片編輯、音樂製作、繪圖工具、創作平台
- "資訊與閱讀": 新聞網站、部落格、學習資源、資料庫、文檔工具
- "教育": 線上課程、教學平台、學習工具、技能培訓
- "娛樂": 影音平台、遊戲（非主要遊戲）、娛樂內容
- "遊戲": 專門的遊戲平台、遊戲工具、遊戲相關服務
- "社交": 社群媒體、通訊軟體、論壇、交友平台
- "購物": 電商平台、購物工具、比價服務
- "財經": 投資平台、理財工具、加密貨幣、金融服務
- "運動與健身": 健身應用、運動追蹤、健康管理
- "飲食": 美食應用、食譜、餐廳服務、營養管理
- "旅遊": 旅遊規劃、住宿預訂、交通服務、旅遊資訊
- "其他": 無法歸類到以上任何類別的內容

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
    const urlMatch = message.match(/https?:\/\/[^\s]+|(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?:\/[^\s]*)?/g);
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
          parsedData.category = analysis.category || parsedData.category;
          parsedData.info = analysis.info;
          parsedData.calendarInfo = analysis.calendarInfo;
        }
      } catch (analysisError) {
        console.error('Single link analysis failed:', analysisError);
        // 使用備用分析
        const siteName = url.replace(/^https?:\/\//, '').split('/')[0];
        parsedData.title = parsedData.title || siteName;
        parsedData.info = `${parsedData.title} 提供專業的線上服務，具備完整的功能套件和現代化的使用者介面，能夠有效提升工作效率和使用者體驗，適合各種專業應用場景。`;
      }
    }
    
    return [parsedData]; // 返回陣列格式保持一致性
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 檢測URL的備用方案
    const urlMatch = message.match(/https?:\/\/[^\s]+|(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*(?:\/[^\s]*)?/g);
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
          info: `${siteName} 提供專業的數位服務解決方案，具備完整的功能架構和直觀的使用者介面，能夠滿足用戶需求並提升工作效率。`
        };
      }
    }
    
    // Fallback to a default structure if LLM parsing fails
    return [{
      category: analysis ? analysis.category || "其他" : (isUrl ? "其他" : "其他"),
      tags: analysis ? analysis.tags || [] : [],
      title: analysis ? analysis.title : message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      content: message, // 保持原始訊息內容
      info: analysis ? analysis.info : '', // 網站功能介紹
      url: isUrl ? url : "",
      apiKey: "",
      documentInfo: "",
      calendarInfo: analysis ? analysis.calendarInfo : null
    }];
  }
}

// 模糊搜尋功能
async function fuzzySearch(query, searchData) {
  if (!query || !searchData || !Array.isArray(searchData)) {
    return [];
  }
  
  const keywords = query.toLowerCase().split(/\s+/);
  const results = [];
  
  for (const item of searchData) {
    let score = 0;
    const searchableText = `${item.title || ''} ${item.category || ''} ${item.content || ''} ${item.info || ''} ${item.url || ''}`.toLowerCase();
    
    // 計算匹配分數
    for (const keyword of keywords) {
      if (searchableText.includes(keyword)) {
        // 標題匹配權重最高
        if ((item.title || '').toLowerCase().includes(keyword)) {
          score += 10;
        }
        // 分類匹配權重較高
        if ((item.category || '').toLowerCase().includes(keyword)) {
          score += 8;
        }
        // URL匹配
        if ((item.url || '').toLowerCase().includes(keyword)) {
          score += 6;
        }
        // 內容匹配
        if ((item.content || '').toLowerCase().includes(keyword) || (item.info || '').toLowerCase().includes(keyword)) {
          score += 3;
        }
      }
    }
    
    if (score > 0) {
      results.push({
        ...item,
        searchScore: score
      });
    }
  }
  
  // 依分數排序，分數相同則按標題排序
  return results.sort((a, b) => {
    if (b.searchScore !== a.searchScore) {
      return b.searchScore - a.searchScore;
    }
    return (a.title || '').localeCompare(b.title || '');
  });
}

module.exports = {
  parseMessage,
  fuzzySearch,
  VALID_CATEGORIES,
  CATEGORY_TAGS,
  extractDateTimeInfo,
  generateCalendarInfo,
  generateGoogleCalendarLink,
  generateAppleCalendarLink
};
