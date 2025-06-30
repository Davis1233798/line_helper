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

const MODELS = [
  "gemini-2.5-pro",
  "gemini-1.5-pro",
  "gemini-2.5-flash",
  "gemini-1.5-flash"
].filter(m => m); // 過濾掉可能的空值

if (GEMINI_KEYS.length === 0) {
  console.error('錯誤：沒有找到任何有效的 GEMINI_API_KEY，請檢查 .env 檔案。');
  process.exit(1);
}

console.log(`🔑 成功載入 ${GEMINI_KEYS.length} 個 Gemini API Key`);
console.log(`🧠 可用模型序列: ${MODELS.join(' -> ')}`);

let currentKeyIndex = 0;
let currentModelIndex = 0;
let genAI;
let model;

function updateAIClient() {
  if (currentKeyIndex >= GEMINI_KEYS.length || currentModelIndex >= MODELS.length) {
    console.error("錯誤：金鑰或模型索引超出範圍。");
    return;
  }
  const key = GEMINI_KEYS[currentKeyIndex];
  const modelName = MODELS[currentModelIndex];
  try {
    genAI = new GoogleGenerativeAI(key);
    model = genAI.getGenerativeModel({ model: modelName });
    console.log(`🔄 AI 客戶端已更新 | 模型: ${modelName} | Key: #${currentKeyIndex + 1}`);
  } catch (error) {
    console.error(`初始化 GoogleGenerativeAI 失敗 (Key #${currentKeyIndex + 1})`, error);
  }
}

// 初始化
updateAIClient();

function switchToNextApiKey() {
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEYS.length;
  console.log(`🔑 切換至 API Key #${currentKeyIndex + 1}/${GEMINI_KEYS.length}`);
  updateAIClient();
  // 如果key輪換了一圈，返回true，提示模型也該切換了
  return currentKeyIndex === 0;
}

function switchToNextModel() {
  currentModelIndex = (currentModelIndex + 1) % MODELS.length;
  console.log(`🧠 切換至模型 #${currentModelIndex + 1}/${MODELS.length}: ${MODELS[currentModelIndex]}`);
  currentKeyIndex = 0; // 重設金鑰索引
  console.log(`🔑 金鑰重設至 #1`);
  updateAIClient();
  return currentModelIndex === 0; // 如果模型也輪換了一圈，返回true
}


// 2. 核心重試函式
/**
 * 使用多金鑰、多模型策略呼叫 LLM，並包含回應驗證。
 * @param {string} prompt - 傳給 LLM 的提示。
 * @param {function(string): boolean} isResponseValid - 驗證 LLM 回應是否有效的函式。
 * @param {number} maxModelCycles - 模型最大循環次數。
 * @returns {Promise<import('@google/generative-ai').EnhancedGenerateContentResponse>}
 */
async function callLLMWithRetryLogic(prompt, isResponseValid, maxModelCycles = 1) {
    let lastError = null;

    for (let cycle = 0; cycle < maxModelCycles; cycle++) {
        for (let modelIdx = 0; modelIdx < MODELS.length; modelIdx++) {
            for (let keyIdx = 0; keyIdx < GEMINI_KEYS.length; keyIdx++) {
                const modelName = MODELS[currentModelIndex];
                const keyIndex = currentKeyIndex;

                console.log(`🚀 開始 LLM 調用 | 模型: ${modelName} (#${currentModelIndex + 1}/${MODELS.length}) | Key: #${keyIndex + 1}/${GEMINI_KEYS.length}`);

                try {
                    const result = await model.generateContent(prompt);
                    const response = result.response;
                    const responseText = response.text();

                    if (isResponseValid(responseText)) {
                        console.log(`✅ 調用成功並通過驗證 | 模型: ${modelName}, Key: #${keyIndex + 1}`);
                        return response;
                    } else {
                        lastError = new Error("回應內容無效或不完整");
                        console.warn(`⚠️  調用成功但未通過驗證 | 模型: ${modelName}, Key: #${keyIndex + 1}`);
                        console.warn(`   L 回應內容: ${responseText.substring(0, 100)}...`);
                    }
                } catch (error) {
                    lastError = error;
                    console.error(`❌ LLM 調用失敗 | 模型: ${modelName}, Key: #${keyIndex + 1} | 錯誤: ${error.message}`);
                    const isQuotaError = error.message.includes('quota') || error.message.includes('API key') || error.message.includes('rate limit') || error.status === 429;
                    if (isQuotaError) {
                        console.log('   L 偵測到配額/金鑰錯誤，立即切換金鑰。');
                    } else {
                        await new Promise(res => setTimeout(res, 1000)); // 對於其他錯誤，稍作等待
                    }
                }
                switchToNextApiKey();
            }
            console.log(`🏁 模型 ${MODELS[currentModelIndex]} 的所有 API Key 都已嘗試。`);
            switchToNextModel();
        }
        console.log(` ciclo ${cycle + 1}/${maxModelCycles} completado. Si es necesario, se iniciará un nuevo ciclo.`);
    }

    console.error('🚨 所有模型和 API Key 都已嘗試，仍然無法獲取有效回應。');
    throw lastError || new Error('無法從 LLM 獲取有效回應。');
}

// 3. 驗證函式
function isJsonResponseValid(text) {
  try {
    const jsonString = text.replace(/```json\n?|```/g, '').trim();
    if (!jsonString) return false;
    const data = JSON.parse(jsonString);
    return data && typeof data === 'object';
  } catch (e) {
    console.warn('   L JSON 解析失敗:', e.message);
    return false;
  }
}

function isAnalysisResponseValid(text) {
    try {
        const jsonString = text.replace(/```json\n?|```/g, '').trim();
        if (!jsonString) return false;
        const data = JSON.parse(jsonString);
        // 確保 data 是物件且 title 屬性存在且不為空
        return data && typeof data === 'object' && data.title && data.title.trim() !== '';
    } catch (e) {
        console.warn('   L 分析回應的 JSON 解析失敗:', e.message);
        return false;
    }
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
  // 將網站數據中最關鍵的部分傳遞給LLM
  const content = `${websiteData.title}\n${websiteData.description}\n${websiteData.rawContent.substring(0, 15000)}`;
  const prompt = `
    你是一個專業的內容分析師，你的任務是從給定的網站內容中提取結構化資訊。
    請遵循以下規則：

    1.  **標題 (title)**: 提取最合適、最簡潔的頁面主標題。這是最重要的欄位，必須提供。
    2.  **分類 (category)**: 從以下列表中選擇一個最符合的分類：[${VALID_CATEGORIES.join(', ')}]。
    3.  **標籤 (tags)**: 根據內容生成5到8個相關的關鍵字標籤，以便於搜尋和分類。
    4.  **摘要 (info)**: 產生一段約100-150字的摘要，總結網站的核心內容。
    5.  **事件 (events)**: 找出所有重要的日期和時間。對於每一個找到的事件，請提供標題、事件類型、和精確的日期時間。
        - 事件類型分類：deadline, registration, start, end, participation, meeting, reminder, event。
        - 日期必須是未來的，並轉換為 "YYYY-MM-DDTHH:mm:ss" 的 ISO 8601 格式。
        - 如果年份不明確，請根據當前年份（${new Date().getFullYear()}）推斷。
        - 如果沒有找到任何有效日期，請回傳一個空陣列 []。

    你的輸出必須是嚴格的 JSON 格式，不包含任何額外的解釋或註釋。格式如下：

    {
      "title": "網站主標題",
      "category": "選擇的分類",
      "tags": ["標籤1", "標籤2", ...],
      "info": "網站內容摘要...",
      "url": "${url}",
      "events": [{"type": "事件類型", "title": "事件標題", "date": "YYYY-MM-DDTHH:mm:ss", "description": "詳細描述"}, ...]
    }

    網站內容如下：
    """
    ${content}
    """
  `;

  try {
    console.log(`🚀 開始分析網站 (單次調用): ${url}`);
    const response = await callLLMWithRetryLogic(prompt, isAnalysisResponseValid);
    let jsonString = response.text().replace(/```json\n?|```/g, '').trim();
    const result = JSON.parse(jsonString);

    // 將 result.events 中的 date 字串轉換為 Date 物件
    if (result.events && Array.isArray(result.events)) {
      result.events = result.events.map(event => {
        if (event.date && typeof event.date === 'string') {
          const eventDate = new Date(event.date);
          if (!isNaN(eventDate.getTime())) {
            return { ...event, date: eventDate };
          }
        }
        return null; // 如果日期無效，則過濾掉
      }).filter(Boolean); // 移除 null
      
      console.log(`📅 從網站內容中提取到 ${result.events.length} 個事件`);
      result.events.forEach(event => {
        console.log(`  • [${event.type}] ${event.title} - ${event.date.toLocaleString('zh-TW')}`);
      });
    }


    console.log(`✅ 成功分析網站: ${result.title}`);
    return result;

  } catch (error) {
    console.error(`在 analyzeWebsiteFunction 中分析 ${url} 時發生無法恢復的錯誤:`, error);
    return generateDefaultInfo(url, websiteData); // Fallback to a default
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
    const response = await callLLMWithRetryLogic(prompt, isJsonResponseValid);
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
  const prompt = `
  你是一個模糊搜尋專家。這裡有一筆資料，和一個搜尋查詢。
  資料: ${JSON.stringify(searchData, null, 2)}
  查詢: "${query}"
  請判斷查詢是否與資料中的 "title" 或 "info" 高度相關。只需回答 "true" 或 "false"。
  `;
  try {
    const response = await callLLMWithRetryLogic(prompt, (text) => text.includes('true') || text.includes('false'));
    const result = response.text().toLowerCase();
    return result.includes('true');
  } catch (error) {
    console.error('模糊搜尋失敗:', error);
    return false;
  }
}

async function analyzeTextFunction(message) {
  const prompt = `
  你是一個專業的內容分析師，你的任務是從給定的文本中提取結構化資訊。
  請遵循以下規則：

  1.  **標題 (title)**: 提取最合適、最簡潔的主標題。這是最重要的欄位，必須提供。
  2.  **分類 (category)**: 從以下列表中選擇一個最符合的分類：[${VALID_CATEGORIES.join(', ')}]。
  3.  **標籤 (tags)**: 根據內容生成5到8個相關的關鍵字標籤，以便於搜尋和分類。
  4.  **摘要 (info)**: 產生一段約100-150字的摘要，總結文本的核心內容。
  5.  **事件 (events)**: 如果文本中包含日期和時間，提取它們。格式為 {type, title, date, description} 的陣列。

  你的輸出必須是嚴格的 JSON 格式，不包含任何額外的解釋或註釋。

  文本內容如下：
  """
  ${message}
  """
  `;
  try {
    const response = await callLLMWithRetryLogic(prompt, isAnalysisResponseValid);
    let jsonString = response.text().replace(/```json\n?|```/g, '').trim();
    const data = JSON.parse(jsonString);
    console.log('✅ 成功分析文本:', data.title);
    return [data];
  } catch (error) {
    console.error('分析文本時發生無法恢復的錯誤:', error);
    return [{
      title: "分析失敗",
      category: "其他",
      tags: ["錯誤"],
      info: `無法解析以下文本: ${message}`,
      url: null,
      events: []
    }];
  }
}

module.exports = {
  parseMessage,
  analyzeWebsiteFunction,
  analyzeBatchWebsiteFunctions,
  generateGoogleCalendarLink,
};
