export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    const { base64, mediaType = 'image/jpeg' } = req.body;
    if (!base64) return res.status(400).json({ error: 'No image data' });

    const key = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '';
    if (!key) return res.status(503).json({ error: 'CLAUDE_API_KEY not set' });

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
            { type: 'text', text: 'Identify this clothing item. Reply with only a JSON object: {"name": "item name", "brand": "brand or unknown", "color": "primary color", "type": "one of: Shirt/T-Shirt/Sweatshirt/Jeans/Jacket/Coat/Trousers/Shorts/Footwear/Accessories/Headwear/Other"}' },
          ],
        }],
      }),
    });

    const data = await anthropicRes.json();
    // Return raw Anthropic response so the client-side parser in autoTagWithClaude works
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
