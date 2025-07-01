const axios = require('axios');

// 支援多個短網址服務的故障轉移
class UrlShortener {
  constructor() {
    this.services = [
      {
        name: 'TinyURL',
        shorten: this.shortenWithTinyURL.bind(this)
      },
      {
        name: 'is.gd',
        shorten: this.shortenWithIsGd.bind(this)
      },
      {
        name: 'v.gd',
        shorten: this.shortenWithVGd.bind(this)
      }
    ];
  }

  // TinyURL 服務
  async shortenWithTinyURL(url) {
    try {
      const response = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.startsWith('https://tinyurl.com/')) {
        return response.data;
      }
      throw new Error('Invalid response from TinyURL');
    } catch (error) {
      console.error('TinyURL 服務失敗:', error.message);
      throw error;
    }
  }

  // is.gd 服務
  async shortenWithIsGd(url) {
    try {
      const response = await axios.get(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.startsWith('https://is.gd/')) {
        return response.data;
      }
      throw new Error('Invalid response from is.gd');
    } catch (error) {
      console.error('is.gd 服務失敗:', error.message);
      throw error;
    }
  }

  // v.gd 服務
  async shortenWithVGd(url) {
    try {
      const response = await axios.get(`https://v.gd/create.php?format=simple&url=${encodeURIComponent(url)}`, {
        timeout: 5000
      });
      
      if (response.data && response.data.startsWith('https://v.gd/')) {
        return response.data;
      }
      throw new Error('Invalid response from v.gd');
    } catch (error) {
      console.error('v.gd 服務失敗:', error.message);
      throw error;
    }
  }

  // 主要短網址方法，支援故障轉移
  async shortenUrl(url) {
    // 檢查 URL 是否需要縮短（長度超過 100 字元）
    if (!url || url.length <= 100) {
      return url;
    }

    console.log(`🔗 開始縮短網址: ${url.substring(0, 50)}...`);

    for (const service of this.services) {
      try {
        console.log(`🔄 嘗試使用 ${service.name} 服務`);
        const shortUrl = await service.shorten(url);
        console.log(`✅ ${service.name} 成功縮短網址: ${shortUrl}`);
        return shortUrl;
      } catch (error) {
        console.warn(`⚠️  ${service.name} 服務失敗，嘗試下一個服務`);
        continue;
      }
    }

    console.error('❌ 所有短網址服務都失敗，返回原始網址');
    return url;
  }

  // 批次縮短多個網址
  async shortenMultipleUrls(urls) {
    const results = [];
    
    for (const url of urls) {
      try {
        const shortUrl = await this.shortenUrl(url);
        results.push({
          original: url,
          shortened: shortUrl,
          success: shortUrl !== url
        });
      } catch (error) {
        results.push({
          original: url,
          shortened: url,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

// 建立單例實例
const urlShortener = new UrlShortener();

module.exports = {
  shortenUrl: urlShortener.shortenUrl.bind(urlShortener),
  shortenMultipleUrls: urlShortener.shortenMultipleUrls.bind(urlShortener)
};