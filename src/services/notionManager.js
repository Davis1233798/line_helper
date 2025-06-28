const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function saveToNotion(data) {
  try {
    // 準備頁面屬性，只包含存在的欄位
    const properties = {};
    
    // 嘗試設置標題欄位 (通常是 Name 或 Title)
    if (data.title) {
      // 首先嘗試 Name (Notion預設)
      properties['Name'] = {
        title: [
          {
            text: {
              content: data.title,
            },
          },
        ],
      };
    }
    
    // 嘗試設置分類 (根據錯誤訊息，這應該是multi_select)
    if (data.category) {
      properties['Category'] = {
        multi_select: [
          {
            name: data.category,
          }
        ],
      };
    }
    
    // 設置內容
    if (data.content) {
      properties['Content'] = {
        rich_text: [
          {
            text: {
              content: data.content,
            },
          },
        ],
      };
    }
    
    // 設置URL (根據錯誤訊息，這應該是rich_text)
    if (data.url) {
      properties['URL'] = {
        rich_text: [
          {
            text: {
              content: data.url,
            },
          },
        ],
      };
    }
    
    // 只有在有API Key時才添加 (如果資料庫有這個欄位)
    if (data.apiKey) {
      properties['API Key'] = {
        rich_text: [
          {
            text: {
              content: data.apiKey,
            },
          },
        ],
      };
    }
    
    // 只有在有文檔資訊時才添加 (如果資料庫有這個欄位)
    if (data.documentInfo) {
      properties['Document Info'] = {
        rich_text: [
          {
            text: {
              content: data.documentInfo,
            },
          },
        ],
      };
    }

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties,
    });
    
    return response.url;
  } catch (error) {
    console.error('Error saving to Notion:', error.body || error);
    
    // 如果失敗，嘗試只用最基本的欄位重新儲存
    try {
      console.log('Attempting to save with minimal properties...');
      const minimalProperties = {
        'Name': {
          title: [
            {
              text: {
                content: data.title || data.content?.substring(0, 100) || 'Untitled',
              },
            },
          ],
        }
      };
      
      // 如果有內容，添加到rich_text欄位
      if (data.content) {
        minimalProperties['Content'] = {
          rich_text: [
            {
              text: {
                content: data.content,
              },
            },
          ],
        };
      }
      
      const fallbackResponse = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: minimalProperties,
      });
      
      return fallbackResponse.url;
    } catch (fallbackError) {
      console.error('Fallback save also failed:', fallbackError.body || fallbackError);
      throw error; // 拋出原始錯誤
    }
  }
}

module.exports = {
  saveToNotion,
};
