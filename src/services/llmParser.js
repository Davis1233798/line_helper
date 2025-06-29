const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');
const cheerio = require('cheerio');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// 抓取網站內容
async function fetchWebsiteContent(url) {
  try {
    const response = await axios.get(url, {
      timeout: 5000,
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
                  url.replace('https://', '').replace('http://', '');
    
    // 取得描述
    const description = $('meta[name="description"]').attr('content') ||
                       $('meta[property="og:description"]').attr('content') ||
                       $('p').first().text().trim() ||
                       '';
    
    // 取得更多內容用於分析
    const contentText = $('main').text() || 
                       $('article').text() || 
                       $('.content').text() ||
                       $('body').text();
    
    const rawContent = contentText.replace(/\s+/g, ' ').trim().substring(0, 800);
    
    return {
      title: title.substring(0, 100),
      description: description.substring(0, 300),
      rawContent: rawContent
    };
  } catch (error) {
    console.error(`Error fetching ${url}:`, error.message);
    const siteName = url.replace('https://', '').replace('http://', '').split('/')[0];
    return {
      title: siteName,
      description: '',
      rawContent: ''
    };
  }
}

// 使用 LLM 分析網站功能
async function analyzeWebsiteFunction(url, title, description, rawContent) {
  const prompt = `
請分析這個網站的功能並提供繁體中文的詳細描述。請務必使用繁體中文回答。

網站URL：${url}
網站標題：${title}
網站描述：${description}
網站內容：${rawContent}

請提供：
1. 工具名稱（繁體中文）
2. 主要功能（50-100字的繁體中文描述，說明這個工具的具體用途和特色）

回傳格式：
{
  "title": "工具名稱",
  "function": "詳細功能描述"
}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const analysis = JSON.parse(jsonString);
    
    return {
      title: analysis.title || title,
      description: analysis.function || 'AI 工具'
    };
  } catch (error) {
    console.error(`分析網站功能失敗：${url}`, error);
    return {
      title: title,
      description: 'AI 工具，協助提升工作效率'
    };
  }
}

// 批量抓取並分析網站內容
async function fetchMultipleWebsiteContents(urls) {
  const promises = urls.slice(0, 10).map(async (url) => {
    try {
      const websiteData = await fetchWebsiteContent(url);
      const analysis = await analyzeWebsiteFunction(
        url, 
        websiteData.title, 
        websiteData.description, 
        websiteData.rawContent
      );
      return analysis;
    } catch (error) {
      return {
        title: url.replace('https://', '').replace('http://', ''),
        description: 'AI 工具，協助提升工作效率'
      };
    }
  });
  
  return await Promise.all(promises);
}

// 解析包含多個連結的訊息
async function parseMessage(message) {
  // 修正URL正則表達式，支援更多格式
  const urlMatches = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
  
  console.log('Found URLs:', urlMatches);
  
  if (urlMatches && urlMatches.length > 1) {
    // 處理多個連結的情況
    return await parseMultipleLinks(message, urlMatches);
  } else {
    // 處理單個連結或無連結的情況
    return await parseSingleMessage(message);
  }
}

async function parseMultipleLinks(message, urls) {
  // 確保所有URL都有協議前綴
  const fullUrls = urls.map(url => {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'https://' + url;
    }
    return url;
  });
  
  console.log(`處理 ${fullUrls.length} 個網址`);
  
  const prompt = `
請分析以下文本中的 AI 工具連結，為每個連結提取繁體中文的資訊。請務必使用繁體中文回答。

請為每個連結從文本中提取：
1. 工具的中文名稱或功能描述
2. 工具的主要用途

回傳 JSON 陣列格式：
[{"url":"完整網址","title":"工具名稱","description":"從文本中提取的功能說明"}]

文本內容：
"""${message}"""

請確保所有回答都使用繁體中文。
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    let linkData = JSON.parse(jsonString);
    
    if (!Array.isArray(linkData)) {
      linkData = [linkData];
    }
    
    // 如果LLM沒有回傳所有URL，補充缺失的
    if (linkData.length < fullUrls.length) {
      const processedUrls = new Set(linkData.map(item => item.url));
      
      for (const url of fullUrls) {
        if (!processedUrls.has(url)) {
          linkData.push({
            url: url,
            title: url.replace('https://', '').split('/')[0],
            description: 'AI 工具'
          });
        }
      }
    }
    
    // 批量分析網站內容
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    // 建立最終資料
    const enrichedData = fullUrls.map((url, index) => {
      const linkInfo = linkData.find(item => item.url === url) || {
        title: url.replace('https://', '').split('/')[0],
        description: 'AI 工具'
      };
      
      const websiteData = websiteAnalysis[index] || {
        title: linkInfo.title,
        description: linkInfo.description
      };
      
      return {
        category: "Link",
        title: websiteData.title || linkInfo.title,
        content: websiteData.description || linkInfo.description,
        url: url,
        apiKey: "",
        documentInfo: ""
      };
    });
    
    console.log(`建立 ${enrichedData.length} 個項目`);
    return enrichedData;
  } catch (error) {
    console.error('解析連結時發生錯誤：', error);
    
    // 備用方案
    const websiteAnalysis = await fetchMultipleWebsiteContents(fullUrls);
    
    const fallbackData = fullUrls.map((url, index) => ({
      category: "Link",
      title: websiteAnalysis[index]?.title || url.replace('https://', '').split('/')[0],
      content: websiteAnalysis[index]?.description || 'AI 工具，協助提升工作效率',
      url: url,
      apiKey: "",
      documentInfo: ""
    }));
    
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
    const urlMatch = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
    if (urlMatch && urlMatch.length > 0) {
      let url = urlMatch[0];
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      parsedData.url = url;
      parsedData.category = "Link";
      
      // 如果是單個連結，分析網站內容
      const websiteData = await fetchWebsiteContent(parsedData.url);
      const analysis = await analyzeWebsiteFunction(
        parsedData.url,
        websiteData.title,
        websiteData.description,
        websiteData.rawContent
      );
      parsedData.title = analysis.title || parsedData.title;
      parsedData.content = analysis.description;
    }
    
    return [parsedData]; // 返回陣列格式保持一致性
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 檢測URL的備用方案
    const urlMatch = message.match(/([a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?)/g);
    const isUrl = urlMatch && urlMatch.length > 0;
    
    let analysis = null;
    let url = '';
    if (isUrl) {
      url = urlMatch[0];
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const websiteData = await fetchWebsiteContent(url);
      analysis = await analyzeWebsiteFunction(
        url,
        websiteData.title,
        websiteData.description,
        websiteData.rawContent
      );
    }
    
    // Fallback to a default structure if LLM parsing fails
    return [{
      category: isUrl ? "Link" : "Other",
      title: analysis ? analysis.title : message.substring(0, 50) + (message.length > 50 ? "..." : ""),
      content: analysis ? analysis.description : message,
      url: isUrl ? url : "",
      apiKey: "",
      documentInfo: ""
    }];
  }
}

module.exports = {
  parseMessage,
};
