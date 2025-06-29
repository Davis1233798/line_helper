require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const llmParser = require('./services/llmParser');
const notionManager = require('./services/notionManager');
const googleCalendarManager = require('./services/googleCalendarManager');
const http = require('http'); // 用於健康檢查
const { exec } = require('child_process'); // 用於網路偵測
const os = require('os');

// 檢查必要的環境變數
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'GEMINI_API_KEY',
  'NOTION_API_TOKEN',
  'NOTION_DATABASE_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars);
  console.error('Please check your environment variables in Render dashboard');
  process.exit(1);
}

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// 中間件設定 - 必須在路由之前
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 健康檢查路由 - 解決502錯誤
app.get('/', (req, res) => {
  res.status(200).json({ 
    status: 'OK', 
    message: 'Line Notion Bot is running',
    timestamp: new Date().toISOString()
  });
});

// 健康檢查路由
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy',
    environment: {
      hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
      hasLineSecret: !!process.env.LINE_CHANNEL_SECRET,
      hasGeminiKey: !!process.env.GEMINI_API_KEY,
      hasNotionToken: !!process.env.NOTION_API_TOKEN,
      hasNotionDb: !!process.env.NOTION_DATABASE_ID
    }
  });
});

// Line Webhook endpoint - 立即回應200，非同步處理訊息
app.post('/webhook', (req, res) => {
  // 先立即回應200
  res.status(200).json({ status: 'received' });
  
  // 手動驗證簽名
  try {
    const signature = req.get('X-Line-Signature');
    if (!signature) {
      console.error('No signature found in request');
      return;
    }
    
    // 使用Line SDK的驗證函數
    const body = JSON.stringify(req.body);
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('SHA256', config.channelSecret)
      .update(body)
      .digest('base64');
    
    if (hash !== signature) {
      console.error('Signature validation failed');
      console.error('Expected:', hash);
      console.error('Received:', signature);
      return;
    }
    
    // 處理事件
    if (req.body.events && req.body.events.length > 0) {
      req.body.events.forEach(event => {
        handleEvent(event).catch(err => {
          console.error('Error handling event:', err);
        });
      });
    }
  } catch (error) {
    console.error('Webhook processing error:', error);
  }
});

// 備用的webhook endpoint，如果簽名驗證有問題
app.post('/webhook-raw', express.raw({type: 'application/json'}), (req, res) => {
  try {
    // 立即回應200
    res.status(200).json({ status: 'received' });
    
    const signature = req.get('X-Line-Signature');
    const body = req.body;
    
    // 手動簽名驗證
    const crypto = require('crypto');
    const hash = crypto
      .createHmac('SHA256', config.channelSecret)
      .update(body)
      .digest('base64');
    
    if (hash !== signature) {
      console.error('Raw webhook signature validation failed');
      return;
    }
    
    const events = JSON.parse(body.toString()).events;
    if (events && events.length > 0) {
      events.forEach(event => {
        handleEvent(event).catch(err => {
          console.error('Error handling event:', err);
        });
      });
    }
  } catch (error) {
    console.error('Raw webhook error:', error);
  }
});

// 處理搜尋查詢
async function handleSearchQuery(event, userMessage) {
  try {
    // 解析搜尋查詢
    const searchParams = parseSearchQuery(userMessage);
    console.log('搜尋參數：', searchParams);
    
    // 執行搜尋
    const searchResult = await notionManager.searchNotion(searchParams.keyword, searchParams.category);
    console.log('搜尋結果：', searchResult);
    
    if (!searchResult.success) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `搜尋時發生錯誤：${searchResult.error}`,
      });
    }
    
    if (searchResult.count === 0) {
      let replyText = '沒有找到符合條件的結果。';
      if (searchParams.category && searchParams.keyword) {
        replyText = `沒有找到類別「${searchParams.category}」且包含「${searchParams.keyword}」的結果。`;
      } else if (searchParams.category) {
        replyText = `沒有找到類別「${searchParams.category}」的結果。`;
      } else if (searchParams.keyword) {
        replyText = `沒有找到包含「${searchParams.keyword}」的結果。`;
      }
      
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: replyText,
      });
    }
    
    // 格式化搜尋結果
    let replyMessage = `🔍 找到 ${searchResult.count} 個結果：\n\n`;
    
    searchResult.results.forEach((item, index) => {
      // 組合分類標籤顯示
      let categoryDisplay = item.category;
      if (item.category && item.category.includes(', ')) {
        // 如果 category 本身就包含多個標籤（用逗號分隔）
        categoryDisplay = item.category;
      }
      
      replyMessage += `${index + 1}. 【${categoryDisplay}】${item.title}\n`;
      if (item.info) {
        replyMessage += `📝 ${item.info}\n`;
      }
      if (item.url) {
        replyMessage += `🔗 ${item.url}\n`;
      }
      replyMessage += `📄 ${item.notionUrl}\n\n`;
    });
    
    // 如果訊息太長，進行截斷
    if (replyMessage.length > 4500) {
      const truncatedResults = searchResult.results.slice(0, 3);
      replyMessage = `🔍 找到 ${searchResult.count} 個結果，顯示前3個：\n\n`;
      
      truncatedResults.forEach((item, index) => {
        // 組合分類標籤顯示
        let categoryDisplay = item.category;
        if (item.category && item.category.includes(', ')) {
          // 如果 category 本身就包含多個標籤（用逗號分隔）
          categoryDisplay = item.category;
        }
        
        replyMessage += `${index + 1}. 【${categoryDisplay}】${item.title}\n`;
        if (item.info) {
          replyMessage += `📝 ${item.info.substring(0, 100)}${item.info.length > 100 ? '...' : ''}\n`;
        }
        if (item.url) {
          replyMessage += `🔗 ${item.url}\n`;
        }
        replyMessage += `📄 ${item.notionUrl}\n\n`;
      });
      
      if (searchResult.count > 3) {
        replyMessage += `還有 ${searchResult.count - 3} 個結果，請使用更具體的關鍵字搜尋。`;
      }
    }
    
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: replyMessage,
    });
    
  } catch (error) {
    console.error('處理搜尋查詢時發生錯誤：', error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '搜尋時發生錯誤，請稍後再試。',
    });
  }
}

// 解析搜尋查詢
function parseSearchQuery(message) {
  let keyword = '';
  let category = null;
  
  // 移除查詢關鍵詞
  let cleanMessage = message
    .replace(/查詢|搜尋|找|查找|查|search/g, '')
    .trim();
  
  // 檢測類別
  for (const cat of llmParser.VALID_CATEGORIES) {
    if (cleanMessage.includes(cat)) {
      category = cat;
      cleanMessage = cleanMessage.replace(cat, '').trim();
      break;
    }
  }
  
  // 剩餘的文字作為關鍵字
  if (cleanMessage.length > 0) {
    // 移除常見的連接詞
    keyword = cleanMessage
      .replace(/的|中|和|或|與|有關|關於|相關/g, '')
      .trim();
  }
  
  return {
    keyword: keyword || null,
    category: category,
    originalMessage: message
  };
}

async function handleEvent(event) {
  try {
    if (event.type !== 'message' || event.message.type !== 'text') {
      return;
    }

    const userMessage = event.message.text;

    // 關鍵字判斷是否為搜尋
    const isSearch = /查詢|搜尋|找|查找|查|search/.test(userMessage.substring(0, 10));

    if (isSearch) {
      await handleSearchQuery(event, userMessage);
      return;
    }

    // 如果不是搜尋查詢，繼續進行解析和儲存
    const parsedInfo = await llmParser.parseMessage(userMessage);

    // 防禦性程式碼：確保 parsedInfo 存在
    if (!parsedInfo) {
      console.log("解析結果為空，不進行任何操作。");
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '無法處理您的訊息，請確認內容或網址是否正確。',
      });
    }

    const notionResult = await notionManager.saveToNotion(parsedInfo);

    if (notionResult.success) {
      let replyMessage = `✅ 已成功儲存：${notionResult.title}\n${notionResult.url}`;

      // 處理日曆事件並產生連結
      if (parsedInfo.events && parsedInfo.events.length > 0) {
        replyMessage += '\n\n📅 發現重要日期：';

        for (const [index, calEvent] of parsedInfo.events.entries()) {
          replyMessage += `\n\n${index + 1}. ${calEvent.title} - ${calEvent.description}`;

          // 嘗試自動新增到 Google Calendar
          const googleCalResult = await googleCalendarManager.addEventToCalendar(calEvent);

          if (googleCalResult.success) {
            replyMessage += `\n✅ 已自動新增至Google日曆: ${googleCalResult.eventLink}`;
          } else {
            // 自動新增失敗，提供手動連結
            replyMessage += `\n❌ ${googleCalResult.error}`;
            const googleLink = llmParser.generateGoogleCalendarLink(calEvent);
            const appleLink = await llmParser.generateAppleCalendarLink(calEvent); // This one is async
            replyMessage += `\n🔗 手動新增Google日曆: ${googleLink}`;
            replyMessage += `\n🍎 手動下載Apple日曆: ${appleLink}`;
          }
        }
      }

      // 檢查訊息長度
      if (replyMessage.length > 5000) {
        replyMessage = replyMessage.substring(0, 4950) + '\n...（訊息過長，部分內容已省略）';
      }

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: replyMessage,
      });
    } else {
      console.error('儲存到 Notion 失敗:', notionResult.error);
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: `儲存到 Notion 失敗：${notionResult.error}`,
      });
    }
  } catch (error) {
    console.error('處理事件時發生錯誤：', error);
    // 避免洩漏詳細錯誤給使用者
    const userFacingError = error.message.includes('URL') ? '處理的網址似乎無效，請檢查。' : '處理您的請求時發生未預期的錯誤，請稍後再試。';
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: userFacingError,
    });
  }
}

// 網路連線偵測
function checkInternetConnection() {
  const pingCommand = os.platform() === 'win32' ? 'ping -n 1 google.com' : 'ping -c 1 google.com';
  
  exec(pingCommand, (error, stdout, stderr) => {
    if (error) {
      console.error(`網路偵測失敗 (ping): ${error.message}`);
      // 在ping失敗時嘗試curl，因為某些環境可能禁用ICMP但允許HTTP
      exec('curl -s --head https://www.google.com', (curlError, curlStdout, curlStderr) => {
        if (curlError) {
          console.error(`網路偵測失敗 (curl): ${curlError.message}`);
          console.warn('警告: 伺服器可能無法連線到外部網路，這會影響Google Calendar API和Apple日曆連結生成。');
        } else if (curlStdout && (curlStdout.includes('200 OK') || curlStdout.includes('301 Moved Permanently'))) {
          console.log('網路偵測成功 (curl)，連線正常。');
        } else {
          console.warn('警告: 網路偵測 (curl) 結果異常，外部連線可能受限。');
        }
      });
      return;
    }
    console.log('網路偵測成功 (ping)，連線正常。');
  });
}

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
  console.log(`Webhook URL: https://your-render-url.com/webhook`);
  console.log('Environment check:', {
    hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    hasLineSecret: !!process.env.LINE_CHANNEL_SECRET,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasNotionToken: !!process.env.NOTION_API_TOKEN,
    hasNotionDb: !!process.env.NOTION_DATABASE_ID
  });
  notionManager.getNotionData(); // 啟動時獲取 Notion 資料庫數據
  checkInternetConnection(); // 啟動時檢查網路連線
});

module.exports = app;