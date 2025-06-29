const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

// 檢查URL是否已存在於資料庫中
async function checkUrlExists(url) {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'URL',
        url: {
          equals: url
        }
      }
    });
    
    return response.results.length > 0;
  } catch (error) {
    console.error('Error checking URL existence:', error);
    return false;
  }
}

// 批量保存多個記錄到Notion
async function saveBatchToNotion(dataArray) {
  const results = [];
  
  for (const data of dataArray) {
    try {
      // 如果有URL，先檢查是否已存在
      if (data.url) {
        const exists = await checkUrlExists(data.url);
        if (exists) {
          console.log(`網址已存在，跳過：${data.url}`);
          results.push({
            success: false,
            url: null,
            message: `連結已存在：${data.title}`,
            title: data.title
          });
          continue;
        }
      }
      
      // 儲存新記錄
      const pageUrl = await saveToNotion(data);
      results.push({
        success: true,
        url: pageUrl,
        message: `已成功儲存：${data.title}`,
        title: data.title
      });
    } catch (error) {
      console.error(`儲存記錄時發生錯誤：${data.title}`, error);
      results.push({
        success: false,
        url: null,
        message: `儲存失敗：${data.title}`,
        title: data.title
      });
    }
  }
  
  return results;
}

async function saveToNotion(data) {
  try {
    // 先獲取資料庫結構
    const database = await notion.databases.retrieve({ database_id: databaseId });
    console.log('Database properties:', Object.keys(database.properties));
    
    // 準備頁面屬性
    const properties = {};
    
    // 尋找標題欄位 - 嘗試多種可能的名稱
    const titleFieldNames = ['Name', 'Title', '標題', '名稱', 'name', 'title', 'ttitle'];
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
    
    // Content欄位 - 保持原始訊息內容
    if (database.properties['Content'] && data.content) {
      properties['Content'] = {
        rich_text: [
          {
            text: {
              content: data.content.length > 2000 ? data.content.substring(0, 2000) + '...' : data.content,
            },
          },
        ],
      };
    }
    
    // Info欄位 - 功能介紹
    if (database.properties['Info'] && data.info) {
      properties['Info'] = {
        rich_text: [
          {
            text: {
              content: data.info,
            },
          },
        ],
      };
    }
    
    // 如果沒有Info欄位，檢查其他可能的欄位名稱
    if (!database.properties['Info'] && data.info) {
      const infoFieldNames = ['功能介紹', 'Description', 'DESCRIPTION', '描述', 'info'];
      for (const fieldName of infoFieldNames) {
        if (database.properties[fieldName]) {
          properties[fieldName] = {
            rich_text: [
              {
                text: {
                  content: data.info,
                },
              },
            ],
          };
          break;
        }
      }
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
    
    // API KEY欄位（大寫版本）
    if (database.properties['API KEY'] && data.apiKey) {
      properties['API KEY'] = {
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
    
    // DOCUMENT INFO欄位（大寫版本）
    if (database.properties['DOCUMENT INFO'] && data.documentInfo) {
      properties['DOCUMENT INFO'] = {
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

// 搜尋 Notion 資料庫
async function searchNotion(keyword, category = null) {
  try {
    let filter = null;
    
    if (category && keyword) {
      // 同時搜尋類別和關鍵字
      filter = {
        and: [
          {
            or: [
              {
                property: 'Category',
                multi_select: {
                  contains: category
                }
              },
              {
                property: 'Category',
                select: {
                  equals: category
                }
              }
            ]
          },
          {
            or: [
              {
                property: 'Name',
                title: {
                  contains: keyword
                }
              },
              {
                property: 'Title',
                title: {
                  contains: keyword
                }
              },
              {
                property: '標題',
                title: {
                  contains: keyword
                }
              },
              {
                property: '名稱',
                title: {
                  contains: keyword
                }
              },
              {
                property: 'Content',
                rich_text: {
                  contains: keyword
                }
              },
              {
                property: 'Info',
                rich_text: {
                  contains: keyword
                }
              },
              {
                property: 'URL',
                url: {
                  contains: keyword
                }
              },
              {
                property: 'URL',
                rich_text: {
                  contains: keyword
                }
              }
            ]
          }
        ]
      };
    } else if (category) {
      // 只搜尋類別
      filter = {
        or: [
          {
            property: 'Category',
            multi_select: {
              contains: category
            }
          },
          {
            property: 'Category',
            select: {
              equals: category
            }
          }
        ]
      };
    } else if (keyword) {
      // 只搜尋關鍵字
      filter = {
        or: [
          {
            property: 'Name',
            title: {
              contains: keyword
            }
          },
          {
            property: 'Title',
            title: {
              contains: keyword
            }
          },
          {
            property: '標題',
            title: {
              contains: keyword
            }
          },
          {
            property: '名稱',
            title: {
              contains: keyword
            }
          },
          {
            property: 'Content',
            rich_text: {
              contains: keyword
            }
          },
          {
            property: 'Info',
            rich_text: {
              contains: keyword
            }
          },
          {
            property: 'URL',
            url: {
              contains: keyword
            }
          },
          {
            property: 'URL',
            rich_text: {
              contains: keyword
            }
          }
        ]
      };
    }
    
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: filter,
      sorts: [
        {
          timestamp: 'created_time',
          direction: 'descending'
        }
      ],
      page_size: 20 // 限制返回數量
    });
    
    // 處理搜尋結果
    const results = response.results.map(page => {
      const properties = page.properties;
      
      // 獲取標題
      let title = '';
      const titleFields = ['Name', 'Title', '標題', '名稱', 'name', 'title', 'ttitle'];
      for (const fieldName of titleFields) {
        if (properties[fieldName] && properties[fieldName].type === 'title' && properties[fieldName].title.length > 0) {
          title = properties[fieldName].title[0].text.content;
          break;
        }
      }
      
      // 獲取類別
      let category = '';
      if (properties['Category']) {
        if (properties['Category'].type === 'multi_select' && properties['Category'].multi_select.length > 0) {
          category = properties['Category'].multi_select[0].name;
        } else if (properties['Category'].type === 'select' && properties['Category'].select) {
          category = properties['Category'].select.name;
        }
      }
      
      // 獲取內容
      let content = '';
      if (properties['Content'] && properties['Content'].rich_text.length > 0) {
        content = properties['Content'].rich_text[0].text.content;
      }
      
      // 獲取功能介紹
      let info = '';
      if (properties['Info'] && properties['Info'].rich_text.length > 0) {
        info = properties['Info'].rich_text[0].text.content;
      } else {
        // 檢查其他可能的描述欄位
        const infoFields = ['功能介紹', 'Description', 'DESCRIPTION', '描述', 'info'];
        for (const fieldName of infoFields) {
          if (properties[fieldName] && properties[fieldName].rich_text && properties[fieldName].rich_text.length > 0) {
            info = properties[fieldName].rich_text[0].text.content;
            break;
          }
        }
      }
      
      // 獲取 URL
      let url = '';
      if (properties['URL']) {
        if (properties['URL'].type === 'url' && properties['URL'].url) {
          url = properties['URL'].url;
        } else if (properties['URL'].type === 'rich_text' && properties['URL'].rich_text.length > 0) {
          url = properties['URL'].rich_text[0].text.content;
        }
      }
      
      return {
        id: page.id,
        title: title || '無標題',
        category: category || '其他',
        content: content.substring(0, 200) + (content.length > 200 ? '...' : ''),
        info: info.substring(0, 300) + (info.length > 300 ? '...' : ''),
        url: url || '',
        notionUrl: page.url,
        createdTime: page.created_time
      };
    });
    
    return {
      success: true,
      count: results.length,
      results: results
    };
    
  } catch (error) {
    console.error('搜尋 Notion 資料庫時發生錯誤：', error);
    return {
      success: false,
      error: error.message,
      results: []
    };
  }
}

module.exports = {
  saveToNotion,
  saveBatchToNotion,
  checkUrlExists,
  searchNotion,
};