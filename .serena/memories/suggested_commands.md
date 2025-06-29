# 建議的開發指令

## 開發指令
- `npm start` - 啟動正式伺服器
- `npm run dev` - 啟動開發伺服器（與 start 相同）
- `npm test` - 執行測試（目前未設定）

## Git 指令
- `git add .` - 暫存所有變更
- `git commit -m "訊息"` - 提交變更
- `git push` - 推送到遠端倉庫
- `git status` - 查看 Git 狀態
- `git log --oneline` - 查看簡短提交歷史

## Windows 系統指令
- `dir` - 列出目錄內容（等同於 Linux 的 ls）
- `cd` - 切換目錄
- `type` - 檢視檔案內容（等同於 Linux 的 cat）
- `findstr` - 在檔案中搜尋文字（等同於 Linux 的 grep）
- `powershell` - 切換到 PowerShell

## 除錯指令
- `node --version` - 檢查 Node.js 版本
- `npm --version` - 檢查 npm 版本
- `npm list` - 列出已安裝的套件

## 環境設定
需要在 `.env` 檔案中設定：
- `LINE_CHANNEL_ACCESS_TOKEN`
- `LINE_CHANNEL_SECRET`
- `NOTION_TOKEN`
- `NOTION_DATABASE_ID`
- `GEMINI_API_KEY`