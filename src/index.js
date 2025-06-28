require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const llmParser = require('./services/llmParser');
const notionManager = require('./services/notionManager');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.Client(config);
const app = express();

// Middleware to parse JSON body
app.use(express.json());

// 健康檢查路由 - 解決502錯誤
app.get('/', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Line Notion Bot is running' });
});

// 健康檢查路由
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

// Line Webhook endpoint - 立即回應200，非同步處理訊息
app.post('/webhook', line.middleware(config), async (req, res) => {
  try {
    // 立即回應200給Line平台
    res.status(200).json({ status: 'received' });
    
    // 非同步處理所有事件
    if (req.body.events && req.body.events.length > 0) {
      req.body.events.forEach(event => {
        handleEvent(event).catch(err => {
          console.error('Error handling event:', err);
        });
      });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ status: 'error handled' }); // 仍然回應200
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
});