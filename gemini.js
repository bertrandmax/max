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
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || 'unknown';
    throw new Error(`Gemini returned no text (${reason})`);
  }
  return text;
}

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function parseTask(rawInput) {
  const today = localToday();
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

export async function chatWithAI(question, fullContext) {
  const today = localToday();
  const prompt =
`You are a personal life assistant. The user has multiple trackers — answer using whichever are relevant.

Today: ${today}

TASKS:
${JSON.stringify(fullContext.tasks ?? [], null, 2)}

HABITS (definitions + completion log by date):
${JSON.stringify(fullContext.habits ?? {}, null, 2)}

SLEEP (last 14 entries):
${JSON.stringify(fullContext.sleep ?? [], null, 2)}

WEIGHT (last 30 entries + goal):
${JSON.stringify(fullContext.weight ?? {}, null, 2)}

Answer the user concisely. Reference specific data points (titles, dates, numbers) when useful. If a tracker has no data relevant to the question, ignore it silently.

User: "${question}"`;
  return await callGemini(prompt);
}

export async function generateBriefing(fullContext) {
  const today = localToday();
  const prompt =
`You are a personal productivity assistant. Generate a warm, motivating morning briefing (4–6 sentences, plain text only — no markdown, no bullets).

Today: ${today}

TASKS: ${JSON.stringify(fullContext.tasks ?? [])}
HABITS: ${JSON.stringify(fullContext.habits ?? {})}
SLEEP (last 7): ${JSON.stringify((fullContext.sleep ?? []).slice(0, 7))}
WEIGHT (last 7): ${JSON.stringify({ entries: (fullContext.weight?.entries ?? []).slice(0, 7), goal: fullContext.weight?.goal })}

Cover what's relevant from: tasks due today, overdue tasks, a top priority, any habit streak at risk (yesterday missed), unusual sleep (under 6h two nights running), weight trend.

If a section has no data, skip it silently. Keep it brief.`;
  return await callGemini(prompt);
}

