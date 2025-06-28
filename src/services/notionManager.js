const { Client } = require('@notionhq/client');

const notion = new Client({ auth: process.env.NOTION_API_TOKEN });
const databaseId = process.env.NOTION_DATABASE_ID;

async function saveToNotion(data) {
  try {
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        'Title': {
          title: [
            {
              text: {
                content: data.title || 'Untitled',
              },
            },
          ],
        },
        'Category': {
          select: {
            name: data.category || 'Other',
          },
        },
        'Content': {
          rich_text: [
            {
              text: {
                content: data.content || '',
              },
            },
          ],
        },
        'URL': {
          url: data.url || null,
        },
        'API Key': {
          rich_text: [
            {
              text: {
                content: data.apiKey || '',
              },
            },
          ],
        },
        'Document Info': {
          rich_text: [
            {
              text: {
                content: data.documentInfo || '',
              },
            },
          ],
        },
      },
    });
    return response.url; // Return the URL of the newly created Notion page
  } catch (error) {
    console.error('Error saving to Notion:', error.body || error);
    throw error;
  }
}

module.exports = {
  saveToNotion,
};
