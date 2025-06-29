const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 抓取網站內容
async function fetchWebsiteContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    
    const $ = cheerio.load(response.data);
    
    // 移除script和style標籤
    $('script, style').remove();
    
    // 取得頁面標題
    const title = $('title').text().trim() || 
                  $('h1').first().text().trim() ||
                  $('meta[property="og:title"]').attr('content') ||
                  '';
    
    // 取得描述
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') ||
                       $('p').first().text().trim() ||
                       '';
    
    // 取得主要內容
    const content = $('main').text() || 
                   $('article').text() || 
                   $('.content').text() ||
                   $('body').text();
    
    return {
      title: title || 'No title found',
      description: description || 'No description found',
      content: content.replace(/\s+/g, ' ').trim().substring(0, 500) + '...'
    };
  } catch (error) {
    console.error(`Error fetching website content for ${url}:`, error.message);
    return {
      title: url,
      description: 'Unable to fetch website content',
      content: 'Website content could not be retrieved'
    };
  }
}

// 解析包含多個連結的訊息
async function parseMessage(message) {
  // 先檢查是否包含多個連結
  const urlMatches = message.match(/(https?:\/\/[^\s]+)/g);
  
  if (urlMatches && urlMatches.length > 1) {
    // 處理多個連結的情況
    return await parseMultipleLinks(message, urlMatches);
  } else {
    // 處理單個連結或無連結的情況
    return await parseSingleMessage(message);
  }
}

async function parseMultipleLinks(message, urls) {
  const prompt = `
你是一個智能連結分析助手。請分析以下包含多個網站連結的文本，並為每個連結提取相關信息。

請為每個連結返回一個JSON對象，格式如下：
[
  {
    "url": "網站URL",
    "title": "網站標題或描述",
    "description": "網站功能描述"
  }
]

請嚴格按照JSON格式輸出，不要包含任何額外的文字或解釋。請從文本中提取每個網站的功能描述。

文本內容：
"""${message}"""

網站URL列表：
${urls.map(url => `- ${url}`).join('\n')}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // 清理回應並解析JSON
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const linkData = JSON.parse(jsonString);
    
    // 為每個連結抓取實際網站內容
    const enrichedData = [];
    
    for (const link of linkData) {
      const websiteContent = await fetchWebsiteContent(link.url);
      
      enrichedData.push({
        category: "Link",
        title: websiteContent.title || link.title,
        content: `${link.description}\n\n網站摘要：${websiteContent.description}\n\n${websiteContent.content}`,
        url: link.url,
        apiKey: "",
        documentInfo: ""
      });
    }
    
    return enrichedData;
  } catch (error) {
    console.error('Error parsing multiple links with LLM:', error);
    
    // 備用方案：直接使用URL創建基本結構
    const fallbackData = [];
    for (const url of urls) {
      const websiteContent = await fetchWebsiteContent(url);
      
      fallbackData.push({
        category: "Link",
        title: websiteContent.title,
        content: websiteContent.description + '\n\n' + websiteContent.content,
        url: url,
        apiKey: "",
        documentInfo: ""
      });
    }
    
    return fallbackData;
  }
}

async function parseSingleMessage(message) {
  const prompt = `
你是一個智能訊息分類助手。請將以下用戶訊息解析為結構化數據。請嚴格按照 JSON 格式輸出，不要包含任何額外的文字或解釋。如果某個字段無法從訊息中提取，請使用空字串或 null。

輸出 JSON 格式應為：
{
  "category": "", // 類別：可以是 "Note" (筆記), "Todo" (待辦事項), "Link" (連結), "API_Key" (API金鑰), "Document" (文件), "Idea" (想法), "Other" (其他)
  "title": "", // 訊息的簡要標題，如果沒有明確標題，請從內容中提取關鍵詞
  "content": "", // 訊息的詳細內容
  "url": "", // 如果訊息包含URL，請提取
  "apiKey": "", // 如果訊息包含API金鑰，請提取
  "documentInfo": "" // 如果訊息是關於文件，請提取文件相關資訊
}

用戶訊息：
"""${message}"""
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    // 清理回應並解析JSON
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const parsedData = JSON.parse(jsonString);
    
    // 檢測URL
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/g);
    if (urlMatch && urlMatch.length > 0) {
      parsedData.url = urlMatch[0];
      parsedData.category = "Link";
      
      // 如果是單個連結，也抓取網站內容
      const websiteContent = await fetchWebsiteContent(parsedData.url);
      parsedData.title = websiteContent.title || parsedData.title;
      parsedData.content = parsedData.content + '\n\n網站摘要：' + websiteContent.description + '\n\n' + websiteContent.content;
    }
    
    return [parsedData]; // 返回陣列格式保持一致性
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 檢測URL的備用方案
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/g);
    const isUrl = urlMatch && urlMatch.length > 0;
    
    let websiteContent = null;
    if (isUrl) {
      websiteContent = await fetchWebsiteContent(urlMatch[0]);
    }
    
    // Fallback to a default structure if LLM parsing fails
    return [{
      category: isUrl ? "Link" : "Other",
      title: websiteContent ? websiteContent.title : message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      content: websiteContent ? websiteContent.description + '\n\n' + websiteContent.content : message,
      url: isUrl ? urlMatch[0] : "",
      apiKey: "",
      documentInfo: ""
    }];
  }
}

module.exports = {
  parseMessage,
};
