const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');

// 要操作的日曆ID
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// 設定認證
let auth;

// 優先順序：1. Render Secret Files 2. 本地開發檔案
// 嘗試多個可能的 Secret Files 路徑
const SECRET_FILE_PATHS = [
  '/etc/secrets/google-credentials.json',
  '/etc/secrets/strange-bloom-382507-11b0f2d5a164.json',
  '/opt/render/project/src/google-credentials.json'
];
const LOCAL_FILE_PATH = path.join(__dirname, '../google-credentials.json');

console.log('🔑 開始 Google Calendar 認證流程');

// 1. 優先嘗試 Render Secret Files（多個路徑）
let secretFileFound = false;
for (const secretPath of SECRET_FILE_PATHS) {
  if (fs.existsSync(secretPath)) {
    console.log('📁 使用 Render Secret File 進行認證:', secretPath);
    try {
      auth = new google.auth.GoogleAuth({
        keyFile: secretPath,
        scopes: ['https://www.googleapis.com/auth/calendar'],
      });
      console.log('✅ 使用 Render Secret File 建立 Google Auth 成功');
      secretFileFound = true;
      break;
    } catch (e) {
      console.error('❌ 使用 Render Secret File 失敗:', e.message);
      auth = null;
    }
  }
}

// 2. 備用：本地開發檔案
if (!secretFileFound && fs.existsSync(LOCAL_FILE_PATH)) {
  console.log('📁 Secret File 不存在，使用本地開發檔案:', LOCAL_FILE_PATH);
  try {
    auth = new google.auth.GoogleAuth({
      keyFile: LOCAL_FILE_PATH,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
    console.log('✅ 使用本地憑證檔案建立 Google Auth 成功');
  } catch (e) {
    console.error('❌ 使用本地憑證檔案失敗:', e.message);
    auth = null;
  }
} else if (!secretFileFound) {
  console.error('❌ 找不到任何 Google 憑證檔案');
  console.error('🔍 檢查的路徑:');
  SECRET_FILE_PATHS.forEach(path => {
    console.error(`   - Render Secret File: ${path}`);
  });
  console.error(`   - 本地開發檔案: ${LOCAL_FILE_PATH}`);
  console.error('🔧 請確認以下配置:');
  console.error('   1. 在 Render Secret Files 中上傳 google-credentials.json 檔案');
  console.error('   2. 在本地開發時放置 google-credentials.json 檔案');
  console.error('   3. 確認憑證檔案格式正確且包含所需權限');
  auth = null;
}

const calendar = google.calendar({ version: 'v3', auth });

/**
 * 列出所有可用的日曆 ID
 * @returns {Promise<Array>} - 包含所有日曆資訊的陣列
 */
async function listCalendars() {
  if (!auth) {
    console.warn('未設定認證，無法列出日曆');
    return [];
  }
  
  try {
    const res = await calendar.calendarList.list();
    const calendars = res.data.items;
    
    console.log('📅 可用的日曆：');
    calendars.forEach((cal) => {
      console.log(`  • ${cal.summary}: ${cal.id}`);
    });
    
    return calendars.map(cal => ({
      id: cal.id,
      name: cal.summary,
      description: cal.description || '',
      primary: cal.primary || false,
      accessRole: cal.accessRole
    }));
  } catch (error) {
    console.error('取得日曆清單失敗:', error);
    return [];
  }
}

/**
 * 根據事件類型決定事件顏色和分類
 * @param {string} eventType - 事件類型 (deadline, registration, start, end, etc.)
 * @returns {object} - 包含顏色和分類資訊
 */
function getEventStyle(eventType) {
  const eventStyles = {
    'deadline': { colorId: '11', category: '截止日期' }, // 紅色
    'registration': { colorId: '9', category: '報名日期' }, // 藍色
    'start': { colorId: '10', category: '開始日期' }, // 綠色
    'end': { colorId: '6', category: '結束日期' }, // 橙色
    'participation': { colorId: '5', category: '參加日期' }, // 黃色
    'reminder': { colorId: '1', category: '提醒事項' }, // 淡藍色
    'meeting': { colorId: '7', category: '會議' }, // 青色
    'event': { colorId: '2', category: '活動' }, // 淡綠色
    'default': { colorId: '1', category: '其他' }
  };
  
  return eventStyles[eventType] || eventStyles['default'];
}

/**
 * 智能判斷事件類型
 * @param {string} title - 事件標題
 * @param {string} description - 事件描述
 * @returns {string} - 事件類型
 */
function detectEventType(title, description = '') {
  const content = (title + ' ' + description).toLowerCase();
  
  // 截止日期相關關鍵字
  if (content.includes('截止') || content.includes('deadline') || content.includes('due') || 
      content.includes('最後') || content.includes('結束報名') || content.includes('申請截止')) {
    return 'deadline';
  }
  
  // 報名相關關鍵字
  if (content.includes('報名') || content.includes('註冊') || content.includes('registration') || 
      content.includes('申請') || content.includes('登記') || content.includes('報名開始')) {
    return 'registration';
  }
  
  // 開始日期相關關鍵字
  if (content.includes('開始') || content.includes('start') || content.includes('開幕') || 
      content.includes('啟動') || content.includes('上線') || content.includes('發布')) {
    return 'start';
  }
  
  // 結束日期相關關鍵字
  if (content.includes('結束') || content.includes('end') || content.includes('閉幕') || 
      content.includes('完成') || content.includes('下線')) {
    return 'end';
  }
  
  // 參加日期相關關鍵字
  if (content.includes('參加') || content.includes('出席') || content.includes('attend') || 
      content.includes('參與') || content.includes('活動日') || content.includes('舉辦')) {
    return 'participation';
  }
  
  // 會議相關關鍵字
  if (content.includes('會議') || content.includes('meeting') || content.includes('討論') || 
      content.includes('座談') || content.includes('研討')) {
    return 'meeting';
  }
  
  return 'event';
}

/**
 * 增強版新增事件到 Google Calendar
 * @param {object} event - 包含事件資訊的物件 { title, description, date, type? }
 * @param {string} calendarId - 指定的日曆ID，如果不提供則使用預設
 * @returns {Promise<object>} - 包含成功資訊和事件連結
 */
async function addEventToCalendar(event, calendarId = null) {
  if (!auth) {
    console.warn('未設定認證，跳過自動新增事件');
    return { success: false, message: '未設定認證' };
  }
  
  const targetCalendarId = calendarId || CALENDAR_ID;
  if (!targetCalendarId) {
    console.warn('未設定 GOOGLE_CALENDAR_ID，跳過自動新增事件');
    return { success: false, message: '未設定 GOOGLE_CALENDAR_ID' };
  }
  
  try {
    const eventStartTime = new Date(event.date);
    
    // 智能判斷事件類型
    const eventType = event.type || detectEventType(event.title, event.description);
    const eventStyle = getEventStyle(eventType);
    
    // 根據事件類型調整事件長度
    let eventDuration = 60; // 預設1小時
    if (eventType === 'deadline') {
      eventDuration = 15; // 截止日期只需15分鐘提醒
    } else if (eventType === 'meeting') {
      eventDuration = 90; // 會議預設1.5小時
    } else if (eventType === 'participation') {
      eventDuration = 180; // 參加活動預設3小時
    }
    
    const eventEndTime = new Date(eventStartTime.getTime() + eventDuration * 60 * 1000);

    // 增強事件描述
    const enhancedDescription = `${eventStyle.category}: ${event.description || event.title}
    
事件類型: ${eventStyle.category}
建立時間: ${new Date().toLocaleString('zh-TW')}
自動分類: ${eventType}`;

    const calendarEvent = {
      summary: `[${eventStyle.category}] ${event.title}`,
      description: enhancedDescription,
      start: {
        dateTime: eventStartTime.toISOString(),
        timeZone: 'Asia/Taipei',
      },
      end: {
        dateTime: eventEndTime.toISOString(),
        timeZone: 'Asia/Taipei',
      },
      colorId: eventStyle.colorId,
      // 根據事件類型設定提醒
      reminders: {
        useDefault: false,
        overrides: getEventReminders(eventType)
      }
    };

    const response = await calendar.events.insert({
      calendarId: targetCalendarId,
      resource: calendarEvent,
    });
    
    console.log(`✅ 成功新增${eventStyle.category}到 Google Calendar: ${event.title}`);
    return {
      success: true,
      message: `已自動新增${eventStyle.category}至 Google Calendar`,
      url: response.data.htmlLink,
      eventType: eventType,
      category: eventStyle.category
    };
  } catch (error) {
    console.error('新增事件到 Google Calendar 失敗:', error.message);
    if (error.message.includes('file')) {
      return { success: false, message: 'Google服務帳號金鑰檔案未找到或設定錯誤。' };
    }
    return { success: false, message: `新增至 Google Calendar 失敗: ${error.message}` };
  }
}

/**
 * 根據事件類型設定提醒
 * @param {string} eventType - 事件類型
 * @returns {Array} - 提醒設定陣列
 */
function getEventReminders(eventType) {
  const reminderSettings = {
    'deadline': [
      { method: 'popup', minutes: 60 * 24 }, // 1天前
      { method: 'popup', minutes: 60 * 2 },  // 2小時前
      { method: 'popup', minutes: 15 }       // 15分鐘前
    ],
    'registration': [
      { method: 'popup', minutes: 60 * 24 }, // 1天前
      { method: 'popup', minutes: 60 }       // 1小時前
    ],
    'meeting': [
      { method: 'popup', minutes: 15 },      // 15分鐘前
      { method: 'popup', minutes: 5 }        // 5分鐘前
    ],
    'participation': [
      { method: 'popup', minutes: 60 * 24 }, // 1天前
      { method: 'popup', minutes: 60 }       // 1小時前
    ],
    'default': [
      { method: 'popup', minutes: 15 }       // 15分鐘前
    ]
  };
  
  return reminderSettings[eventType] || reminderSettings['default'];
}

/**
 * 批次新增多個事件到 Google Calendar
 * @param {Array} events - 事件陣列
 * @param {string} calendarId - 指定的日曆ID
 * @returns {Promise<Array>} - 處理結果陣列
 */
async function addMultipleEvents(events, calendarId = null) {
  if (!events || events.length === 0) {
    return [];
  }
  
  console.log(`📅 開始批次新增 ${events.length} 個事件到 Google Calendar`);
  
  const results = [];
  for (const event of events) {
    try {
      const result = await addEventToCalendar(event, calendarId);
      results.push({ event: event.title, ...result });
      
      // 避免API速率限制
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`新增事件失敗: ${event.title}`, error);
      results.push({ 
        event: event.title, 
        success: false, 
        message: error.message 
      });
    }
  }
  
  const successCount = results.filter(r => r.success).length;
  console.log(`📅 批次新增完成: ${successCount}/${events.length} 個事件成功`);
  
  return results;
}

module.exports = {
  addEventToCalendar,
  addMultipleEvents,
  listCalendars,
  detectEventType,
  getEventStyle
};