# 程式碼風格與約定

## 程式碼風格
- 使用繁體中文註解和 console.log
- 函數命名使用 camelCase
- 常數使用 UPPER_SNAKE_CASE
- 使用 async/await 處理非同步操作
- 優先使用 const，需要重新賦值時使用 let

## 錯誤處理
- 使用 try-catch 包裹所有非同步操作
- 記錄詳細的錯誤訊息
- 對於 Notion API 操作，提供 fallback 機制

## 命名約定
- 函數名稱描述性強，如 `fetchWebsiteContent`, `analyzeBatchWebsiteFunctions`
- 變數名稱簡潔明瞭
- 中英文混用但保持一致性

## 模組化
- 功能分離到 services 目錄
- 使用 module.exports 導出函數
- 主程式僅處理路由和 Bot 邏輯