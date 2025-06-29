require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

function extractUrls(message) {
  if (!message) return [];
  const urlRegex = /https?:\/\/[^\s]+|(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?:\/[^\s]*)?/g;
  const matches = message.match(urlRegex) || [];
  return matches.map(url => {
    if (!url.startsWith('http')) {
      return 'https://' + url;
    }
    return url;
  });
}

// 定義標準分類和子標籤
const VALID_CATEGORIES = [
  "其他", "運動與健身", "飲食", "娛樂", "旅遊", "創造力", 
  "生產力工具", "資訊與閱讀", "遊戲", "購物", "教育", "財經", "社交"
];

// 定義細緻的子分類標籤
const CATEGORY_TAGS = {
  "生產力工具": ["AI助手", "開發工具", "辦公軟體", "專案管理", "自動化"],
  "創造力": ["設計軟體", "影片編輯", "音樂製作", "繪圖工具", "創作平台"],
  "資訊與閱讀": ["新聞", "部落格", "學習資源", "資料庫", "文檔"],
  "教育": ["線上課程", "教學平台", "學習工具", "技能培訓"],
  "娛樂": ["影音", "遊戲", "社群", "休閒"],
  "遊戲": ["遊戲平台", "遊戲工具", "電競"],
  "社交": ["社群媒體", "通訊軟體", "論壇"],
  "購物": ["電商平台", "購物工具", "比價"],
  "財經": ["投資", "理財工具", "加密貨幣", "金融服務"],
  "運動與健身": ["健身應用", "運動追蹤", "健康管理"],
  "飲食": ["美食", "食譜", "餐廳", "營養"],
  "旅遊": ["旅遊規劃", "住宿預訂", "交通", "地圖"]
};

// 日期提取和行事曆功能
function extractDateTimeInfo(websiteData) {
  const content = `${websiteData.title} ${websiteData.description} ${websiteData.rawContent}`;
  const potentialDates = new Set(); // 使用 Set 來避免重複的日期字串

  // 匹配各種日期格式
  const datePatterns = [
    /\d{3}\/\d{1,2}\/\d{1,2}/g, // 民國年格式: 114/07/01
    /\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}/g, // 西元年格式: 2025/07/01, 2025-07-01
    /\d{1,2}月\d{1,2}日/g // 中文日期格式: 7月1日
  ];

  // 步驟1: 找出所有可能的日期字串
  datePatterns.forEach(pattern => {
    const matches = content.match(pattern) || [];
    matches.forEach(dateStr => potentialDates.add(dateStr));
  });

  const events = [];
  
  // 步驟2: 處理找到的唯一日期
  potentialDates.forEach(dateStr => {
    let year, month, day;
    
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts[0].length === 3) { // 民國年
        year = parseInt(parts[0]) + 1911;
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
      } else { // 西元年
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
      }
    } else if (dateStr.includes('-')) { // 西元年
      const parts = dateStr.split('-');
      year = parseInt(parts[0]);
      month = parseInt(parts[1]);
      day = parseInt(parts[2]);
    } else if (dateStr.includes('月')) { // 中文日期
      const parts = dateStr.replace('日', '').split('月');
      month = parseInt(parts[0]);
      day = parseInt(parts[1]);
      year = new Date().getFullYear(); // 假設為當年
    }

    if (year && month && day) {
      // 尋找日期周圍的上下文
      const dateIndex = content.indexOf(dateStr);
      const context = content.substring(Math.max(0, dateIndex - 30), dateIndex + dateStr.length + 30);
      
      const isDeadline = /報名.*?截止|截止.*?報名|報名.*?時間|活動.*?時間|日期/.test(context);
      
      if (isDeadline) {
        // 提取對應的時間
        const timeMatch = context.match(/(\d{1,2}):(\d{2})/);
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
  });
  
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

// 生成 Apple 行事曆連結 (ICS 格式)，透過外部服務產生可下載連結
async function generateAppleCalendarLink(event) {
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

  try {
    // 使用 hastebin 服務來託管 .ics 內容
    const response = await axios.post('https://hastebin.com/documents', icsContent, {
      headers: { 'Content-Type': 'text/plain' }
    });
    
    // 組成可直接下載的 raw 連結
    const key = response.data.key;
    return `https://hastebin.com/raw/${key}`;
  } catch (error) {
    console.error('上傳 ICS 內容到 hastebin 失敗:', error.message);
    // 備用方案：如果上傳失敗，仍然使用 data URI
    return `data:text/calendar;charset=utf8,${encodeURIComponent(icsContent)}`;
  }
}

// 生成行事曆資訊
async function generateCalendarInfo(events) {
  if (!events || events.length === 0) {
    return null;
  }
  
  const calendarInfoPromises = events.map(async (event) => {
    const googleUrl = generateGoogleCalendarLink(event);
    const appleUrl = await generateAppleCalendarLink(event);
    
    return {
      type: event.type,
      title: event.title,
      date: event.date.toISOString(),
      description: event.description,
      googleCalendarUrl: googleUrl,
      appleCalendarUrl: appleUrl
    };
  });
  
  return Promise.all(calendarInfoPromises);
}

// 改進的網站內容抓取函數
async function fetchWebsiteContent(url) {
  try {
    const response = await axios.get(url, { 
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
    });
    
    const $ = cheerio.load(response.data);
    
    // 移除不必要的標籤
    $('script, style, noscript, iframe, link, meta').remove();
    
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() ||
                  '';

    const description = $('meta[name="description"]').attr('content') ||
                       $('p').first().text().trim() ||
                       '';

    const rawContent = $('body').text().replace(/\s+/g, ' ').trim();

    return {
      title: title,
      description: description,
      rawContent: rawContent.substring(0, 10000), // 限制內容長度
    };
  } catch (error) {
    console.error(`Error fetching website content for ${url}:`, error.message);
    return null;
  }
}

function generateDefaultInfo(title, websiteData) {
  const siteName = title || websiteData.url.replace(/^https?:\/\//, '').split('/')[0];
  const contentKeywords = (websiteData.description + ' ' + websiteData.rawContent).toLowerCase();
  
  if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
    return `${siteName} 是一個AI技術驅動的智能工具，提供機器學習、數據分析、自動化處理等功能，能夠幫助用戶解決複雜的數據處理和決策問題，提升工作效率和準確性。`;
  } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || contentKeywords.includes('visual')) {
    return `${siteName} 是一個創意設計工具，提供視覺設計、創意製作、多媒體編輯等功能，支援設計師和創作者進行專業級的作品製作，具備豐富的設計資源和直觀的操作介面。`;
  } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard')) {
    return `${siteName} 是一個數據分析平台，提供數據視覺化、報表生成、統計分析等功能，幫助企業和個人從數據中獲得洞察，支援決策制定和業務優化。`;
  }
  return `${siteName} 提供專業的線上服務，具備完整的功能套件和使用者友善的介面設計，能夠滿足用戶的多樣化需求，適用於提升工作效率和解決實際問題的各種場景。`;
}

function generateDefaultCategory(websiteData) {
  const contentKeywords = (websiteData.description + ' ' + websiteData.rawContent).toLowerCase();
  if (contentKeywords.includes('ai') || contentKeywords.includes('artificial intelligence') || contentKeywords.includes('machine learning')) {
    return '生產力工具';
  } else if (contentKeywords.includes('design') || contentKeywords.includes('creative') || contentKeywords.includes('visual')) {
    return '創造力';
  } else if (contentKeywords.includes('data') || contentKeywords.includes('analytics') || contentKeywords.includes('dashboard')) {
    return '生產力工具';
  }
  return '其他';
}

// 使用 LLM 深度分析網站功能並分類
async function analyzeWebsiteFunction(url, websiteData) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const contentToAnalyze = `${websiteData.title}\n${websiteData.description}\n${websiteData.rawContent.substring(0, 8000)}`;
  const prompt = `請分析此網站內容，並以繁體中文回傳 JSON 格式：{"title": "網站標題", "category": "類別", "tags": ["標籤1", "標籤2"], "info": "功能介紹"}。可用類別：${VALID_CATEGORIES.join(', ')}。內容："""${contentToAnalyze}"""`;
  
  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    let jsonString = response.text().replace(/```json\n|```/g, '').trim();
    const analysis = JSON.parse(jsonString);
    if (!VALID_CATEGORIES.includes(analysis.category)) {
      analysis.category = "其他";
    }
    return analysis;
  } catch (error) {
    console.error('Error analyzing website with LLM:', error);
    return {
      title: websiteData.title || url,
      category: '其他',
      tags: [],
      info: websiteData.description || '無法生成介紹。'
    };
  }
}

// 批次分析多個網站功能 (8個一組)
async function analyzeBatchWebsiteFunctions(websiteDataList) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = `
    你是一個網站分析工具。請為以下每個網站生成摘要、分類和標籤。
    以繁體中文回傳一個 JSON 陣列，每個物件包含 "title", "category", "tags", "info"。
    可用類別：${VALID_CATEGORIES.join(', ')}。
    網站列表：
    ${websiteDataList.map((data, index) => `${index + 1}. URL: ${data.url}\n   Title: ${data.title}\n   Content: ${data.rawContent.substring(0, 2000)}`).join('\n\n')}
  `;
  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    let jsonString = response.text().replace(/```json\n|```/g, '').trim();
    const batchResults = JSON.parse(jsonString);

    return batchResults.map(analysis => {
      if (!VALID_CATEGORIES.includes(analysis.category)) {
        analysis.category = "其他";
      }
      return analysis;
    });
  } catch (error) {
    console.error('批次分析網站功能失敗：', error);
    return websiteDataList.map(data => ({
      title: data.title,
      category: '其他',
      tags: [],
      info: '無法自動分析網站'
    }));
  }
}

// 批量抓取並分析網站內容 (改為8個一組批次處理)
async function fetchMultipleWebsiteContents(urls) {
  const BATCH_SIZE = 5;
  let allResults = [];
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    const batchUrls = urls.slice(i, i + BATCH_SIZE);
    console.log(`處理第 ${Math.floor(i / BATCH_SIZE) + 1} 批，包含 ${batchUrls.length} 個網站`);
    
    const batchWebsiteData = await Promise.all(batchUrls.map(url => fetchWebsiteContent(url)));
    const validWebsiteData = batchWebsiteData.filter(data => data !== null).map((data, index) => ({...data, url: batchUrls[index]}));

    try {
      if (validWebsiteData.length > 0) {
        const batchAnalysisResults = await analyzeBatchWebsiteFunctions(validWebsiteData);
        allResults.push(...batchAnalysisResults);
      }
    } catch (error) {
        console.error(`第 ${Math.floor(i / BATCH_SIZE) + 1} 批分析失敗：`, error);
        const fallbackResults = validWebsiteData.map(data => ({
            title: data.title || "未知標題",
            category: "其他",
            tags: [],
            info: "無法自動分析網站"
        }));
        allResults.push(...fallbackResults);
    }
  }
  return allResults;
}

// 解析包含多個連結的訊息
async function parseMessage(message) {
  console.log('Received message:', message);
  const urls = extractUrls(message);
  console.log('Found URLs:', urls);

  if (!urls || urls.length === 0) {
    const analysisResult = await analyzeTextFunction(message);
    return [{...analysisResult, url: '', events: []}];
  } else if (urls.length === 1) {
    return parseSingleMessage(message, urls);
  } else {
    return parseMultipleLinks(message, urls);
  }
}

// 處理單一訊息（可能包含一個連結，或純文字）
async function parseSingleMessage(message, urls) {
  const url = urls[0];
  const websiteData = await fetchWebsiteContent(url);
  if (!websiteData) {
    return [{ title: url, info: "無法讀取網站內容", url: url, category: "其他", tags: [], events: [] }];
  }
  const analysisResult = await analyzeWebsiteFunction(url, websiteData);
  const calendarEvents = extractDateTimeInfo(websiteData);
  return [{ ...analysisResult, url: url, events: calendarEvents }];
}

// 處理多個連結
async function parseMultipleLinks(message, urls) {
  try {
    const websiteAnalysis = await module.exports.fetchMultipleWebsiteContents(urls);
    const enrichedData = urls.map((url, index) => {
      const analysis = websiteAnalysis[index] || {};
      const websiteData = { rawContent: analysis.info || "", title: analysis.title || "", description: ""};
      const calendarEvents = extractDateTimeInfo(websiteData);
      
      return {
        category: analysis.category || "其他",
        tags: analysis.tags || [],
        title: analysis.title || url.replace(/^https?:\/\//, '').split('/')[0],
        info: analysis.info || '無法生成摘要。',
        url: url,
        events: calendarEvents
      };
    });
    console.log(`建立 ${enrichedData.length} 個項目`);
    return enrichedData;
  } catch (error) {
    console.error('解析連結時發生錯誤：', error);
    const fallbackData = urls.map(url => ({
      category: "其他",
      tags: [],
      title: url.replace(/^https?:\/\//, '').split('/')[0],
      info: '解析過程中發生錯誤。',
      url: url,
      events: []
    }));
    return fallbackData;
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

async function analyzeTextFunction(message) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const prompt = `你是一個智能訊息分類助手。請將以下用戶訊息解析為結構化數據。請嚴格按照 JSON 格式輸出。輸出 JSON 格式應為：{"category": "...","title": "...", "content": "..."} 用戶訊息："""${message}"""`;
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    let jsonString = response.text().replace(/```json\n|```/g, '').trim();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error in analyzeTextFunction:', error);
    return {
      title: message.substring(0, 20),
      category: '其他',
      content: message
    };
  }
}

module.exports = {
  parseMessage,
  fuzzySearch,
  extractDateTimeInfo,
  VALID_CATEGORIES,
  CATEGORY_TAGS,
  generateCalendarInfo,
  generateGoogleCalendarLink,
  generateAppleCalendarLink,
  fetchMultipleWebsiteContents
};
