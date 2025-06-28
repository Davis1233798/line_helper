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

// Line Webhook endpoint
app.post('/webhook', line.middleware(config), async (req, res) => {
  Promise.all(req.body.events.map(handleEvent))
    .then((result) => res.json(result))
    .catch((err) => {
      console.error(err);
      res.status(500).end();
    });
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
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '處理您的訊息時發生錯誤，請稍後再試。',
    });
  }
}

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});