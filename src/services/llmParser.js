require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');
const { JSDOM } = require('jsdom');

// 支援多個 Gemini API Key 的故障轉移
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(key => key && key.trim() !== ''); // 移除空值

if (GEMINI_KEYS.length === 0) {
  console.error('錯誤：沒有找到有效的 GEMINI_API_KEY');
  process.exit(1);
}

let currentKeyIndex = 0;
let genAI = new GoogleGenerativeAI(GEMINI_KEYS[currentKeyIndex]);
let model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

console.log(`🔑 載入了 ${GEMINI_KEYS.length} 個 Gemini API Key`);

// 切換到下一個 API Key
function switchToNextApiKey() {
  if (GEMINI_KEYS.length <= 1) {
    console.warn('⚠️  只有一個 API Key，無法進行故障轉移');
    return false;
  }
  
  const oldIndex = currentKeyIndex;
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEYS.length;
  genAI = new GoogleGenerativeAI(GEMINI_KEYS[currentKeyIndex]);
  model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  console.log(`🔄 從 API Key #${oldIndex + 1} 切換至 API Key #${currentKeyIndex + 1}`);
  console.log(`🔑 當前使用的 API Key: ${GEMINI_KEYS[currentKeyIndex].substring(0, 10)}...`);
  return true;
}

// 帶有故障轉移的 API 調用
async function callGeminiWithFailover(prompt, maxRetries = GEMINI_KEYS.length) {
  let lastError;
  let allKeysFailed = true;
  
  console.log(`🚀 開始 Gemini API 調用，使用 Key #${currentKeyIndex + 1}/${GEMINI_KEYS.length}`);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      const response = result.response;
      
      // 成功調用
      allKeysFailed = false;
      if (currentKeyIndex !== 0 || attempt > 0) {
        console.log(`✅ API Key #${currentKeyIndex + 1} 調用成功 (嘗試 ${attempt + 1}/${maxRetries})`);
      }
      
      return response;
    } catch (error) {
      lastError = error;
      console.error(`❌ API Key #${currentKeyIndex + 1} 調用失敗 (嘗試 ${attempt + 1}/${maxRetries}):`, error.message);
      
      // 檢查是否是配額或認證錯誤
      const isQuotaError = error.message.includes('quota') || 
                          error.message.includes('API key') || 
                          error.message.includes('rate limit') ||
                          error.message.includes('permission') ||
                          error.message.includes('429') ||
                          error.message.includes('403');
      
      if (isQuotaError && attempt < maxRetries - 1) {
        const switched = switchToNextApiKey();
        if (switched) {
          console.log(`🔄 正在重試 API 調用...`);
          continue;
        }
      }
      
      // 如果是其他錯誤，等待一下再重試
      if (attempt < maxRetries - 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`⏳ 等待 ${delay}ms 後重試...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
    }
  }
  
  // 所有 API Key 都失敗了
  if (allKeysFailed) {
    console.error('🚨 所有 Gemini API Key 都失敗！考慮切換到更低階模型或檢查配額');
    console.error('💡 建議：1. 檢查 API Key 配額 2. 等待配額重置 3. 添加更多 API Key');
  }
  
  throw new Error(`所有 ${GEMINI_KEYS.length} 個 API Key 都失敗了。最後錯誤: ${lastError.message}`);
}

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

// 【增強】使用 LLM 提取日期和時間資訊，支援多種事件類型
async function extractDateTimeInfo(websiteData) {
  const content = `${websiteData.title}\n${websiteData.description}\n${websiteData.rawContent.substring(0, 15000)}`;
  
  const prompt = `
    你是一個專門從文本中提取事件和日期的AI助理。請仔細閱讀以下網站內容，找出所有重要的日期和時間。
    對於每一個找到的事件，請提供標題、事件類型、和精確的日期時間。
    
    事件類型分類：
    - "deadline": 截止日期、申請截止、報名截止、最後期限
    - "registration": 報名開始、註冊開放、申請開始、登記開始
    - "start": 活動開始、開幕、啟動、上線、發布
    - "end": 活動結束、閉幕、完成、下線
    - "participation": 參加日期、出席日期、活動舉辦日
    - "meeting": 會議、座談會、研討會、討論會
    - "reminder": 提醒事項、重要通知
    - "event": 其他一般事件
    
    規則：
    1. 只回傳有效的、未來的日期。忽略過去的日期。
    2. 如果年份不明確，請根據當前年份（${new Date().getFullYear()}）進行推斷。
    3. 如果只提到日期但沒有時間，請根據事件類型設定合理時間：
       - deadline: 23:59
       - registration: 09:00
       - start/meeting: 10:00
       - end: 18:00
       - participation: 14:00
       - 其他: 12:00
    4. 將提取的日期和時間轉換為 "YYYY-MM-DDTHH:mm:ss" 的 ISO 8601 格式。
    5. 最終結果必須是 JSON 格式的陣列，格式為：
       [{"title": "事件標題", "type": "事件類型", "iso_datetime": "YYYY-MM-DDTHH:mm:ss", "description": "詳細描述"}]
    6. 如果沒有找到任何有效日期，請回傳一個空陣列 []。

    網站內容如下：
    """
    ${content}
    """
  `;

  try {
    const response = await callGeminiWithFailover(prompt);
    let jsonString = response.text().replace(/```json\n|```/g, '').trim();
    
    // 增加一個健全的 JSON 解析過程
    if (!jsonString.startsWith('[')) {
        jsonString = '[' + jsonString.substring(jsonString.indexOf('{'));
    }
    if (!jsonString.endsWith(']')) {
        jsonString = jsonString.substring(0, jsonString.lastIndexOf('}') + 1) + ']';
    }

    const extractedEvents = JSON.parse(jsonString);
    const events = [];

    if (Array.isArray(extractedEvents)) {
      for (const ev of extractedEvents) {
        if (ev.title && ev.iso_datetime) {
          const eventDate = new Date(ev.iso_datetime);
          // 再次確認日期是有效的並且是未來的
          if (!isNaN(eventDate.getTime()) && eventDate > new Date()) {
            events.push({
              type: ev.type || 'event', // 使用 LLM 判斷的事件類型
              title: ev.title,
              date: eventDate,
              description: ev.description || `${ev.title}: ${eventDate.toLocaleString('zh-TW')}`
            });
          }
        }
      }
    }
    
    console.log(`📅 從網站內容中提取到 ${events.length} 個事件`);
    events.forEach(event => {
      console.log(`  • [${event.type}] ${event.title} - ${event.date.toLocaleString('zh-TW')}`);
    });
    
    return events;
  } catch (error) {
    console.error('使用 LLM 提取日期時發生錯誤:', error);
    console.error('LLM 回傳的原始字串:', error.message.includes('JSON') ? jsonString : 'N/A');
    return []; // 發生錯誤時回傳空陣列
  }
}

// 生成 Google 行事曆連結
function generateGoogleCalendarLink(event) {
  const baseUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE';
  const title = encodeURIComponent(event.title);
  const startTime = event.date.toISOString().replace(/-|:|\.\d{3}/g, '');
  const endTime = new Date(event.date.getTime() + 60 * 60 * 1000).toISOString().replace(/-|:|\.\d{3}/g, '');
  const details = encodeURIComponent(event.description);
  
  return `${baseUrl}&text=${title}&dates=${startTime}/${endTime}&details=${details}&sf=true&output=xml`;
}

// 生成 Apple 行事曆 ICS 檔案內容和下載連結
async function generateAppleCalendarLink(event) {
  const uid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@linenotionbot.com`;
  const startTime = event.date.toISOString().replace(/-|:|\.\d{3}/g, '');
  const endTime = new Date(event.date.getTime() + 60 * 60 * 1000).toISOString().replace(/-|:|\.\d{3}/g, '');
  const now = new Date().toISOString().replace(/-|:|\.\d{3}/g, '');

  // 清理文本內容以符合 ICS 格式要求
  const cleanText = (text) => {
    return text.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
  };

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Line Notion Bot//Event Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `DTSTART:${startTime}`,
    `DTEND:${endTime}`,
    `DTSTAMP:${now}`,
    `UID:${uid}`,
    `CREATED:${now}`,
    `LAST-MODIFIED:${now}`,
    `SUMMARY:${cleanText(event.title)}`,
    `DESCRIPTION:${cleanText(event.description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  // 生成 base64 編碼以確保特殊字元正確處理
  const base64Content = Buffer.from(icsContent, 'utf-8').toString('base64');
  
  // 返回一個對象，包含多種格式
  return {
    dataUrl: `data:text/calendar;charset=utf-8,${encodeURIComponent(icsContent)}`,
    base64Url: `data:text/calendar;charset=utf-8;base64,${base64Content}`,
    filename: `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.ics`,
    content: icsContent
  };
}

// 生成行事曆資訊
async function generateCalendarInfo(events) {
  if (!events || events.length === 0) {
    return null;
  }
  
  const calendarInfoPromises = events.map(async (event) => {
    const googleUrl = generateGoogleCalendarLink(event);
    const appleCalendarInfo = await generateAppleCalendarLink(event);
    
    return {
      type: event.type,
      title: event.title,
      date: event.date.toISOString(),
      description: event.description,
      googleCalendarUrl: googleUrl,
      appleCalendarUrl: appleCalendarInfo.dataUrl,
      appleCalendarBase64: appleCalendarInfo.base64Url,
      appleFilename: appleCalendarInfo.filename,
      icsContent: appleCalendarInfo.content
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
  const contentToAnalyze = `${websiteData.title}\n${websiteData.description}\n${websiteData.rawContent.substring(0, 8000)}`;
  const prompt = `請分析此網站內容，並以繁體中文回傳 JSON 格式：{"title": "網站標題", "category": "類別", "tags": ["標籤1", "標籤2"], "info": "功能介紹"}。可用類別：${VALID_CATEGORIES.join(', ')}。內容："""${contentToAnalyze}"""`;
  
  try {
    const response = await callGeminiWithFailover(prompt);
    let jsonString = response.text().replace(/```json\n|```/g, '').trim();
    const analysis = JSON.parse(jsonString);

    // 【新增】驗證從 LLM 返回的物件結構
    if (analysis && analysis.title && analysis.info && analysis.category) {
        if (!VALID_CATEGORIES.includes(analysis.category)) {
            analysis.category = "其他"; // 確保分類有效
        }
        return analysis; // 結構有效，直接返回
    } else {
        // 如果結構無效，拋出錯誤以觸發 catch 區塊的備用邏輯
        throw new Error('LLM returned invalid JSON structure.');
    }

  } catch (error) {
    console.error('分析網站時 LLM 處理失敗或回傳格式不符:', error.message);
    console.log('啟用備用方案，從網頁標籤生成基本資訊。');
    
    // 備用方案：從網頁的 <title> 和 <meta> 標籤生成基本資訊
    return {
      title: websiteData.title || url.substring(url.lastIndexOf('/') + 1),
      category: generateDefaultCategory(websiteData),
      tags: [],
      info: generateDefaultInfo(websiteData.title, websiteData),
    };
  }
}

// 批次分析多個網站功能 (8個一組)
async function analyzeBatchWebsiteFunctions(websiteDataList) {
  const prompt = `
    你是一個網站分析工具。請為以下每個網站生成摘要、分類和標籤。
    以繁體中文回傳一個 JSON 陣列，每個物件包含 "title", "category", "tags", "info"。
    可用類別：${VALID_CATEGORIES.join(', ')}。
    網站列表：
    ${websiteDataList.map((data, index) => `${index + 1}. URL: ${data.url}\n   Title: ${data.title}\n   Content: ${data.rawContent.substring(0, 2000)}`).join('\n\n')}
  `;
  try {
    const response = await callGeminiWithFailover(prompt);
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
  const calendarEvents = await extractDateTimeInfo(websiteData);
  return [{ ...analysisResult, url: url, events: calendarEvents }];
}

// 處理多個連結
async function parseMultipleLinks(message, urls) {
  try {
    const websiteAnalysis = await module.exports.fetchMultipleWebsiteContents(urls);
    const enrichedData = await Promise.all(urls.map(async (url, index) => {
      const analysis = websiteAnalysis[index] || {};
      const websiteData = { rawContent: analysis.info || "", title: analysis.title || "", description: ""};
      const calendarEvents = await extractDateTimeInfo(websiteData);
      
      return {
        category: analysis.category || "其他",
        tags: analysis.tags || [],
        title: analysis.title || url.replace(/^https?:\/\//, '').split('/')[0],
        info: analysis.info || '無法生成摘要。',
        url: url,
        events: calendarEvents
      };
    }));
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
  const prompt = `你是一個智能訊息分類助手。請將以下用戶訊息解析為結構化數據。請嚴格按照 JSON 格式輸出。輸出 JSON 格式應為：{"category": "...","title": "...", "content": "..."} 用戶訊息："""${message}"""`;
  try {
    const response = await callGeminiWithFailover(prompt);
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
