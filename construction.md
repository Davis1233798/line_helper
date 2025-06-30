# Line Notion Bot - 技術架構與實作細節

## 📋 專案概述

本專案是一個基於 Node.js 的 Line Bot 應用程式，整合了多項 AI 和雲端服務，提供智慧內容管理和行事曆功能。

### 核心價值
- **智慧化**：AI 驅動的內容分析和自動分類
- **整合性**：跨平台服務整合（Line、Notion、Google Calendar）
- **穩定性**：故障轉移機制和錯誤處理
- **可擴展性**：模組化設計，易於擴展新功能

## 🏗️ 系統架構

### 整體架構圖
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Line Platform │    │   Express Server │    │  External APIs  │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │   Webhook   │◄────┤ │    Router    │ │    │ │   Gemini    │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ │     AI      │ │
│                 │    │         │        │    │ └─────────────┘ │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ Message API │◄────┤ │   Services   │◄────┤ │   Notion    │ │
│ └─────────────┘ │    │ │              │ │    │ │     API     │ │
└─────────────────┘    │ │ ┌──────────┐ │ │    │ └─────────────┘ │
                       │ │ │   LLM    │ │ │    │ ┌─────────────┐ │
                       │ │ │ Parser   │ │ │    │ │   Google    │ │
                       │ │ └──────────┘ │ │    │ │  Calendar   │ │
                       │ │ ┌──────────┐ │ │    │ └─────────────┘ │
                       │ │ │ Notion   │ │ │    └─────────────────┘
                       │ │ │ Manager  │ │ │
                       │ │ └──────────┘ │ │
                       │ │ ┌──────────┐ │ │
                       │ │ │ Calendar │ │ │
                       │ │ │ Manager  │ │ │
                       │ │ └──────────┘ │ │
                       │ └──────────────┘ │
                       └──────────────────┘
```

### 資料流程
1. **接收訊息**：Line Webhook → Express Router
2. **訊息解析**：內容分析 → URL 提取 → 類型判斷
3. **AI 處理**：Gemini API → 內容分析 → 智慧分類
4. **資料儲存**：Notion API → 資料庫操作
5. **回應生成**：結果整理 → Line Message API

## 🔧 技術棧詳細說明

### 後端框架
- **Express.js 5.1.0**
  - 中間件支援
  - 路由管理
  - 靜態檔案服務
  - 錯誤處理機制

### 外部服務整合
- **Line Bot SDK 10.0.0**
  - Webhook 處理
  - 訊息簽名驗證
  - 回覆訊息 API
  
- **Google Gemini AI**
  - 內容分析和摘要
  - 智慧分類
  - 日期提取
  - 多 API Key 故障轉移

- **Notion API 3.1.3**
  - 資料庫 CRUD 操作
  - 動態欄位映射
  - 搜尋和篩選
  - 批次處理

- **Google Calendar API**
  - 自動事件新增
  - 服務帳號認證
  - 時區處理

### 輔助套件
- **Axios 1.6.0**：HTTP 請求處理
- **Cheerio 1.0.0-rc.12**：HTML 解析
- **JSDOM 26.1.0**：DOM 操作
- **dotenv 17.0.0**：環境變數管理

## 📁 專案結構詳解

```
line_helper/
├── src/
│   ├── index.js                 # 主應用程式入口
│   └── services/
│       ├── llmParser.js         # AI 內容解析服務
│       ├── notionManager.js     # Notion 資料庫管理
│       └── googleCalendarManager.js  # Google Calendar 整合
├── package.json                 # 專案配置和依賴
├── .env.example                 # 環境變數範例
├── README.md                    # 使用者文件
└── construction.md              # 技術文件
```

### 核心模組說明

#### `src/index.js` - 主應用程式
- **Express 伺服器設定**
- **Webhook 端點處理**
- **中間件配置**
- **路由定義**
- **錯誤處理**

主要功能：
```javascript
// 健康檢查端點
app.get('/health', healthCheck);

// Line Webhook 處理
app.post('/webhook', webhookHandler);

// Apple 日曆下載端點
app.get('/download-ics/:eventId', icsDownload);

// 網路連線偵測
checkInternetConnection();
```

#### `src/services/llmParser.js` - AI 解析服務
核心功能：
- **URL 提取和驗證**
- **網頁內容抓取**
- **AI 內容分析**
- **日期時間提取**
- **行事曆連結生成**
- **故障轉移機制**

關鍵實作：
```javascript
// 多 API Key 故障轉移
const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3
].filter(key => key && key.trim() !== '');

// 智慧重試機制
async function callGeminiWithFailover(prompt, maxRetries = GEMINI_KEYS.length) {
  // 實作 API 故障轉移邏輯
}
```

#### `src/services/notionManager.js` - Notion 管理服務
主要功能：
- **動態欄位映射**
- **資料庫 CRUD 操作**
- **搜尋和篩選**
- **批次處理**
- **重複檢測**

關鍵特性：
```javascript
// 動態欄位識別
const titleFieldNames = ['Name', 'Title', '標題', '名稱', 'name', 'title'];

// 智慧搜尋
async function searchNotion(keyword, category = null) {
  // 實作複雜的搜尋邏輯
}
```

#### `src/services/googleCalendarManager.js` - 日曆管理
功能：
- **Google Calendar API 整合**
- **事件自動新增**
- **錯誤處理**
- **時區管理**

## 🚀 核心功能實作細節

### 1. 訊息處理流程

#### 訊息類型判斷
```javascript
// 搜尋查詢檢測
const isSearch = /查詢|搜尋|找|查找|查|search/.test(userMessage.substring(0, 10));

if (isSearch) {
  await handleSearchQuery(event, userMessage);
  return;
}
```

#### URL 提取算法
```javascript
function extractUrls(message) {
  const urlRegex = /https?:\/\/[^\s]+|(?:www\.)?[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?:\/[^\s]*)?/g;
  const matches = message.match(urlRegex) || [];
  return matches.map(url => {
    if (!url.startsWith('http')) {
      return 'https://' + url;
    }
    return url;
  });
}
```

### 2. AI 內容分析

#### 內容摘要和分類
```javascript
const prompt = `請分析此網站內容，並以繁體中文回傳 JSON 格式：
{"title": "網站標題", "category": "類別", "tags": ["標籤1", "標籤2"], "info": "功能介紹"}。
可用類別：${VALID_CATEGORIES.join(', ')}。
內容："""${contentToAnalyze}"""`;
```

#### 日期提取
```javascript
const prompt = `你是一個專門從文本中提取事件和日期的AI助理。
請仔細閱讀以下網站內容，找出所有重要的日期和時間。
規則：
1. 只回傳有效的、未來的日期
2. 如果年份不明確，請根據當前年份（${new Date().getFullYear()}）進行推斷
3. 轉換為 ISO 8601 格式
4. 最終結果必須是 JSON 格式的陣列`;
```

### 3. 故障轉移機制

#### API Key 自動切換
```javascript
async function switchToNextApiKey() {
  if (GEMINI_KEYS.length <= 1) {
    return false;
  }
  
  currentKeyIndex = (currentKeyIndex + 1) % GEMINI_KEYS.length;
  genAI = new GoogleGenerativeAI(GEMINI_KEYS[currentKeyIndex]);
  model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  
  console.log(`🔄 切換至 API Key #${currentKeyIndex + 1}`);
  return true;
}
```

#### 智慧重試邏輯
- **配額錯誤**：立即切換 API Key
- **網路錯誤**：指數退避重試
- **其他錯誤**：有限次數重試

### 4. 資料庫操作

#### 動態欄位映射
Notion 資料庫支援多種欄位名稱：
- 標題欄位：`Name`, `Title`, `標題`, `名稱`
- 分類欄位：`Category`（支援單選和多選）
- 內容欄位：`info`, `Info`, `功能介紹`, `Description`

#### 重複檢測
```javascript
async function checkUrlExists(url) {
  const response = await notion.databases.query({
    database_id: databaseId,
    filter: {
      property: 'URL',
      url: { equals: url }
    }
  });
  
  return response.results.length > 0;
}
```

### 5. 行事曆整合

#### Google Calendar 事件新增
```javascript
const calendarEvent = {
  summary: event.title,
  description: event.description,
  start: {
    dateTime: eventStartTime.toISOString(),
    timeZone: 'Asia/Taipei',
  },
  end: {
    dateTime: eventEndTime.toISOString(),
    timeZone: 'Asia/Taipei',
  },
};
```

#### Apple 日曆 ICS 生成
```javascript
const icsContent = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Line Notion Bot//Event Calendar//EN',
  'CALSCALE:GREGORIAN',
  'METHOD:PUBLISH',
  'BEGIN:VEVENT',
  `DTSTART:${startTime}`,
  `DTEND:${endTime}`,
  `SUMMARY:${cleanText(event.title)}`,
  `DESCRIPTION:${cleanText(event.description)}`,
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');
```

## 🔍 搜尋系統

### 搜尋邏輯
1. **關鍵字解析**：移除查詢關鍵詞，提取核心內容
2. **分類匹配**：檢查是否包含預設分類
3. **複合搜尋**：組合分類和關鍵字搜尋
4. **模糊匹配**：支援部分匹配和權重計算

### 搜尋權重系統
- 標題匹配：權重 10
- 分類匹配：權重 8
- URL 匹配：權重 6
- 內容匹配：權重 3

## 🛡️ 安全性設計

### 1. Webhook 驗證
```javascript
const crypto = require('crypto');
const hash = crypto
  .createHmac('SHA256', config.channelSecret)
  .update(body)
  .digest('base64');

if (hash !== signature) {
  console.error('Signature validation failed');
  return;
}
```

### 2. 環境變數保護
- 敏感資訊不寫入程式碼
- 使用 dotenv 管理環境變數
- 生產環境使用安全的變數儲存

### 3. 錯誤處理
```javascript
try {
  // 主要邏輯
} catch (error) {
  console.error('Error:', error);
  // 避免洩漏詳細錯誤給使用者
  const userFacingError = error.message.includes('URL') 
    ? '處理的網址似乎無效，請檢查。' 
    : '處理您的請求時發生未預期的錯誤，請稍後再試。';
}
```

## 📊 效能優化

### 1. 並行處理
- 多 URL 批次處理
- Promise.all 並行執行
- 非同步操作優化

### 2. 快取機制
- Notion 資料本地快取
- API 響應快取
- 重複請求防護

### 3. 資源管理
- 連接池管理
- 記憶體使用優化
- 超時設定

## 🚀 部署架構

### Docker 化
```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 10000
CMD ["npm", "start"]
```

### 環境配置
- **開發環境**：本地開發，完整日誌
- **測試環境**：模擬生產環境
- **生產環境**：Render 部署，環境變數管理

### 監控和日誌
- 應用程式日誌
- 錯誤追蹤
- 效能監控
- API 調用統計

## 🔄 持續改進

### 已實現的改進
1. **網路偵測優化**：適應 Docker 環境
2. **API 故障轉移**：提高服務可用性
3. **行事曆功能**：完整的跨平台支援
4. **搜尋優化**：智慧搜尋算法

### 未來規劃
1. **Redis 快取**：提升查詢效能
2. **數據分析**：使用統計和報表
3. **多語言支援**：國際化功能
4. **API 限流**：防止濫用

## 🧪 測試策略

### 單元測試
- 核心功能模組測試
- API 介面測試
- 錯誤處理測試

### 整合測試
- 服務間整合測試
- 端到端功能測試
- 性能壓力測試

### 部署測試
- 環境配置驗證
- 服務健康檢查
- 災難恢復測試

---

本文件記錄了 Line Notion Bot 的詳細技術實作，為後續開發和維護提供參考。 