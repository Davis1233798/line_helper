# LINE Notion Bot 專案概述

## 專案目的
這是一個 LINE Bot，整合了 AI 和 Notion 功能：
- 接收用戶的文字訊息或網址連結
- 使用 Google Gemini AI 分析和分類內容
- 自動儲存到 Notion 資料庫
- 支援搜尋已儲存的資料

## 主要功能
1. **訊息解析**: 使用 LLM 解析用戶訊息，提取標題、分類、內容等
2. **網站分析**: 爬取網站內容並進行 AI 分析
3. **批量處理**: 支援一次處理多個連結
4. **Notion 整合**: 自動儲存到 Notion 資料庫
5. **搜尋功能**: 支援關鍵字和分類搜尋

## 技術架構
- **主程式**: `src/index.js` - Express 伺服器和 LINE Bot 邏輯
- **AI 解析**: `src/services/llmParser.js` - 使用 Gemini AI 進行內容分析
- **Notion 管理**: `src/services/notionManager.js` - Notion API 操作