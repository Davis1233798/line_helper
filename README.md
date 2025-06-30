# Line Notion Bot

一個功能豐富的 Line Bot，整合 AI 內容分析、Notion 資料庫管理和智慧行事曆功能。

## 🌟 專案特色

- **智慧內容分析**：使用 Google Gemini AI 自動分析網址內容和文字訊息
- **自動分類儲存**：智慧分類並儲存到 Notion 資料庫
- **強大搜尋功能**：支援關鍵字和分類搜尋
- **行事曆整合**：自動提取重要日期，支援 Google Calendar 和 Apple 日曆
- **故障轉移機制**：多組 API Key 自動切換，確保服務穩定性
- **Docker 友善**：優化網路偵測，適合容器化部署

## 🚀 主要功能

### 📝 內容處理
- **網址解析**：自動抓取網頁內容並進行 AI 分析
- **文字分析**：處理純文字訊息並進行智慧分類
- **批次處理**：支援多個網址同時處理
- **重複檢測**：避免重複儲存相同內容

### 🗂️ 分類系統
支援 13 種預設分類：
- 生產力工具、創造力、資訊與閱讀、教育
- 娛樂、遊戲、社交、購物、財經、運動與健身
- 飲食、旅遊、其他

### 🔍 搜尋功能
- **關鍵字搜尋**：`查詢 [關鍵字]`
- **分類搜尋**：`查詢 [分類名稱]`
- **組合搜尋**：`查詢 [分類] [關鍵字]`

### 📅 行事曆功能（增強版）
- **智慧日期提取**：自動識別網頁中的重要日期
- **事件類型識別**：自動分類為截止日期、報名日期、開始日期、結束日期、參加日期等
- **Google Calendar 整合**：
  - 自動新增事件到指定日曆
  - 根據事件類型設定不同顏色和提醒
  - 批次處理多個事件
  - 智慧提醒設定（截止日期提前1天+2小時+15分鐘提醒）
- **Apple 日曆支援**：提供 ICS 檔案下載
- **日曆管理**：輸入「日曆列表」或「日曆ID」查詢可用的 Google Calendar

## 🔧 技術架構

### 核心技術
- **Node.js + Express**：後端服務框架
- **Line Bot SDK**：Line 平台整合
- **Google Gemini AI**：內容分析和智慧分類
- **Notion API**：資料庫操作
- **Google Calendar API**：行事曆整合

### 服務架構
```
Line 用戶 → Line Bot → Express Server → AI 分析 → Notion 儲存
                                    ↓
                          Google Calendar ← 行事曆功能
```

## 📦 安裝部署

### 環境需求
- Node.js 16+
- 有效的 Line Bot Channel
- Notion Integration Token
- Google Gemini API Key

### 1. 複製專案
```bash
git clone [your-repo-url]
cd line_helper
npm install
```

### 2. 環境變數設定
複製 `.env.example` 為 `.env` 並填入以下資訊：

```env
# Line Bot 設定（必需）
LINE_CHANNEL_ACCESS_TOKEN=your_line_channel_access_token
LINE_CHANNEL_SECRET=your_line_channel_secret

# Gemini API Keys（至少需要第一個）
GEMINI_API_KEY=your_primary_gemini_api_key
GEMINI_API_KEY_2=your_secondary_gemini_api_key_optional
GEMINI_API_KEY_3=your_tertiary_gemini_api_key_optional

# Notion 設定（必需）
NOTION_API_TOKEN=your_notion_api_token
NOTION_DATABASE_ID=your_notion_database_id

# Google Calendar 設定（可選）
GOOGLE_CALENDAR_ID=your_google_calendar_id@gmail.com
GOOGLE_CREDENTIALS_JSON={"type":"service_account",...}

# 應用程式設定
PORT=10000
BASE_URL=https://your-domain.com
```

### 3. Notion 資料庫設定
在 Notion 中建立資料庫，包含以下欄位：
- **Name/Title**（標題）：網站名稱
- **Category**（多選或單選）：分類標籤
- **info**（富文本）：功能介紹
- **URL**（網址）：原始連結
- **Content**（富文本）：額外內容

### 4. 本機開發
```bash
npm start
# 或使用開發模式
npm run dev
```

### 5. 生產部署
推薦使用 Render、Heroku 或 Railway 等平台：

1. 設定環境變數
2. 設定 Webhook URL：`https://your-domain.com/webhook`
3. 部署應用程式

## 🎯 使用方法

### 基本操作
1. **加入機器人**：掃描 Line Bot QR Code
2. **傳送網址**：直接貼上網址，機器人會自動分析並儲存
3. **傳送文字**：純文字訊息也會被分析和分類
4. **搜尋資料**：使用 `查詢` 關鍵字搜尋已儲存的內容

### 搜尋範例
```
查詢 AI
查詢 生產力工具
查詢 創造力 設計
```

### 行事曆功能
當訊息包含日期資訊時，機器人會：
1. **智慧識別事件類型**：
   - ⏰ 截止日期（deadline）
   - 📝 報名日期（registration）
   - 🚀 開始日期（start）
   - 🏁 結束日期（end）
   - 🎯 參加日期（participation）
   - 👥 會議（meeting）
   - 🔔 提醒事項（reminder）

2. **自動新增到 Google Calendar**：
   - 根據事件類型設定不同顏色
   - 智慧提醒設定（截止日期多重提醒）
   - 批次處理多個事件

3. **提供 Apple 日曆下載**：ICS 檔案格式

### 日曆管理指令
```
日曆列表        # 查詢所有可用的 Google Calendar
日曆ID          # 顯示日曆 ID 和使用說明
```

## 🛠️ API 端點

- `GET /`：健康檢查
- `GET /health`：詳細狀態檢查
- `POST /webhook`：Line Bot Webhook
- `GET /download-ics/:eventId`：Apple 日曆下載

## 🔐 安全性

- Webhook 簽名驗證
- 環境變數加密
- API Key 故障轉移
- 錯誤處理和日誌記錄

## 🚨 故障排除

### 常見問題
1. **網路偵測失敗**：Docker 環境中正常，不影響服務運行
2. **Gemini API 配額**：會自動切換到備用 API Key
3. **Notion 儲存失敗**：檢查資料庫欄位設定
4. **Google Calendar 無法新增**：檢查憑證和日曆 ID

### 日誌監控
應用程式提供詳細的日誌輸出，包括：
- API 調用狀態
- 錯誤詳情
- 效能指標

## 📊 效能特色

- **並行處理**：支援多網址批次處理
- **智慧重試**：API 失敗自動重試機制
- **快取機制**：本地 Notion 資料快取
- **錯誤恢復**：優雅的錯誤處理

## 🤝 貢獻指南

1. Fork 此專案
2. 建立功能分支
3. 提交變更
4. 發起 Pull Request

## 📄 授權

MIT License

## 🆘 支援

如有問題請建立 Issue 或聯繫開發者。

---

**注意**：本專案需要相應的 API 配額和權限，請確保所有服務正確設定後再部署使用。 