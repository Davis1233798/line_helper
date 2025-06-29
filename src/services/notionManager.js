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
  console.log("--- 開始儲存到 Notion ---");
  console.log("接收到的資料:", JSON.stringify(data, null, 2));

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    console.error("錯誤：傳入 saveToNotion 的資料為空或無效。");
    return { success: false, error: "傳入的解析資料為空。" };
  }

  try {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    const properties = {};
    
    const titleFieldNames = ['Name', 'Title', '標題', '名稱', 'name', 'title', 'ttitle'];
    let titleFieldName = null;
    
    for (const fieldName of titleFieldNames) {
      if (database.properties[fieldName] && database.properties[fieldName].type === 'title') {
        titleFieldName = fieldName;
        break;
      }
    }
    
    if (!titleFieldName) {
      for (const [fieldName, property] of Object.entries(database.properties)) {
        if (property.type === 'title') {
          titleFieldName = fieldName;
          break;
        }
      }
    }
    console.log("找到的標題欄位:", titleFieldName);

    if (titleFieldName && data.title) {
      properties[titleFieldName] = {
        title: [{ text: { content: data.title } }],
      };
      console.log("已設定標題屬性。");
    }

    const categoryFieldName = 'Category';
    if (database.properties[categoryFieldName] && data.category) {
        if (database.properties[categoryFieldName].type === 'multi_select') {
            const categoryTags = [{ name: data.category }];
            if (data.tags && Array.isArray(data.tags)) {
                data.tags.forEach(tag => { if (tag && tag.trim()) { categoryTags.push({ name: tag.trim() }); } });
            }
            properties[categoryFieldName] = { multi_select: categoryTags };
        } else if (database.properties[categoryFieldName].type === 'select') {
            properties[categoryFieldName] = { select: { name: data.category } };
        }
        console.log("已設定分類屬性。");
    }
    
    const infoFieldName = 'info'; // 從日誌得知是小寫
    if (database.properties[infoFieldName] && data.info) {
        properties[infoFieldName] = { rich_text: [{ text: { content: data.info } }] };
        console.log("已設定 info 屬性。");
    }

    const urlFieldName = 'URL';
    if (database.properties[urlFieldName] && data.url) {
        if (database.properties[urlFieldName].type === 'url') {
            properties[urlFieldName] = { url: data.url };
        } else if (database.properties[urlFieldName].type === 'rich_text') {
            properties[urlFieldName] = { rich_text: [{ text: { content: data.url } }] };
        }
        console.log("已設定 URL 屬性。");
    }
    
    const contentFieldName = 'Content';
    if (database.properties[contentFieldName] && data.content) {
        properties[contentFieldName] = { rich_text: [{ text: { content: data.content.substring(0, 2000) } }] };
        console.log("已設定 Content 屬性。");
    }

    console.log("最終準備建立的頁面屬性:", JSON.stringify(Object.keys(properties)));

    if (Object.keys(properties).length === 0) {
      console.error("錯誤：沒有任何有效屬性可供建立頁面。");
      throw new Error("沒有從解析資料中找到任何有效欄位可存入 Notion。");
    }

    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties,
    });
    
    console.log("成功建立 Notion 頁面:", response.url);
    const pageTitle = response.properties[titleFieldName]?.title[0]?.text?.content || '無標題';
    
    return {
      success: true,
      url: response.url,
      title: pageTitle,
    };
    
  } catch (error) {
    console.error('在 saveToNotion 中發生錯誤:', error.message);
    return {
      success: false,
      error: error.message || '儲存至 Notion 時發生未知錯誤。',
    };
  }
}

// 獲取所有Notion資料以供本地快取或搜尋
async function getNotionData() {
  try {
    const allPages = [];
    let hasMore = true;
    let startCursor = undefined;
    
    while (hasMore) {
      const response = await notion.databases.query({
        database_id: databaseId,
        start_cursor: startCursor,
        page_size: 100
      });

      allPages.push(...response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }
    
    console.log(`從 Notion 獲取了 ${allPages.length} 筆資料`);

    // 將頁面轉換為簡化格式
    const simplifiedData = allPages.map(page => {
      // 提取標題
      const titleProp = Object.values(page.properties).find(prop => prop.type === 'title');
      const title = titleProp ? titleProp.title[0]?.plain_text || '無標題' : '無標題';
      
      // 提取URL
      const urlProp = page.properties['URL'];
      const url = urlProp && urlProp.url ? urlProp.url : '';
      
      // 提取類別
      const categoryProp = page.properties['Category'];
      let category = '';
      if (categoryProp) {
        if (categoryProp.type === 'multi_select') {
          category = categoryProp.multi_select.map(item => item.name).join(', ');
        } else if (categoryProp.type === 'select') {
          category = categoryProp.select.name;
        }
      }
      
      return { id: page.id, title, url, category };
    });

    return simplifiedData;

  } catch (error) {
    console.error('從 Notion 獲取資料時發生錯誤：', error);
    return [];
  }
}

// 搜尋 Notion 資料庫
async function searchNotion(keyword, category = null) {
  try {
    // 先獲取資料庫結構，就像 saveToNotion 一樣
    const database = await notion.databases.retrieve({ database_id: databaseId });
    console.log('Database properties for search:', Object.keys(database.properties));
    
    // 動態找到標題欄位
    const titleFieldNames = ['Name', 'Title', '標題', '名稱', 'name', 'title', 'ttitle'];
    const actualTitleFields = [];
    
    for (const fieldName of titleFieldNames) {
      if (database.properties[fieldName] && database.properties[fieldName].type === 'title') {
        actualTitleFields.push(fieldName);
      }
    }
    
    // 如果找不到，使用第一個title類型的欄位
    if (actualTitleFields.length === 0) {
      for (const [fieldName, property] of Object.entries(database.properties)) {
        if (property.type === 'title') {
          actualTitleFields.push(fieldName);
          break;
        }
      }
    }
    
    console.log('Found title fields:', actualTitleFields);
    
    // 動態找到其他欄位
    const categoryField = database.properties['Category'];
    const contentField = database.properties['Content'];
    const infoField = database.properties['Info'];
    const urlField = database.properties['URL'];
    
    // 檢查 Info 欄位的替代名稱
    let actualInfoField = infoField;
    if (!actualInfoField) {
      const infoFieldNames = ['功能介紹', 'Description', 'DESCRIPTION', '描述', 'info'];
      for (const fieldName of infoFieldNames) {
        if (database.properties[fieldName]) {
          actualInfoField = database.properties[fieldName];
          break;
        }
      }
    }
    
    let filter = null;
    
    if (category && keyword) {
      // 同時搜尋類別和關鍵字
      const titleFilters = actualTitleFields.map(fieldName => ({
        property: fieldName,
        title: { contains: keyword }
      }));
      
      const searchFilters = [
        ...titleFilters,
        ...(contentField ? [{
          property: 'Content',
          rich_text: { contains: keyword }
        }] : []),
        ...(actualInfoField ? [{
          property: actualInfoField === infoField ? 'Info' : Object.keys(database.properties).find(key => database.properties[key] === actualInfoField),
          rich_text: { contains: keyword }
        }] : []),
        ...(urlField ? [{
          property: 'URL',
          [urlField.type === 'url' ? 'url' : 'rich_text']: { contains: keyword }
        }] : [])
      ];
      
      filter = {
        and: [
          ...(categoryField ? [{
            or: [
              ...(categoryField.type === 'multi_select' ? [{
                property: 'Category',
                multi_select: { contains: category }
              }] : []),
              ...(categoryField.type === 'select' ? [{
                property: 'Category',
                select: { equals: category }
              }] : [])
            ]
          }] : []),
          {
            or: searchFilters
          }
        ]
      };
    } else if (category) {
      // 只搜尋類別
      if (categoryField) {
        filter = {
          or: [
            ...(categoryField.type === 'multi_select' ? [{
              property: 'Category',
              multi_select: { contains: category }
            }] : []),
            ...(categoryField.type === 'select' ? [{
              property: 'Category',
              select: { equals: category }
            }] : [])
          ]
        };
      }
    } else if (keyword) {
      // 只搜尋關鍵字
      const titleFilters = actualTitleFields.map(fieldName => ({
        property: fieldName,
        title: { contains: keyword }
      }));
      
      const searchFilters = [
        ...titleFilters,
        ...(contentField ? [{
          property: 'Content',
          rich_text: { contains: keyword }
        }] : []),
        ...(actualInfoField ? [{
          property: actualInfoField === infoField ? 'Info' : Object.keys(database.properties).find(key => database.properties[key] === actualInfoField),
          rich_text: { contains: keyword }
        }] : []),
        ...(urlField ? [{
          property: 'URL',
          [urlField.type === 'url' ? 'url' : 'rich_text']: { contains: keyword }
        }] : [])
      ];
      
      filter = {
        or: searchFilters
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
      
      // 獲取標題 - 使用動態找到的欄位
      let title = '';
      for (const fieldName of actualTitleFields) {
        if (properties[fieldName] && properties[fieldName].title.length > 0) {
          title = properties[fieldName].title[0].text.content;
          break;
        }
      }
      
      // 獲取類別
      let category = '';
      if (properties['Category']) {
        if (properties['Category'].type === 'multi_select' && properties['Category'].multi_select.length > 0) {
          // 支援多標籤，用逗號分隔
          category = properties['Category'].multi_select.map(tag => tag.name).join(', ');
        } else if (properties['Category'].type === 'select' && properties['Category'].select) {
          category = properties['Category'].select.name;
        }
      }
      
      // 獲取內容
      let content = '';
      if (properties['Content'] && properties['Content'].rich_text.length > 0) {
        content = properties['Content'].rich_text[0].text.content;
      }
      
      // 獲取功能介紹 - 使用動態找到的欄位
      let info = '';
      const infoFieldName = actualInfoField === infoField ? 'Info' : Object.keys(database.properties).find(key => database.properties[key] === actualInfoField);
      if (infoFieldName && properties[infoFieldName] && properties[infoFieldName].rich_text && properties[infoFieldName].rich_text.length > 0) {
        info = properties[infoFieldName].rich_text[0].text.content;
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
  getNotionData
};