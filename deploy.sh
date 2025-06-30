#!/bin/bash

echo "🚀 開始部署到 Render..."

# 檢查是否有未提交的變更
if ! git diff --quiet; then
    echo "❌ 有未提交的變更，請先提交"
    exit 1
fi

# 檢查是否有未推送的 commit
if [ $(git rev-list --count origin/main..HEAD) -gt 0 ]; then
    echo "📤 發現 $(git rev-list --count origin/main..HEAD) 個未推送的 commit"
    echo "📋 未推送的 commit："
    git log --oneline origin/main..HEAD
    
    echo ""
    echo "🔑 請輸入你的 GitHub 認證資訊來推送："
    echo "   用戶名: Davis1233798"
    echo "   密碼: 請使用 Personal Access Token"
    echo ""
    echo "如果沒有 Personal Access Token，請到："
    echo "https://github.com/settings/tokens"
    echo ""
    
    # 嘗試推送
    git push origin main
    
    if [ $? -eq 0 ]; then
        echo "✅ 成功推送到 GitHub!"
        echo "🚀 Render 將自動開始部署..."
        echo "📱 請稍後測試 Line Bot 新功能"
    else
        echo "❌ 推送失敗，請檢查認證資訊"
        echo ""
        echo "💡 替代方案："
        echo "1. 使用 GitHub Desktop 推送"
        echo "2. 在 GitHub 網站上手動合併"
        echo "3. 設定 SSH 金鑰"
    fi
else
    echo "✅ 沒有需要推送的變更"
fi 