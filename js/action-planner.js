const MODEL = 'gemini-3.5-flash';

export async function planActions(prompt, apiKey, rig) {
  const schema = {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      actions: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            action: { type: 'STRING', enum: ['idle','walk','run','wave','jump','turn_left','turn_right','sit_down','stand_up'] },
            duration: { type: 'NUMBER' },
            intensity: { type: 'NUMBER' },
            repeat: { type: 'INTEGER' }
          },
          required: ['action','duration']
        }
      }
    },
    required: ['summary','actions']
  };
  const instructions = [
    'You are an animation director. Convert the Vietnamese request into a concise timed sequence of supported motion primitives.',
    'Do NOT output bones, joints, rotations, angles, keyframes, or transforms. The runtime motion library owns all skeletal motion.',
    'Supported actions: idle, walk, run, wave, jump, turn_left, turn_right, sit_down, stand_up.',
    'Use 1 to 8 actions. Each duration is seconds, between 0.4 and 12. intensity is 0.2 to 1.5. repeat is optional and normally 1.',
    'Preserve the requested order and intent. Add idle only when a pause is clearly requested. For unsupported complex actions, approximate with supported primitives and explain briefly in summary.',
    'Character rig: ' + (rig.isMixamo ? 'Mixamo' : 'humanoid') + '. Bone count: ' + rig.bones.length + '.',
    'User request: ' + prompt
  ].join('\n');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: instructions }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 2048, temperature: 0.2 }
    })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message || 'Gemini API request failed');
  const raw = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
  if (!raw) throw new Error('Gemini không trả về chuỗi hành động.');
  const plan = JSON.parse(raw);
  if (!Array.isArray(plan.actions) || !plan.actions.length) throw new Error('Kế hoạch không có hành động hợp lệ.');
  plan.actions = plan.actions.slice(0, 8).map(item => ({
    action: String(item.action || 'idle'),
    duration: Math.max(0.4, Math.min(12, Number(item.duration) || 2)),
    intensity: Math.max(0.2, Math.min(1.5, Number(item.intensity) || 1)),
    repeat: Math.max(1, Math.min(8, Math.round(Number(item.repeat) || 1)))
  }));
  return plan;
}
