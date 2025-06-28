require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const llmParser = require('./services/llmParser');
const notionManager = require('./services/notionManager');

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

async function handleEvent(event) {
  if (event.type !== 'message' || event.message.type !== 'text') {
    return Promise.resolve(null);
  }

  const userMessage = event.message.text;
  console.log(`Received message: ${userMessage}`);

  try {
    // 1. Parse message with LLM
    const parsedData = await llmParser.parseMessage(userMessage);
    console.log('Parsed data:', parsedData);

    // 2. Save to Notion
    const notionPageUrl = await notionManager.saveToNotion(parsedData);
    console.log('Notion page URL:', notionPageUrl);

    // 3. Reply to Line user
    const replyMessage = notionPageUrl 
      ? `訊息已分類並儲存到 Notion！\n${notionPageUrl}`
      : '抱歉，未能成功分類您的訊息。';

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: replyMessage,
    });
  } catch (error) {
    console.error('Error handling event:', error);
    
    // 嘗試回覆錯誤訊息給用戶
    try {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '處理您的訊息時發生錯誤，請稍後再試。',
      });
    } catch (replyError) {
      console.error('Error sending reply:', replyError);
    }
  }
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
});