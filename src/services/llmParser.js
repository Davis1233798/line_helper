const { GoogleGenerativeAI } = require('@google/generative-ai');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function parseMessage(message) {
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
    }
    
    return parsedData;
  } catch (error) {
    console.error('Error parsing message with LLM:', error);
    
    // 檢測URL的備用方案
    const urlMatch = message.match(/(https?:\/\/[^\s]+)/g);
    const isUrl = urlMatch && urlMatch.length > 0;
    
    // Fallback to a default structure if LLM parsing fails
    return {
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
