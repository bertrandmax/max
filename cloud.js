import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const URL = 'https://ixmixxsggtghtlzlxbfk.supabase.co';
const KEY = 'sb_publishable_vh8G8kSSenaEck5u9E2g_Q_RHNwrVU8';

export const sb = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vox-auth' }
});

const MIGRATED_KEY = 'vox_cloud_migrated';
let userId = null;
let ready  = false;

export function isReady()  { return ready; }
export function getUserId() { return userId; }

// Dev user — replace with real auth (magic link / OAuth) before production.
const DEV_EMAIL = 'vox-dev@example.com';
const DEV_PASS  = 'vox-dev-pass-shhh-2026';

export async function initCloud() {
  let { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const { data, error } = await sb.auth.signInWithPassword({ email: DEV_EMAIL, password: DEV_PASS });
    if (error) throw error;
    session = data.session;
  }
  userId = session.user.id;

  if (!localStorage.getItem(MIGRATED_KEY)) {
    await pushAll();
    localStorage.setItem(MIGRATED_KEY, '1');
  } else {
    await pullAll();
  }
  ready = true;
  subscribeAll();
  emit('vox:cloud-ready');
}

function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

// ── Per-table push (local → cloud) ───────────────────────
async function pushTasks() {
  const arr = read('vox_tasks', []);
  if (!arr.length) return;
  const rows = arr.map(t => ({
    id: t.id,
    user_id: userId,
    title: t.title,
    raw_input: t.rawInput || null,
    priority: t.priority || 'medium',
    category: t.category || 'other',
    due_date: t.dueDate || null,
    due_time: t.dueTime || null,
    completed: !!t.completed,
    created_at: t.createdAt || new Date().toISOString()
  }));
  await sb.from('tasks').upsert(rows);
}
async function pushHabits() {
  const arr = read('vox_habits', []);
  if (!arr.length) return;
  const rows = arr.map(h => ({
    id: h.id, user_id: userId, name: h.name, emoji: h.emoji,
    created_at: h.createdAt || new Date().toISOString()
  }));
  await sb.from('habits').upsert(rows);
}
async function pushHabitLog() {
  const log = read('vox_habit_log', {});
  const rows = [];
  for (const date in log) {
    for (const habitId of log[date]) {
      rows.push({ user_id: userId, habit_id: habitId, date });
    }
  }
  if (rows.length) await sb.from('habit_log').upsert(rows, { onConflict: 'habit_id,date' });
}
async function pushSleep() {
  const arr = read('vox_sleep', []);
  if (!arr.length) return;
  const rows = arr.map(e => ({
    id: e.id, user_id: userId, date: e.date,
    bedtime: e.bedtime, wake: e.wake, hours: e.hours,
    quality: e.quality, note: e.note || null,
    created_at: e.createdAt || new Date().toISOString()
  }));
  await sb.from('sleep').upsert(rows, { onConflict: 'user_id,date' });
}
async function pushWeight() {
  const arr = read('vox_weight', []);
  if (!arr.length) return;
  const rows = arr.map(e => ({
    id: e.id, user_id: userId, date: e.date, weight: e.weight,
    created_at: e.createdAt || new Date().toISOString()
  }));
  await sb.from('weight').upsert(rows, { onConflict: 'user_id,date' });
}
async function pushWeightGoal() {
  const g = read('vox_weight_goal', null);
  if (!g) return;
  await sb.from('weight_goal').upsert({ user_id: userId, value: g.value, unit: g.unit });
}
// ── Per-table pull (cloud → local) ───────────────────────
async function pullTasks() {
  const { data } = await sb.from('tasks').select('*').order('created_at', { ascending: false });
  if (!data) return;
  write('vox_tasks', data.map(r => ({
    id: r.id, title: r.title, rawInput: r.raw_input,
    priority: r.priority, category: r.category,
    dueDate: r.due_date, dueTime: r.due_time,
    completed: r.completed, createdAt: r.created_at
  })));
}
async function pullHabits() {
  const { data } = await sb.from('habits').select('*').order('created_at');
  if (!data) return;
  write('vox_habits', data.map(r => ({
    id: r.id, name: r.name, emoji: r.emoji, createdAt: r.created_at
  })));
}
async function pullHabitLog() {
  const { data } = await sb.from('habit_log').select('habit_id, date');
  if (!data) return;
  const log = {};
  for (const r of data) (log[r.date] ||= []).push(r.habit_id);
  write('vox_habit_log', log);
}
async function pullSleep() {
  const { data } = await sb.from('sleep').select('*').order('date', { ascending: false });
  if (!data) return;
  write('vox_sleep', data.map(r => ({
    id: r.id, date: r.date, bedtime: r.bedtime, wake: r.wake,
    hours: Number(r.hours), quality: r.quality, note: r.note,
    createdAt: r.created_at
  })));
}
async function pullWeight() {
  const { data } = await sb.from('weight').select('*').order('date', { ascending: false });
  if (!data) return;
  write('vox_weight', data.map(r => ({
    id: r.id, date: r.date, weight: Number(r.weight), createdAt: r.created_at
  })));
}
async function pullWeightGoal() {
  const { data } = await sb.from('weight_goal').select('*').limit(1).maybeSingle();
  if (data) write('vox_weight_goal', { value: Number(data.value), unit: data.unit });
  else write('vox_weight_goal', null);
}
async function pushScheduleItems() {
  const arr = read('vox_schedule_items', []);
  if (!arr.length) return;
  const rows = arr
    .filter(i => !i._parsing)
    .map(i => ({
      id: i.id,
      user_id: userId,
      kind: i.kind,
      title: i.title,
      start_time: i.startTime,
      end_time: i.endTime || null,
      category: i.category || 'other',
      notes: i.notes || null,
      date: i.kind === 'event' ? i.date : null,
      weekdays: i.kind === 'routine' ? (i.weekdays || []) : null,
      interval_days: i.kind === 'routine' ? (i.intervalDays || 1) : 1,
      created_at: i.createdAt || new Date().toISOString()
    }));
  if (rows.length) await sb.from('schedule_items').upsert(rows);
}

async function pullScheduleItems() {
  const { data } = await sb.from('schedule_items').select('*').order('created_at', { ascending: false });
  if (!data) return;
  write('vox_schedule_items', data.map(r => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    startTime: r.start_time,
    endTime: r.end_time,
    category: r.category,
    notes: r.notes,
    date: r.date,
    weekdays: r.weekdays,
    intervalDays: r.interval_days,
    createdAt: r.created_at
  })));
}

async function pushScheduleDone() {
  const arr = read('vox_schedule_done', []);
  if (!arr.length) return;
  const rows = arr.map(d => ({
    item_id: d.itemId,
    user_id: userId,
    date: d.date,
    completed_at: d.completedAt || new Date().toISOString()
  }));
  await sb.from('schedule_completions').upsert(rows, { onConflict: 'item_id,date' });
}

async function pullScheduleDone() {
  const { data } = await sb.from('schedule_completions').select('item_id, date, completed_at');
  if (!data) return;
  write('vox_schedule_done', data.map(r => ({
    itemId: r.item_id,
    date: r.date,
    completedAt: r.completed_at
  })));
}
// ── Orchestrators ────────────────────────────────────────
async function pushAll() {
  await pushHabits();      // before habit_log (FK)
  await Promise.all([
    pushTasks(), pushHabitLog(), pushSleep(),
    pushWeight(), pushWeightGoal(),
    pushScheduleItems(), pushScheduleDone()
  ]);
}
async function pullAll() {
  await Promise.all([
    pullTasks(), pullHabits(), pullHabitLog(),
    pullSleep(), pullWeight(), pullWeightGoal(),
    pullScheduleItems(), pullScheduleDone()
  ]);
}

const PUSHERS = {
  vox_tasks: pushTasks, vox_habits: pushHabits, vox_habit_log: pushHabitLog,
  vox_sleep: pushSleep, vox_weight: pushWeight, vox_weight_goal: pushWeightGoal,
  vox_schedule_items: pushScheduleItems, vox_schedule_done: pushScheduleDone
};
const PULLERS = {
  tasks: pullTasks, habits: pullHabits, habit_log: pullHabitLog,
  sleep: pullSleep, weight: pullWeight, weight_goal: pullWeightGoal,
  schedule_items: pullScheduleItems, schedule_completions: pullScheduleDone
};

// Debounced per-key push so rapid edits coalesce
const timers = {};
export function pushLocal(key) {
  if (!ready || !PUSHERS[key]) return;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    PUSHERS[key]().catch(err => console.error('cloud push failed', key, err));
  }, 250);
}

// ── Realtime ─────────────────────────────────────────────
function subscribeAll() {
  for (const table of Object.keys(PULLERS)) {
    sb.channel(`pub:${table}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table, filter: `user_id=eq.${userId}` },
        () => {
          PULLERS[table]().then(() => emit('vox:cloud-change', { table })).catch(() => {});
        })
      .subscribe();
  }
}

// ── Helpers ──────────────────────────────────────────────
function read(key, fb) {
  try { const r = localStorage.getItem(key); return r === null ? fb : JSON.parse(r); }
  catch { return fb; }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
