require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const llmParser = require('./services/llmParser');
const notionManager = require('./services/notionManager');
const googleCalendarManager = require('./services/googleCalendarManager');
const { shortenUrl } = require('./services/urlShortener');
const http = require('http'); // 用於健康檢查
const { exec } = require('child_process'); // 用於網路偵測
const os = require('os');

// 檢查必要的環境變數
const requiredEnvVars = [
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
  'GEMINI_API_KEY',
  'NOTION_API_TOKEN',
  'NOTION_DATABASE_ID',
  'BASE_URL'
];

// 檢查可選的環境變數
const optionalEnvVars = ['GOOGLE_CALENDAR_ID', 'GOOGLE_CREDENTIALS_JSON'];
const missingOptionalVars = optionalEnvVars.filter(varName => !process.env[varName]);
if (missingOptionalVars.length > 0) {
  console.warn('Missing optional environment variables:', missingOptionalVars);
  console.warn('Some features may not work properly');
}

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

// Apple 日曆 ICS 檔案下載端點
app.get('/download-ics/:eventId', (req, res) => {
  try {
    const { eventId } = req.params;
    const { title, description, date } = req.query;
    
    if (!title || !date) {
      return res.status(400).json({ error: '缺少必要參數' });
    }
    
    const event = {
      title: decodeURIComponent(title),
      description: decodeURIComponent(description || ''),
      date: new Date(date)
    };
    
    // 生成 ICS 內容
    const uid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@linenotionbot.com`;
    const startTime = event.date.toISOString().replace(/-|:|\.\d{3}/g, '');
    const endTime = new Date(event.date.getTime() + 60 * 60 * 1000).toISOString().replace(/-|:|\.\d{3}/g, '');
    const now = new Date().toISOString().replace(/-|:|\.\d{3}/g, '');
    
    const cleanText = (text) => {
      return text.replace(/[,;\\]/g, '\\$&').replace(/\n/g, '\\n');
    };
    
    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Line Notion Bot//Event Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `DTSTART:${startTime}`,
      `DTEND:${endTime}`,
      `DTSTAMP:${now}`,
      `UID:${uid}`,
      `CREATED:${now}`,
      `LAST-MODIFIED:${now}`,
      `SUMMARY:${cleanText(event.title)}`,
      `DESCRIPTION:${cleanText(event.description)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');
    
    const filename = `${event.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.ics`;
    
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(icsContent);
    
  } catch (error) {
    console.error('生成 ICS 檔案時發生錯誤:', error);
    res.status(500).json({ error: '生成日曆檔案失敗' });
  }
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

// 處理日曆列表查詢
async function handleCalendarListQuery(event) {
  try {
    console.log('📅 用戶請求查詢 Google Calendar 列表');
    
    const calendars = await googleCalendarManager.listCalendars();
    
    if (calendars.length === 0) {
      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: '❌ 無法取得日曆列表，請確認：\n1. Google Calendar API 憑證是否正確設定\n2. 服務帳號是否有存取權限\n3. GOOGLE_CREDENTIALS_JSON 環境變數是否設定正確',
      });
    }

    let replyMessage = '📅 您的 Google Calendar 列表：\n\n';
    
    calendars.forEach((cal, index) => {
      replyMessage += `${index + 1}. ${cal.name}\n`;
      replyMessage += `   📧 ID: ${cal.id}\n`;
      if (cal.primary) {
        replyMessage += `   ⭐ 主要日曆\n`;
      }
      if (cal.description) {
        replyMessage += `   📝 ${cal.description}\n`;
      }
      replyMessage += `   🔑 權限: ${cal.accessRole}\n\n`;
    });

    replyMessage += '💡 使用方式：\n';
    replyMessage += '1. 複製您想要的日曆 ID\n';
    replyMessage += '2. 在 Render 環境變數中設定 GOOGLE_CALENDAR_ID\n';
    replyMessage += '3. 重新部署應用程式即可自動新增事件至該日曆';

    // 檢查訊息長度
    if (replyMessage.length > 5000) {
      replyMessage = replyMessage.substring(0, 4950) + '\n...（列表過長，部分內容已省略）';
    }

    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: replyMessage,
    });

  } catch (error) {
    console.error('處理日曆列表查詢時發生錯誤：', error);
    return client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ 查詢日曆列表時發生錯誤，請稍後再試。\n\n如果問題持續發生，請檢查 Google Calendar API 設定。',
    });
  }
}

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

    // 處理日曆管理指令
    if (userMessage.includes('日曆') && (userMessage.includes('列表') || userMessage.includes('清單') || userMessage.includes('ID'))) {
      await handleCalendarListQuery(event);
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

    // 修正：parsedInfo 是陣列，需要取第一個元素
    const firstItem = Array.isArray(parsedInfo) ? parsedInfo[0] : parsedInfo;
    console.log('🔍 準備儲存到 Notion 的資料:', JSON.stringify(firstItem, null, 2));
    
    // 縮短 URL（如果需要）
    if (firstItem.url && firstItem.url.length > 100) {
      console.log('🔗 URL 過長，開始縮短...');
      const shortUrl = await shortenUrl(firstItem.url);
      if (shortUrl !== firstItem.url) {
        console.log(`✅ URL 縮短成功: ${firstItem.url.substring(0, 50)}... -> ${shortUrl}`);
        firstItem.url = shortUrl;
      } else {
        console.log('⚠️  URL 縮短失敗，使用原始 URL');
      }
    }
    
    let notionResult = await notionManager.saveToNotion(firstItem);

    // 如果 Notion 儲存失敗，嘗試降級處理
    if (!notionResult.success && firstItem) {
      console.log('🔄 Notion 儲存失敗，嘗試降級處理...');
      
      // 嘗試簡化資料格式重新儲存
      let simplifiedUrl = firstItem.url;
      if (simplifiedUrl && simplifiedUrl.length > 100) {
        console.log('🔗 降級處理中縮短 URL...');
        simplifiedUrl = await shortenUrl(simplifiedUrl);
      }
      
      const simplifiedData = {
        title: firstItem.title || firstItem.url || '未知標題',
        category: firstItem.category || '其他',
        info: firstItem.info || '自動分析的內容',
        url: simplifiedUrl
      };
      
      console.log('📝 使用簡化資料重新嘗試:', JSON.stringify(simplifiedData, null, 2));
      notionResult = await notionManager.saveToNotion(simplifiedData);
      
      if (!notionResult.success) {
        console.log('⚠️  降級處理也失敗，但仍處理日曆功能');
        // 即使 Notion 失敗，仍然處理日曆功能
        notionResult = {
          success: false,
          title: simplifiedData.title,
          url: null,
          error: '儲存失敗但已處理日曆功能'
        };
      }
    }

    if (notionResult.success) {
      let replyMessage = `✅ 已成功儲存：${notionResult.title}\n${notionResult.url}`;

      // 調試輸出：檢查 parsedInfo 結構
      console.log('🔍 調試 - parsedInfo 結構:', JSON.stringify(parsedInfo, null, 2));
      const firstItem = Array.isArray(parsedInfo) ? parsedInfo[0] : parsedInfo;
      console.log('🔍 調試 - firstItem.events:', firstItem.events);
      console.log('🔍 調試 - events 長度:', firstItem.events ? firstItem.events.length : 'undefined');

      // 【增強】處理日曆事件並產生連結 - 支援多種事件類型
      if (firstItem.events && firstItem.events.length > 0) {
        console.log('📅 開始處理日曆事件...');
        replyMessage += '\n\n📅 發現重要日期：';

        // 批次新增到 Google Calendar
        const googleBatchResults = await googleCalendarManager.addMultipleEvents(firstItem.events);

        for (const [index, calEvent] of firstItem.events.entries()) {
          const eventTypeEmoji = {
            'deadline': '⏰',
            'registration': '📝',
            'start': '🚀',
            'end': '🏁',
            'participation': '🎯',
            'meeting': '👥',
            'reminder': '🔔',
            'event': '📅'
          };

          const emoji = eventTypeEmoji[calEvent.type] || '📅';
          const googleResult = googleBatchResults[index];
          
          replyMessage += `\n\n${index + 1}. ${emoji} [${googleResult?.category || calEvent.type}] ${calEvent.title}`;
          replyMessage += `\n   📅 ${calEvent.date.toLocaleString('zh-TW')}`;
          
          if (calEvent.description && calEvent.description !== calEvent.title) {
            replyMessage += `\n   📝 ${calEvent.description.substring(0, 50)}${calEvent.description.length > 50 ? '...' : ''}`;
          }

          // Google Calendar 結果
          if (googleResult?.success) {
            replyMessage += `\n   ✅ 已自動新增至 Google 日曆`;
            if (googleResult.url) {
              const shortGoogleUrl = await shortenUrl(googleResult.url);
              replyMessage += `\n   🔗 查看: ${shortGoogleUrl}`;
            }
          } else {
            // 自動新增失敗，提供手動連結
            replyMessage += `\n   ⚠️  Google 日曆: ${googleResult?.message || '新增失敗'}`;
            const googleLink = llmParser.generateGoogleCalendarLink(calEvent);
            const shortGoogleLink = await shortenUrl(googleLink);
            replyMessage += `\n   🔗 手動新增: ${shortGoogleLink}`;
          }

          // 產生 Apple 日曆下載連結
          const eventId = `${Date.now()}-${index}`;
          const downloadUrl = `${process.env.BASE_URL || 'https://line-helper.onrender.com'}/download-ics/${eventId}?title=${encodeURIComponent(calEvent.title)}&description=${encodeURIComponent(calEvent.description)}&date=${calEvent.date.toISOString()}`;
          const shortDownloadUrl = await shortenUrl(downloadUrl);
          replyMessage += `\n   🍎 Apple 日曆: ${shortDownloadUrl}`;
        }

        // 顯示批次處理統計
        const successCount = googleBatchResults.filter(r => r.success).length;
        if (firstItem.events.length > 1) {
          replyMessage += `\n\n📊 批次處理結果: ${successCount}/${firstItem.events.length} 個事件成功新增至 Google 日曆`;
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
      
      // 即使 Notion 失敗，仍然處理日曆功能
      let replyMessage = `⚠️ 儲存到 Notion 失敗，但已處理其他功能\n錯誤：${notionResult.error}`;

      // 處理日曆事件（即使 Notion 失敗）
      if (firstItem && firstItem.events && firstItem.events.length > 0) {
        replyMessage += '\n\n📅 發現重要日期：';

        // 批次新增到 Google Calendar
        const googleBatchResults = await googleCalendarManager.addMultipleEvents(firstItem.events);

        for (const [index, calEvent] of firstItem.events.entries()) {
          const eventTypeEmoji = {
            'deadline': '⏰',
            'registration': '📝',
            'start': '🚀',
            'end': '🏁',
            'participation': '🎯',
            'meeting': '👥',
            'reminder': '🔔',
            'event': '📅'
          };

          const emoji = eventTypeEmoji[calEvent.type] || '📅';
          const googleResult = googleBatchResults[index];
          
          replyMessage += `\n\n${index + 1}. ${emoji} [${googleResult?.category || calEvent.type}] ${calEvent.title}`;
          replyMessage += `\n   📅 ${calEvent.date.toLocaleString('zh-TW')}`;

          // Google Calendar 結果
          if (googleResult?.success) {
            replyMessage += `\n   ✅ 已新增至 Google 日曆`;
            if (googleResult.url) {
              replyMessage += `\n   🔗 ${googleResult.url}`;
            }
          } else {
            const googleLink = llmParser.generateGoogleCalendarLink(calEvent);
            replyMessage += `\n   🔗 手動新增: ${googleLink}`;
          }

          // Apple 日曆下載連結
          const eventId = `${Date.now()}-${index}`;
          const downloadUrl = `${process.env.BASE_URL || 'https://line-helper.onrender.com'}/download-ics/${eventId}?title=${encodeURIComponent(calEvent.title)}&description=${encodeURIComponent(calEvent.description)}&date=${calEvent.date.toISOString()}`;
          replyMessage += `\n   🍎 Apple 日曆: ${downloadUrl}`;
        }
      }

      return client.replyMessage(event.replyToken, {
        type: 'text',
        text: replyMessage,
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

// 網路連線偵測 - 改進版，優先使用 curl（適合 Docker 環境）
function checkInternetConnection() {
  // 優先使用 curl，因為在 Docker 環境中更可靠
  exec('curl -I https://www.google.com --connect-timeout 10 --max-time 15', (curlError, curlStdout, curlStderr) => {
    if (curlError) {
      console.warn(`⚠️  網路偵測 (curl) 失敗: ${curlError.message}`);
      // curl 失敗時嘗試 ping（某些環境可能有限制）
      const pingCommand = os.platform() === 'win32' ? 'ping -n 1 google.com' : 'ping -c 1 google.com';
      exec(pingCommand, (pingError, pingStdout, pingStderr) => {
        if (pingError) {
          console.warn('⚠️  網路偵測 (ping) 也失敗，這在某些 Docker 環境中是正常的');
          console.log('📡 服務仍可正常運行，僅外部連線檢測受限');
        } else {
          console.log('✅ 網路連線正常 (ping)');
        }
      });
    } else {
      if (curlStdout.includes('200') || curlStdout.includes('301') || curlStdout.includes('HTTP')) {
        console.log('✅ 網路連線正常 (curl)');
      } else {
        console.warn('⚠️  網路偵測結果異常，但服務應該仍可正常運行');
      }
    }
  });
}

const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Server is running on port ${port}`);
  const baseUrl = process.env.BASE_URL || 'https://line-helper.onrender.com';
  console.log(`Webhook URL: ${baseUrl}/webhook`);
  console.log('Environment check:', {
    hasLineToken: !!process.env.LINE_CHANNEL_ACCESS_TOKEN,
    hasLineSecret: !!process.env.LINE_CHANNEL_SECRET,
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasGeminiKey2: !!process.env.GEMINI_API_KEY_2,
    hasGeminiKey3: !!process.env.GEMINI_API_KEY_3,
    hasNotionToken: !!process.env.NOTION_API_TOKEN,
    hasNotionDb: !!process.env.NOTION_DATABASE_ID,
    hasGoogleCalId: !!process.env.GOOGLE_CALENDAR_ID,
    hasBaseUrl: !!process.env.BASE_URL
  });
  notionManager.getNotionData(); // 啟動時獲取 Notion 資料庫數據
  checkInternetConnection(); // 啟動時檢查網路連線
});

module.exports = app;