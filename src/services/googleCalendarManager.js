const { google } = require('googleapis');
const path = require('path');

// 要操作的日曆ID
const CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID;

// 設定認證
let auth;
if (process.env.GOOGLE_CREDENTIALS_JSON) {
  // 生產環境：從環境變數讀取憑證
  try {
    // 解決從環境變數讀取時，換行符被轉義成 \\n 的問題
    // 同時移除可能由複製貼上產生的非法控制字元
    let credentialsString = process.env.GOOGLE_CREDENTIALS_JSON;
    credentialsString = credentialsString.replace(/\\n/g, '\n');
    credentialsString = credentialsString.replace(/[\x00-\x1F\x7F]/g, (match) => {
      // 保留 private_key 中的 \n
      if (match === '\n') return '\n';
      return '';
    });
    
    const credentials = JSON.parse(credentialsString);
    auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });
  } catch (e) {
    console.error('解析 GOOGLE_CREDENTIALS_JSON 環境變數失敗:', e);
    // 可選：設定一個無效的auth，讓後續操作優雅地失敗
    auth = null;
  }
} else {
  // 開發環境：從本地檔案讀取憑證
  const KEYFILEPATH = path.join(__dirname, '../../google-credentials.json');
  auth = new google.auth.GoogleAuth({
    keyFile: KEYFILEPATH,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });
}

const calendar = google.calendar({ version: 'v3', auth });

/**
 * 直接新增事件到 Google Calendar
 * @param {object} event - 包含事件資訊的物件 { title, description, date }
 * @returns {Promise<object>} - 包含成功資訊和事件連結
 */
async function addEventToCalendar(event) {
  if (!auth || !CALENDAR_ID) {
    console.warn('未設定 GOOGLE_CALENDAR_ID 或認證失敗，跳過自動新增事件');
    return { success: false, message: '未設定 GOOGLE_CALENDAR_ID 或認證失敗' };
  }
  
  try {
    const eventStartTime = new Date(event.date);
    // 預設事件長度為1小時
    const eventEndTime = new Date(eventStartTime.getTime() + 60 * 60 * 1000);

    const calendarEvent = {
      summary: event.title,
      description: event.description,
      start: {
        dateTime: eventStartTime.toISOString(),
        timeZone: 'Asia/Taipei',
      },
      end: {
        dateTime: eventEndTime.toISOString(),
        timeZone: 'Asia/Taipei',
      },
    };

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      resource: calendarEvent,
    });
    
    console.log('成功新增事件到 Google Calendar:', response.data.summary);
    return {
      success: true,
      message: '已自動新增至 Google Calendar',
      url: response.data.htmlLink,
    };
  } catch (error) {
    console.error('新增事件到 Google Calendar 失敗:', error.message);
    if (error.message.includes('file')) {
      return { success: false, message: 'Google服務帳號金鑰檔案未找到或設定錯誤。' };
    }
    return { success: false, message: `新增至 Google Calendar 失敗: ${error.message}` };
  }
}

module.exports = {
  addEventToCalendar,
}; 