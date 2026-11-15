const MODEL = 'gemini-3.8-flash';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname !== '/animate' || request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Use POST /animate' }), { status: 404, headers: cors });
    }
    if (!env.GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'Worker chưa được cấu hình GEMINI_API_KEY.' }), { status: 500, headers: cors });
    }
    try {
      const body = await request.json();
      const prompt = String(body.prompt || '').trim().slice(0, 2000);
      const bones = Array.isArray(body.bones) ? body.bones.filter(x => typeof x === 'string').slice(0, 180) : [];
      if (!prompt || !bones.length) {
        return new Response(JSON.stringify({ error: 'Thiếu prompt hoặc danh sách xương.' }), { status: 400, headers: cors });
      }
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summary: { type: 'string' },
          duration: { type: 'number' },
          tracks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                bone: { type: 'string' },
                keyframes: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      time: { type: 'number' },
                      x: { type: 'number' },
                      y: { type: 'number' },
                      z: { type: 'number' }
                    },
                    required: ['time', 'x', 'y', 'z']
                  }
                }
              },
              required: ['bone', 'keyframes']
            }
          }
        },
        required: ['name', 'summary', 'duration', 'tracks']
      };
      const input = [
        'You are a professional 3D character animator. Create local bone rotation keyframes for this exact Mixamo skeleton.',
        'Return rotations in DEGREES as local Euler XYZ OFFSETS relative to each bone bind/rest pose. Use only bone names from the provided list. Do not invent names.',
        'Keep motion natural, physically plausible and smooth. Include zero-offset starting and ending poses. Use 2-8 keyframes per animated bone. Values are additive pose offsets, not absolute bone rotations.',
        'Animate only necessary bones; usually hips, spine, head, arms, forearms, hands, thighs, legs and feet.',
        'Use a duration between 2 and 12 seconds unless the user explicitly asks otherwise. Keep root movement modest because this first version animates in-place.',
        'The user request is in Vietnamese; interpret it faithfully. Output concise Vietnamese summary.',
        'User prompt: ' + prompt,
        'Character: ' + String(body.rigName || 'Mixamo Character'),
        'Exact bone names: ' + bones.join(', ')
      ].join('\n');
      const upstream = await fetch('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({
          model: MODEL,
          input,
          response_format: { type: 'text', mime_type: 'application/json', schema }
        })
      });
      const result = await upstream.json();
      if (!upstream.ok) {
        return new Response(JSON.stringify({ error: result.error?.message || 'Gemini API error' }), { status: upstream.status, headers: cors });
      }
      const outputText = result.output_text || '';
      if (!outputText) throw new Error('Gemini không trả về output_text.');
      const animation = JSON.parse(outputText);
      animation.tracks = (animation.tracks || []).filter(track =>
        bones.includes(track.bone) && Array.isArray(track.keyframes)
      );
      if (!animation.tracks.length) throw new Error('Gemini không tạo được keyframe khớp với bộ xương.');
      return new Response(JSON.stringify({ animation }), { headers: cors });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message || 'Unknown server error' }), { status: 500, headers: cors });
    }
  }
};
