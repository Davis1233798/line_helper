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
2. 功能介紹（80-150字的繁體中文描述，說明這個工具的具體用途、主要功能和特色，內容要具體且實用）

注意：
- 功能介紹必須在80-150字之間
- 要說明具體用途，不要只寫"AI工具"
- 要包含主要功能特色
- 使用繁體中文
- 必須具體描述工具的實際功能，不能太籠統

回傳格式：
{
  "title": "工具名稱",
  "info": "具體功能介紹（80-150字）"
}
`;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();
    
    let jsonString = text.replace(/```json\n|```/g, '').trim();
    const analysis = JSON.parse(jsonString);
    
    // 確保 info 欄位長度適中且內容豐富
    let info = analysis.info || analysis.function || '';
    
    // 如果回應太簡短或包含"AI工具"這種籠統描述，重新生成
    if (info.length < 80 || info.includes('AI 工具') || info.includes('AI工具')) {
      const detailedPrompt = `
網站：${url}
標題：${title}

請詳細分析這個網站的具體功能，以繁體中文提供80-150字的詳細描述。請包含：
1. 工具的具體用途
2. 主要功能特色
3. 適用場景
4. 使用者群體

不要使用籠統的詞語如"AI工具"，要具體說明功能。

只回傳功能描述文字，不要JSON格式：
`;
      
      const detailedResult = await model.generateContent(detailedPrompt);
      const detailedResponse = await detailedResult.response;
      info = detailedResponse.text().trim();
    }
    
    // 確保長度在合理範圍內
    if (info.length < 80) {
      info = `${info}。此工具提供專業級的智能功能，能夠自動化處理複雜任務，提升工作效率，並具備直觀的使用者介面，適合各種專業應用場景。`;
    }
    
    if (info.length > 150) {
      info = info.substring(0, 147) + '...';
    }
    
    return {
      title: analysis.title || title,
      info: info
    };
  } catch (error) {
    console.error(`分析網站功能失敗：${url}`, error);
    
    // 根據URL生成預設描述
    const siteName = url.replace('https://', '').replace('http://', '').split('/')[0];
    let defaultInfo = '';
    
    if (siteName.includes('ai') || siteName.includes('gpt')) {
      defaultInfo = '智能人工智慧平台，提供自然語言處理、文字生成、問答系統等功能，能協助使用者完成各種文字相關任務，提升創作與工作效率。';
    } else if (siteName.includes('notion')) {
      defaultInfo = '全方位工作空間工具，整合筆記、文件、資料庫、任務管理等功能，支援團隊協作，提供靈活的頁面設計與強大的組織功能。';
    } else {
      defaultInfo = `${siteName} 是一個專業的線上工具平台，提供多元化的功能服務，具備使用者友善的介面設計，能夠滿足不同使用者的需求，提升工作效率與生產力。`;
    }
    
    return {
      title: title || siteName,
      info: defaultInfo
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
        info: linkInfo.description
      };
      
      return {
        category: "Link",
        title: websiteData.title || linkInfo.title,
        content: linkInfo.description, // 保持原始從訊息中提取的內容
        info: websiteData.info || '這個工具提供專業的線上服務，具備多項實用功能，能夠協助使用者提升工作效率與生產力，適合各種應用場景。', // 網站分析的功能介紹
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
      content: '從用戶訊息中提取的連結', // 原始內容
      info: websiteAnalysis[index]?.info || '這個工具提供專業的線上服務，具備多項實用功能，能夠協助使用者提升工作效率與生產力，適合各種應用場景。', // 功能介紹
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
      // content保持原始訊息內容，info放功能介紹
      parsedData.info = analysis.info;
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
      content: message, // 保持原始訊息內容
      info: analysis ? analysis.info : '', // 功能介紹
      url: isUrl ? url : "",
      apiKey: "",
      documentInfo: ""
    }];
  }
}


module.exports = {
  parseMessage,
};
