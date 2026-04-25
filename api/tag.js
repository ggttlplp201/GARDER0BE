export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  try {
    // Read raw body as buffer
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);

    // Forward multipart form to Anthropic after extracting the image
    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) return res.status(400).json({ error: 'No boundary in multipart' });

    // Parse the single file part from the multipart body
    const bodyStr = buf.toString('binary');
    const partStart = bodyStr.indexOf('\r\n\r\n') + 4;
    const partEnd   = bodyStr.lastIndexOf(`\r\n--${boundary}`);
    const imageData = buf.slice(partStart, partEnd);

    // Detect media type
    let mediaType = 'image/jpeg';
    if (imageData[0] === 0x89 && imageData[1] === 0x50) mediaType = 'image/png';
    else if (imageData[0] === 0x52 && imageData[1] === 0x49) mediaType = 'image/webp';

    const base64 = imageData.toString('base64');

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '',
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
            { type: 'text', text: 'Identify this clothing item. Reply with only a JSON object: {"name": "item name", "brand": "brand or unknown", "color": "primary color", "type": "one of: Shirt/T-Shirt/Sweatshirt/Jeans/Jacket/Coat/Trousers/Shorts/Footwear/Accessories/Other"}' },
          ],
        }],
      }),
    });

    const data = await anthropicRes.json();
    const raw   = data?.content?.[0]?.text?.trim() || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse tags' });
    return res.status(200).json(JSON.parse(match[0]));
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
