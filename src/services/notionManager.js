const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function saveToNotion(data) {
  try {
    // 先獲取資料庫結構
    const database = await notion.databases.retrieve({ database_id: databaseId });
    console.log('Database properties:', Object.keys(database.properties));
    
    // 準備頁面屬性
    const properties = {};
    
    // 尋找標題欄位 - 嘗試多種可能的名稱
    const titleFieldNames = ['Name', 'Title', '標題', '名稱', 'name', 'title'];
    let titleFieldName = null;
    
    for (const fieldName of titleFieldNames) {
      if (database.properties[fieldName] && database.properties[fieldName].type === 'title') {
        titleFieldName = fieldName;
        break;
      }
    }
    
    // 如果找不到，使用第一個title類型的欄位
    if (!titleFieldName) {
      for (const [fieldName, property] of Object.entries(database.properties)) {
        if (property.type === 'title') {
          titleFieldName = fieldName;
          break;
        }
      }
    }
    
    // 設置標題
    if (titleFieldName && data.title) {
      properties[titleFieldName] = {
        title: [
          {
            text: {
              content: data.title,
            },
          },
        ],
      };
    }
    
    // 設置其他欄位 - 只有在資料庫中存在時才添加
    if (database.properties['Category']) {
      if (database.properties['Category'].type === 'multi_select' && data.category) {
        properties['Category'] = {
          multi_select: [{ name: data.category }]
        };
      } else if (database.properties['Category'].type === 'select' && data.category) {
        properties['Category'] = {
          select: { name: data.category }
        };
      }
    }
    
    if (database.properties['Content'] && data.content) {
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
    
    if (database.properties['URL'] && data.url) {
      if (database.properties['URL'].type === 'url') {
        properties['URL'] = {
          url: data.url,
        };
      } else if (database.properties['URL'].type === 'rich_text') {
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
    }
    
    // API Key欄位
    if (database.properties['API Key'] && data.apiKey) {
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
    
    // Document Info欄位
    if (database.properties['Document Info'] && data.documentInfo) {
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

    console.log('Creating page with properties:', Object.keys(properties));
    
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties,
    });
    
    return response.url;
  } catch (error) {
    console.error('Error saving to Notion:', error.body || error);
    
    // 如果還是失敗，嘗試最小化的儲存
    try {
      console.log('Trying minimal save - getting database structure...');
      const database = await notion.databases.retrieve({ database_id: databaseId });
      
      // 找到任何title欄位
      let titleField = null;
      for (const [fieldName, property] of Object.entries(database.properties)) {
        if (property.type === 'title') {
          titleField = fieldName;
          break;
        }
      }
      
      if (!titleField) {
        throw new Error('No title field found in database');
      }
      
      const minimalProperties = {
        [titleField]: {
          title: [
            {
              text: {
                content: data.title || data.content?.substring(0, 100) || data.url || 'Untitled',
              },
            },
          ],
        }
      };
      
      console.log(`Using title field: ${titleField}`);
      
      const fallbackResponse = await notion.pages.create({
        parent: { database_id: databaseId },
        properties: minimalProperties,
      });
      
      return fallbackResponse.url;
    } catch (fallbackError) {
      console.error('Fallback save also failed:', fallbackError.body || fallbackError);
      throw error;
    }
  }
}

module.exports = {
  saveToNotion,
};
