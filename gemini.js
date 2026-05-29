const KEY_STORAGE = 'vox_gemini_key';
const MODEL       = 'gemini-flash-latest';
const BASE_URL    = 'https://generativelanguage.googleapis.com/v1beta/models';

export function getApiKey()      { return localStorage.getItem(KEY_STORAGE) || ''; }
export function setApiKey(key)   { localStorage.setItem(KEY_STORAGE, key.trim()); }
export function hasApiKey()      { return !!getApiKey(); }

async function callGemini(prompt) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');

  const res = await fetch(`${BASE_URL}/${MODEL}:generateContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

export async function parseTask(rawInput) {
  const today = new Date().toISOString().split('T')[0];
  const prompt =
`You are a task parser. Extract structured task data from the user's input.

User input: "${rawInput}"

Return ONLY a valid JSON object with these exact fields (no markdown, no explanation):
{
  "title":    "clean task title",
  "dueDate":  "YYYY-MM-DD or null",
  "dueTime":  "HH:MM in 24h or null",
  "priority": "low | medium | high",
  "category": "work | personal | health | shopping | other"
}

Today's date is ${today}. Use it to resolve relative dates like "tomorrow" or "next Friday".`;

  try {
    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    if (!parsed.title) throw new Error('no title');
    return parsed;
  } catch {
    return { title: rawInput, priority: 'medium', category: 'other', dueDate: null, dueTime: null };
  }
}

export async function chatWithAI(question, tasks) {
  const today = new Date().toISOString().split('T')[0];
  const prompt =
`You are a helpful personal task assistant.
The user's tasks are listed below in JSON.

Tasks:
${JSON.stringify(tasks, null, 2)}

Today is ${today}.
Answer the user's question clearly and concisely. Reference tasks by title when relevant.

User: "${question}"`;

  return await callGemini(prompt);
}

export async function generateBriefing(tasks) {
  const today = new Date().toISOString().split('T')[0];
  const prompt =
`You are a personal productivity assistant.
Generate a short morning briefing (3–5 sentences) based on the user's task list.

Tasks:
${JSON.stringify(tasks, null, 2)}

Today is ${today}.

Cover: (1) tasks due today, (2) any overdue tasks, (3) a suggested top priority.
Tone: warm and motivating. Return plain text only — no markdown, no bullet points.`;

  return await callGemini(prompt);
}

export async function parseMeal(rawInput) {
  const prompt =
`You are a nutrition parser. Extract structured nutrition data from the user's meal log.

User input: "${rawInput}"

Return ONLY a valid JSON object (no markdown, no explanation) with realistic estimates:
{
  "name": "clean meal name",
  "grams": number (estimated portion weight in grams if user didn't specify),
  "calories": number (kcal),
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams)
}

Be reasonable with estimates. If user says "a banana" assume ~120g. Numbers must be integers.`;

  try {
    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      name:     String(parsed.name || rawInput),
      grams:    Number(parsed.grams) || 0,
      calories: Math.round(Number(parsed.calories) || 0),
      protein:  Math.round(Number(parsed.protein) || 0),
      carbs:    Math.round(Number(parsed.carbs) || 0),
      fat:      Math.round(Number(parsed.fat) || 0)
    };
  } catch {
    return { name: rawInput, grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0, _failed: true };
  }
}
