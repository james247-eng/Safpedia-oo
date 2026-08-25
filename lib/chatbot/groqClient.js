// lib/chatbot/groqClient.js

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = process.env.GROQ_MODEL || 'gpt-oss-120b';

async function getChatCompletion({ systemPrompt, history, message }) {
  if (!process.env.GROQ_API_KEY) {
    throw Object.assign(new Error('GROQ_API_KEY is not configured'), { statusCode: 500 });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message }
  ];

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 400
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Groq API error:', res.status, errText);
    throw Object.assign(new Error('Chat service temporarily unavailable'), { statusCode: 502 });
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response — please try again.";
}

module.exports = { getChatCompletion };