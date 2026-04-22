/* global process */
export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { base64, mediaType } = JSON.parse(event.body);

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: 'Return JSON only: {name, brand, color, type}. Type must be one of: Shirt, T-Shirt, Sweatshirt, Jeans, Jacket, Coat, Trousers, Shorts, Footwear, Accessories, Other. Be as specific as possible. For footwear: identify exact silhouette and model (e.g. Nike Dunk High, Air Jordan 1 Retro, New Balance 990v5). For clothing: identify specific style details using fashion terminology. Keep name concise but descriptive.',
            },
          ],
        }],
      }),
    });

    const data = await res.json();
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    };
  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: e.message }),
    };
  }
}
