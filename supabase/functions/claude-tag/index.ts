import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { base64, mediaType } = await req.json();

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': Deno.env.get('CLAUDE_API_KEY') ?? '',
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
              text: 'Return JSON only: {name, brand, color, type}. Type must be one of: Shirt, T-Shirt, Sweatshirt, Jeans, Jacket, Coat, Trousers, Shorts, Footwear, Accessories, Other. Be as specific as possible. For footwear: identify exact silhouette and model (e.g. Nike Dunk High, Air Jordan 1 Retro, New Balance 990v5), include any visible collab or edition in the name. For clothing: identify specific style details using fashion terminology where applicable. Keep name concise but descriptive.',
            },
          ],
        }],
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: corsHeaders });
  }
});
