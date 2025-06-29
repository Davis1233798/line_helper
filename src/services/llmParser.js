const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function parseMessage(message) {
  const prompt = `
你是一個智能訊息分類助手。請分析以下用戶訊息：

1. 如果訊息包含多個工具/網站的清單，請將每個工具解析為獨立的項目
2. 如果是單一訊息，則按原有方式處理

請嚴格按照 JSON 格式輸出，不要包含任何額外的文字或解釋。

**如果是多個工具清單**，輸出格式為：
{
  "isMultipleItems": true,
  "items": [
    {
      "category": "Link",
      "title": "", // 工具名稱
      "content": "", // 工具功能描述
      "url": "", // 工具網址
      "apiKey": "",
      "documentInfo": ""
    }
  ]
}

**如果是單一訊息**，輸出格式為：
{
  "isMultipleItems": false,
  "category": "", // 類別：可以是 "Note", "Todo", "Link", "API_Key", "Document", "Idea", "Other"
  "title": "", // 訊息的簡要標題
  "content": "", // 訊息的詳細內容
  "url": "", // 如果訊息包含URL，請提取
  "apiKey": "", // 如果訊息包含API金鑰，請提取
  "documentInfo": "" // 如果訊息是關於文件，請提取文件相關資訊
}

解析規則：
- 當訊息包含明顯的清單格式（如數字編號、破折號分點、多個網址）時，視為多個工具清單
- 提取每個工具的名稱作為title
- 提取工具的功能描述作為content
- 提取完整的網址，確保格式正確（加上 https:// 如果缺少）
- 每個工具的category都設為"Link"

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
    
    // 如果是多個項目，進行後處理
    if (parsedData.isMultipleItems && parsedData.items) {
      // 確保每個項目的URL格式正確
      parsedData.items = parsedData.items.map(item => {
        if (item.url && !item.url.startsWith('http')) {
          item.url = 'https://' + item.url;
        }
        return item;
      });
      return parsedData;
    }
    
    // 單一項目的URL檢測和修正
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/g);
    if (urlMatch && urlMatch.length > 0) {
      parsedData.url = urlMatch[0];
      if (parsedData.category !== "Link") {
        parsedData.category = "Link";
      }
    }
    
    return parsedData;
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 備用方案：嘗試檢測是否為多個URL的清單
    const urlMatches = message.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.(com|io|ai|org|net|co)[^\s]*)/g);
    
    if (urlMatches && urlMatches.length > 2) {
      // 如果有多個URL，嘗試解析為多個項目
      const lines = message.split('\n').filter(line => line.trim());
      const items = [];
      
      for (const line of lines) {
        const urlMatch = line.match(/(https?:\/\/[^\s]+|[a-zA-Z0-9.-]+\.(com|io|ai|org|net|co)[^\s]*)/);
        if (urlMatch) {
          let url = urlMatch[0];
          if (!url.startsWith('http')) {
            url = 'https://' + url;
          }
          
          // 提取工具名稱（在 → 之前的部分）
          const titleMatch = line.match(/^[^→]+/);
          const title = titleMatch ? titleMatch[0].replace(/^\d+\.\s*/, '').replace(/^-\s*/, '').trim() : url;
          
          items.push({
            category: "Link",
            title: title,
            content: `工具網站：${title}`,
            url: url,
            apiKey: "",
            documentInfo: ""
          });
        }
      }
      
      if (items.length > 0) {
        return {
          isMultipleItems: true,
          items: items
        };
      }
    }
    
    // 最終備用方案
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/g);
    const isUrl = urlMatch && urlMatch.length > 0;
    
    return {
      isMultipleItems: false,
      category: isUrl ? "Link" : "Other",
      title: message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      content: message,
      url: isUrl ? urlMatch[0] : "",
      apiKey: "",
      documentInfo: ""
    };
  }
}

module.exports = {
  parseMessage,
};
