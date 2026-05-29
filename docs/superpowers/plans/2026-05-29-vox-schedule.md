# Vox Schedule Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the removed Meals tab with a Schedule tracker that supports one-off events and weekday-or-interval routines, AI-parsed via Gemini, synced to Supabase with realtime.

**Architecture:** New `trackers/schedule.js` module following the tracker contract (mount/unmount/getContext/refresh). Two Postgres tables (`schedule_items`, `schedule_completions`) with owner-only RLS. Two localStorage keys mirrored through `cloud.js`. Today timeline (6am–11pm hour grid) is the default view. AI-parsed input bar matches the Tasks pattern.

**Tech Stack:** Vanilla JS ES modules (no build), Supabase JS via esm.sh, Gemini REST, Web Speech API. Same patterns as existing trackers.

**Spec reference:** `docs/superpowers/specs/2026-05-29-vox-schedule-design.md`.

---

## File Structure

- `trackers/schedule.js` — new tracker module (~400 lines: template, render, day nav, modal, AI input).
- `gemini.js` — add `parseScheduleItem(raw, today)`; extend `chatWithAI` and `generateBriefing` prompts.
- `cloud.js` — add `pushScheduleItems`, `pullScheduleItems`, `pushScheduleDone`, `pullScheduleDone`; register in PUSHERS/PULLERS; add realtime channels.
- `app.js` — import schedule, add to `TRACKERS`, extend `buildFullContext`.
- `index.html` — restore the tab bar button (now `data-tab="schedule"`), bump cache version.
- `style.css` — add `body[data-tab="schedule"]` accent and timeline/block/modal styles.
- Supabase: new migration `vox_schedule_schema`.

---

## Task 1: Supabase schema + RLS + realtime

**Files:**
- Migration only — no source files.

- [ ] **Step 1: Apply migration `vox_schedule_schema`**

Use the Supabase MCP `apply_migration` tool against project `ixmixxsggtghtlzlxbfk`:

```sql
create table public.schedule_items (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('event','routine')),
  title text not null,
  start_time text not null,
  end_time text,
  category text default 'other',
  notes text,
  date date,
  weekdays int[],
  interval_days int default 1,
  created_at timestamptz default now()
);

create table public.schedule_completions (
  item_id uuid not null references public.schedule_items(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  completed_at timestamptz default now(),
  primary key (item_id, date)
);

alter table public.schedule_items       enable row level security;
alter table public.schedule_completions enable row level security;

create policy "own_schedule_items"       on public.schedule_items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own_schedule_completions" on public.schedule_completions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.schedule_items;
alter publication supabase_realtime add table public.schedule_completions;
```

- [ ] **Step 2: Verify tables present**

Run `list_tables` for schemas `['public']` and confirm both tables appear with the columns above.

- [ ] **Step 3: Verify RLS active**

```sql
select tablename, rowsecurity from pg_tables
where tablename in ('schedule_items','schedule_completions');
```
Expected: both `rowsecurity = true`.

---

## Task 2: cloud.js sync layer for schedule

**Files:**
- Modify: `cloud.js`

- [ ] **Step 1: Add push/pull for `schedule_items`**

After the existing `pushWeightGoal` / `pullWeightGoal` blocks add:

```js
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
```

- [ ] **Step 2: Add push/pull for `schedule_completions`**

```js
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
```

- [ ] **Step 3: Register in PUSHERS / PULLERS / pushAll / pullAll**

Update the four orchestrator objects/functions:

```js
async function pushAll() {
  await pushHabits();
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
```

Realtime `subscribeAll` already iterates `Object.keys(PULLERS)` — both new tables get subscribed automatically.

- [ ] **Step 4: Smoke test in browser**

Open `localhost:8080`, in DevTools console:
```js
localStorage.setItem('vox_schedule_items', JSON.stringify([{ id: crypto.randomUUID(), kind: 'event', title: 'Probe', startTime: '09:00', endTime: '10:00', category: 'work', date: new Date().toISOString().slice(0,10), createdAt: new Date().toISOString() }]));
window.dispatchEvent(new StorageEvent('storage'));
```
Then call `pushLocal('vox_schedule_items')` via the imported module by reloading. Verify via Supabase MCP `execute_sql`:
```sql
select id, title from public.schedule_items;
```
Expected: row present.

- [ ] **Step 5: Commit**

```bash
git add cloud.js
git commit -m "feat(cloud): sync schedule_items + schedule_completions"
```

---

## Task 3: gemini.js — parseScheduleItem + prompt context

**Files:**
- Modify: `gemini.js`

- [ ] **Step 1: Add `parseScheduleItem`**

After `parseTask`:

```js
export async function parseScheduleItem(rawInput, viewDate) {
  const today = localToday();
  const prompt =
`You are a schedule parser. Extract a structured schedule entry from the user's input.

User input: "${rawInput}"

Today's date is ${today}. Currently viewing ${viewDate}.

Return ONLY a valid JSON object (no markdown, no explanation) with these exact fields:
{
  "title":        "clean event title",
  "kind":         "event" | "routine",
  "startTime":    "HH:MM in 24h",
  "endTime":      "HH:MM in 24h or null",
  "date":         "YYYY-MM-DD or null (required when kind=event)",
  "weekdays":     [0..6] or null (Sun=0, required when kind=routine),
  "intervalDays": 1,
  "category":     "work | health | personal | other"
}

Resolve relative dates like "tomorrow", "next Friday". For routines use phrases like "every day", "weekdays", "every monday wednesday friday", "every 2 days".`;

  try {
    const text = await callGemini(prompt);
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!parsed.title || !parsed.startTime) throw new Error('missing fields');
    return parsed;
  } catch {
    return {
      title: rawInput, kind: 'event',
      startTime: '09:00', endTime: null,
      date: viewDate, weekdays: null, intervalDays: 1,
      category: 'other', _failed: true
    };
  }
}
```

- [ ] **Step 2: Extend `chatWithAI` prompt**

Add a `SCHEDULE` section just before the `Answer the user concisely.` line:

```js
SCHEDULE (today + next 3 days):
${JSON.stringify(fullContext.schedule ?? {}, null, 2)}
```

- [ ] **Step 3: Extend `generateBriefing` prompt**

Append after the WEIGHT line:

```js
SCHEDULE (today): ${JSON.stringify(fullContext.schedule?.today ?? [])}
```

And update the `Cover what's relevant from:` line to include "first scheduled event of the day, busy stretches, overlapping items."

- [ ] **Step 4: Commit**

```bash
git add gemini.js
git commit -m "feat(gemini): parseScheduleItem + schedule context in chat/briefing"
```

---

## Task 4: trackers/schedule.js — skeleton + day navigation + occurrence builder

**Files:**
- Create: `trackers/schedule.js`

- [ ] **Step 1: Write module skeleton with day navigation and empty timeline**

```js
import { get, set } from '../storage.js?v=15';
import { parseScheduleItem, hasApiKey } from '../gemini.js?v=15';
import { isSupported, createRecognition } from '../speech.js?v=15';

const ITEMS_KEY = 'vox_schedule_items';
const DONE_KEY  = 'vox_schedule_done';
const HOUR_PX   = 64;
const START_HR  = 6;
const END_HR    = 23;

let removers = [];
let container = null;
let viewDate  = todayStr();
let recognition = null, isListening = false;

export function mount(el) {
  container = el;
  // Clear stuck parsing rows from prior crashed mount.
  const all = get(ITEMS_KEY, []);
  if (all.some(i => i._parsing)) {
    set(ITEMS_KEY, all.map(i => i._parsing ? { ...i, _parsing: false, _failed: true } : i));
  }
  render();
}
export function unmount() {
  if (isListening) { try { recognition?.stop(); } catch {} }
  removers.forEach(fn => fn()); removers = [];
  document.querySelectorAll('.modal-backdrop[data-from="schedule"]').forEach(m => m.remove());
  container = null;
}
export function refresh() { if (container) render(); }
export function getContext() {
  return {
    today:    occurrencesFor(todayStr()),
    upcoming: [1,2,3].flatMap(d => occurrencesFor(shiftDate(todayStr(), d)))
  };
}

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(new Date()); }
function shiftDate(s, n) { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return localDateStr(d); }
function weekdayOf(s) { return new Date(s + 'T00:00:00').getDay(); }
function daysBetween(a, b) { return Math.floor((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000); }
function toMin(t) { const [h,m] = t.split(':').map(Number); return h*60 + m; }
function fmtDayLabel(s) {
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' });
}

function occurrencesFor(date) {
  const items = get(ITEMS_KEY, []);
  const done  = get(DONE_KEY, []);
  const doneSet = new Set(done.map(d => `${d.itemId}::${d.date}`));
  const wd = weekdayOf(date);
  return items
    .filter(i => {
      if (i._parsing) return i.date === date || i.kind === 'event';
      if (i.kind === 'event')   return i.date === date;
      if (i.kind === 'routine') {
        if (!Array.isArray(i.weekdays) || !i.weekdays.includes(wd)) return false;
        const anchor = (i.createdAt || '').slice(0, 10);
        const offset = anchor ? daysBetween(anchor, date) : 0;
        return offset >= 0 && offset % Math.max(1, i.intervalDays || 1) === 0;
      }
      return false;
    })
    .map(i => ({ ...i, done: doneSet.has(`${i.id}::${date}`) }))
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
}

function render() {
  const dayLabel = viewDate === todayStr() ? `Today · ${fmtDayLabel(viewDate)}` : fmtDayLabel(viewDate);
  const occs = occurrencesFor(viewDate);

  container.innerHTML = `
    <div class="tracker-header">
      <h2 class="tracker-title">Schedule</h2>
      ${viewDate !== todayStr() ? '<button class="link-btn" id="jump-today">Today</button>' : ''}
    </div>

    <div class="day-nav">
      <button class="day-arrow" id="day-prev" aria-label="Previous day">&#9664;</button>
      <span class="day-label" id="day-label">${dayLabel}</span>
      <button class="day-arrow" id="day-next" aria-label="Next day">&#9654;</button>
    </div>

    <div class="schedule-timeline" id="timeline" style="height:${(END_HR - START_HR + 1) * HOUR_PX}px">
      ${hoursMarkup()}
      ${nowLineMarkup()}
      ${occs.map(o => blockMarkup(o)).join('')}
      ${occs.length === 0 ? '<div class="schedule-empty">Nothing scheduled — tap ＋ or speak below.</div>' : ''}
    </div>

    <div class="meal-input-bar">
      <input id="sched-input" type="text" class="task-input"
        placeholder="${hasApiKey() ? 'Speak or type an event…' : 'Add Gemini key for natural language'}">
      <button id="mic-sched" class="mic-btn" aria-label="Voice input">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/>
          <path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
      <button id="sched-send" class="add-btn" ${hasApiKey() ? '' : 'disabled'} aria-label="Add event">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <button class="fab" id="fab-add" aria-label="Add scheduled item">＋</button>
  `;

  wireNav();
  wireBlocks(occs);
  wireInputBar();
  on(container.querySelector('#fab-add'), 'click', () => openModal(null));
  const jumpBtn = container.querySelector('#jump-today');
  if (jumpBtn) on(jumpBtn, 'click', () => { viewDate = todayStr(); render(); });
}

function hoursMarkup() {
  let s = '';
  for (let h = START_HR; h <= END_HR; h++) {
    s += `<div class="hour-row" style="top:${(h - START_HR) * HOUR_PX}px"><span class="hour-label">${String(h).padStart(2,'0')}:00</span></div>`;
  }
  return s;
}

function nowLineMarkup() {
  if (viewDate !== todayStr()) return '';
  const now = new Date();
  const minOffset = now.getHours() * 60 + now.getMinutes() - START_HR * 60;
  if (minOffset < 0 || minOffset > (END_HR - START_HR + 1) * 60) return '';
  const top = (minOffset / 60) * HOUR_PX;
  return `<div class="now-line" style="top:${top}px"></div>`;
}

function blockMarkup(o) {
  const startMin = toMin(o.startTime) - START_HR * 60;
  const durMin = Math.max(30, o.endTime ? (toMin(o.endTime) - toMin(o.startTime)) : 30);
  const top = (startMin / 60) * HOUR_PX;
  const height = (durMin / 60) * HOUR_PX;
  const cat = o.category || 'other';
  return `
    <div class="sched-block cat-${cat} ${o.done ? 'done' : ''} ${o._parsing ? 'parsing' : ''}"
         data-id="${o.id}" style="top:${top}px;height:${height}px">
      <div class="sched-block-title">${escapeHtml(o.title)}</div>
      <div class="sched-block-time">${o.startTime}${o.endTime ? '–' + o.endTime : ''}${o._parsing ? ' · parsing…' : ''}</div>
      <button class="sched-block-more" aria-label="More actions" data-id="${o.id}">⋯</button>
    </div>
  `;
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

(Day nav, blocks, input bar, and modal wiring functions get added in later tasks. Define stubs so this file parses:)

```js
function wireNav()      { /* Task 4 step 2 */ }
function wireBlocks()   { /* Task 7 */ }
function wireInputBar() { /* Task 6 */ }
function openModal()    { /* Task 5 */ }
```

- [ ] **Step 2: Implement `wireNav`**

Replace the `wireNav` stub:

```js
function wireNav() {
  on(container.querySelector('#day-prev'), 'click', () => { viewDate = shiftDate(viewDate, -1); render(); });
  on(container.querySelector('#day-next'), 'click', () => { viewDate = shiftDate(viewDate,  1); render(); });
  on(container.querySelector('#day-label'), 'click', () => {
    const inp = document.createElement('input');
    inp.type = 'date'; inp.value = viewDate;
    inp.style.position = 'absolute'; inp.style.opacity = '0';
    document.body.appendChild(inp);
    inp.addEventListener('change', () => {
      if (inp.value) { viewDate = inp.value; render(); }
      inp.remove();
    });
    inp.showPicker?.();
    setTimeout(() => inp.click(), 0);
  });
}
```

- [ ] **Step 3: Smoke test occurrence math (manual)**

In DevTools after wiring tab (Task 9):
```js
localStorage.setItem('vox_schedule_items', JSON.stringify([
  { id: '1', kind: 'event',   title: 'Meet', startTime: '10:00', endTime: '11:00', date: '2026-05-29', category: 'work', createdAt: '2026-05-29T00:00:00Z' },
  { id: '2', kind: 'routine', title: 'Stretch', startTime: '07:00', endTime: '07:15', weekdays: [1,3,5], intervalDays: 1, category: 'health', createdAt: '2026-05-25T00:00:00Z' }
]));
```
Navigate to Schedule tab — only the event appears on 2026-05-29 (Fri). Click ◀ four times to 2026-05-25 (Mon) — Stretch appears. Verify Tue (no Stretch).

- [ ] **Step 4: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): module skeleton, day nav, occurrence builder, timeline grid"
```

---

## Task 5: Add/Edit modal

**Files:**
- Modify: `trackers/schedule.js`

- [ ] **Step 1: Implement `openModal(existing)`**

Replace the `openModal` stub:

```js
function openModal(existing) {
  const isEdit = !!existing;
  const seed = existing || {
    title: '', kind: 'event',
    startTime: '09:00', endTime: '',
    category: 'personal', notes: '',
    date: viewDate, weekdays: [0,1,2,3,4,5,6], intervalDays: 1
  };

  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.dataset.from = 'schedule';
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">${isEdit ? 'Edit' : 'New'} schedule item</h3>
      <input id="s-title" class="modal-input" placeholder="Title" value="${escapeHtml(seed.title)}">

      <div class="kind-row">
        <button data-k="event"   class="kind-btn ${seed.kind === 'event'   ? 'selected' : ''}">One-off</button>
        <button data-k="routine" class="kind-btn ${seed.kind === 'routine' ? 'selected' : ''}">Routine</button>
      </div>

      <div class="time-row">
        <label>Start <input type="time" id="s-start" value="${seed.startTime}"></label>
        <label>End <input type="time" id="s-end" value="${seed.endTime || ''}"></label>
      </div>

      <div class="cat-row">
        ${['work','health','personal','other'].map(c => `
          <button class="cat-chip cat-${c} ${seed.category === c ? 'selected' : ''}" data-c="${c}">${c}</button>
        `).join('')}
      </div>

      <div id="event-fields" style="display:${seed.kind === 'event' ? 'block' : 'none'}">
        <label class="block-label">Date <input type="date" id="s-date" value="${seed.date || viewDate}"></label>
      </div>

      <div id="routine-fields" style="display:${seed.kind === 'routine' ? 'block' : 'none'}">
        <div class="wd-row">
          ${['S','M','T','W','T','F','S'].map((l,i) => `
            <button class="wd-chip ${seed.weekdays?.includes(i) ? 'selected' : ''}" data-w="${i}">${l}</button>
          `).join('')}
        </div>
        <label class="block-label">Every <input type="number" id="s-interval" min="1" value="${seed.intervalDays || 1}" style="width:4rem"> days</label>
      </div>

      <textarea id="s-notes" class="modal-input" placeholder="Notes (optional)">${escapeHtml(seed.notes || '')}</textarea>

      <div class="modal-actions">
        ${isEdit ? '<button class="btn-secondary" id="s-delete" style="margin-right:auto;color:var(--red)">Delete</button>' : ''}
        <button class="btn-secondary" id="s-cancel">Cancel</button>
        <button class="btn-save" id="s-save" disabled>${isEdit ? 'Save' : 'Add'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  let state = { ...seed };
  const titleEl   = modal.querySelector('#s-title');
  const saveBtn   = modal.querySelector('#s-save');
  const eventFs   = modal.querySelector('#event-fields');
  const routineFs = modal.querySelector('#routine-fields');

  const refresh = () => {
    const ok = state.title.trim() && state.startTime &&
      (state.kind === 'event'
        ? !!state.date
        : (state.weekdays?.length > 0 && state.intervalDays >= 1));
    saveBtn.disabled = !ok;
  };

  on(titleEl, 'input', () => { state.title = titleEl.value; refresh(); });

  modal.querySelectorAll('.kind-btn').forEach(b => on(b, 'click', () => {
    state.kind = b.dataset.k;
    modal.querySelectorAll('.kind-btn').forEach(x => x.classList.toggle('selected', x === b));
    eventFs.style.display   = state.kind === 'event'   ? 'block' : 'none';
    routineFs.style.display = state.kind === 'routine' ? 'block' : 'none';
    refresh();
  }));

  modal.querySelectorAll('.cat-chip').forEach(b => on(b, 'click', () => {
    state.category = b.dataset.c;
    modal.querySelectorAll('.cat-chip').forEach(x => x.classList.toggle('selected', x === b));
  }));

  modal.querySelectorAll('.wd-chip').forEach(b => on(b, 'click', () => {
    const w = +b.dataset.w;
    const set = new Set(state.weekdays || []);
    if (set.has(w)) set.delete(w); else set.add(w);
    state.weekdays = [...set].sort();
    b.classList.toggle('selected');
    refresh();
  }));

  on(modal.querySelector('#s-start'), 'change', e => { state.startTime = e.target.value; refresh(); });
  on(modal.querySelector('#s-end'),   'change', e => { state.endTime   = e.target.value || ''; });
  const dateInp = modal.querySelector('#s-date');
  if (dateInp) on(dateInp, 'change', e => { state.date = e.target.value; refresh(); });
  const intInp = modal.querySelector('#s-interval');
  on(intInp, 'change', e => { state.intervalDays = Math.max(1, +e.target.value || 1); refresh(); });
  on(modal.querySelector('#s-notes'), 'input', e => { state.notes = e.target.value; });

  on(modal.querySelector('#s-cancel'), 'click', () => modal.remove());
  on(modal, 'click', e => { if (e.target === modal) modal.remove(); });
  if (isEdit) on(modal.querySelector('#s-delete'), 'click', () => {
    if (confirm('Delete this item? Past completions are removed too.')) {
      set(ITEMS_KEY, get(ITEMS_KEY, []).filter(x => x.id !== existing.id));
      set(DONE_KEY,  get(DONE_KEY,  []).filter(d => d.itemId !== existing.id));
      modal.remove();
      render();
    }
  });
  on(saveBtn, 'click', () => {
    const all = get(ITEMS_KEY, []);
    if (isEdit) {
      set(ITEMS_KEY, all.map(x => x.id === existing.id ? { ...x, ...state, createdAt: x.createdAt } : x));
    } else {
      all.unshift({
        id: crypto.randomUUID(),
        kind: state.kind,
        title: state.title.trim(),
        startTime: state.startTime,
        endTime: state.endTime || null,
        category: state.category,
        notes: state.notes,
        date:        state.kind === 'event'   ? state.date     : null,
        weekdays:    state.kind === 'routine' ? state.weekdays : null,
        intervalDays: state.kind === 'routine' ? state.intervalDays : 1,
        createdAt: new Date().toISOString()
      });
      set(ITEMS_KEY, all);
    }
    modal.remove();
    render();
  });

  refresh();
  setTimeout(() => titleEl.focus(), 50);
}
```

- [ ] **Step 2: Manual test**

Click FAB → fill title "Coffee", start 08:00, end 08:30, category Personal, kind One-off, date = today → Save. Block appears on timeline. Click block's ⋯ → modal opens with values prefilled (Task 7 wires this). For now verify FAB add works.

- [ ] **Step 3: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): add/edit modal with kind, category, weekdays"
```

---

## Task 6: AI-parsed input bar + voice

**Files:**
- Modify: `trackers/schedule.js`

- [ ] **Step 1: Implement `wireInputBar`**

Replace the stub:

```js
function wireInputBar() {
  const input = container.querySelector('#sched-input');
  const send  = container.querySelector('#sched-send');
  const mic   = container.querySelector('#mic-sched');

  const submit = async () => {
    const raw = input.value.trim();
    if (!raw || !hasApiKey()) return;
    input.value = '';
    input.disabled = true; send.disabled = true;
    const id = crypto.randomUUID();
    const all = get(ITEMS_KEY, []);
    all.unshift({
      id, _parsing: true, title: raw,
      kind: 'event', startTime: '09:00', endTime: null,
      date: viewDate, weekdays: null, intervalDays: 1,
      category: 'other', notes: '',
      createdAt: new Date().toISOString()
    });
    set(ITEMS_KEY, all);
    render();
    try {
      const parsed = await parseScheduleItem(raw, viewDate);
      const updated = get(ITEMS_KEY, []).map(x =>
        x.id === id
          ? { ...x, ...parsed,
              date:     parsed.kind === 'event'   ? (parsed.date || viewDate) : null,
              weekdays: parsed.kind === 'routine' ? (parsed.weekdays || [0,1,2,3,4,5,6]) : null,
              intervalDays: parsed.intervalDays || 1,
              _parsing: false, _failed: !!parsed._failed }
          : x);
      set(ITEMS_KEY, updated);
    } catch {
      const updated = get(ITEMS_KEY, []).map(x =>
        x.id === id ? { ...x, _parsing: false, _failed: true } : x);
      set(ITEMS_KEY, updated);
    }
    if (!container) return;
    render();
    container.querySelector('#sched-input')?.focus();
  };

  if (input && send) {
    on(send, 'click', submit);
    on(input, 'keydown', e => { if (e.key === 'Enter') submit(); });
  }

  if (mic) {
    if (!isSupported()) {
      mic.classList.add('no-support');
      mic.title = 'Voice input not supported in this browser';
    } else {
      on(mic, 'click', () => {
        if (isListening) { try { recognition?.stop(); } catch {} return; }
        recognition = createRecognition();
        recognition.onresult = e => {
          const t = Array.from(e.results).map(r => r[0].transcript).join('');
          input.value = t;
        };
        recognition.onend = () => { isListening = false; mic.classList.remove('listening'); };
        recognition.onerror = recognition.onend;
        try { recognition.start(); isListening = true; mic.classList.add('listening'); } catch {}
      });
    }
  }
}
```

- [ ] **Step 2: Manual test**

With a real Gemini key in settings, type "tomorrow 3 to 4 pm dentist" → Enter. Block appears with `_parsing` overlay, then settles to a One-off event on tomorrow's date 15:00–16:00 (health/personal). Navigate to tomorrow to confirm.

- [ ] **Step 3: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): AI-parsed input bar + voice"
```

---

## Task 7: Tap-to-done + edit/delete actions

**Files:**
- Modify: `trackers/schedule.js`

- [ ] **Step 1: Implement `wireBlocks`**

Replace stub:

```js
function wireBlocks(occs) {
  container.querySelectorAll('.sched-block').forEach(el => {
    const id = el.dataset.id;
    const item = occs.find(o => o.id === id);
    if (!item) return;

    on(el, 'click', e => {
      if (e.target.classList.contains('sched-block-more')) return;
      toggleDone(item.id, viewDate);
      render();
    });

    const more = el.querySelector('.sched-block-more');
    if (more) on(more, 'click', e => {
      e.stopPropagation();
      openModal(item);
    });
  });
}

function toggleDone(itemId, date) {
  const arr = get(DONE_KEY, []);
  const idx = arr.findIndex(d => d.itemId === itemId && d.date === date);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.unshift({ itemId, date, completedAt: new Date().toISOString() });
  set(DONE_KEY, arr);
}
```

- [ ] **Step 2: Manual test**

Tap a block → strikes through and dims. Tap again → restores. Reload page → state persists. Tap ⋯ → modal opens with the item; Save with changed title; block updates.

- [ ] **Step 3: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): tap-to-done + edit/delete via ⋯ action"
```

---

## Task 8: style.css — schedule timeline, blocks, modal, accent

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Append schedule styles to `style.css`**

```css
/* ── Schedule tab accent ─────────────────────── */
body[data-tab="schedule"] { --accent: #9b7cff; }

/* ── Timeline grid ──────────────────────────── */
.schedule-timeline {
  position: relative;
  margin: .75rem 1rem 1rem;
  padding-left: 3.25rem;
  border-left: 1px solid var(--border);
  overflow: hidden;
  background:
    linear-gradient(to bottom, var(--bg2) 0 1px, transparent 1px) 0 0/100% 64px;
}
.hour-row {
  position: absolute; left: 0; right: 0;
  height: 64px;
  border-top: 1px solid var(--border);
}
.hour-label {
  position: absolute; left: -3rem; top: -.55rem;
  font-family: 'IBM Plex Mono', monospace;
  font-size: .7rem; color: var(--ink3);
}
.now-line {
  position: absolute; left: 0; right: 0; height: 1px;
  background: var(--red, #e35a4d);
  box-shadow: 0 0 0 1px rgba(227,90,77,.3);
  z-index: 3;
}
.schedule-empty {
  position: absolute; left: 0; right: 0;
  top: 40%; text-align: center;
  color: var(--ink3); font-size: .9rem;
}

/* ── Blocks ─────────────────────────────────── */
.sched-block {
  position: absolute; left: .25rem; right: .25rem;
  padding: .35rem .55rem;
  background: var(--bg2);
  border-left: 3px solid var(--accent);
  border-radius: 6px;
  font-size: .85rem;
  overflow: hidden;
  cursor: pointer;
  transition: opacity .15s, background .15s;
}
.sched-block.cat-work     { border-left-color: #ffb454; }
.sched-block.cat-health   { border-left-color: #4cc38a; }
.sched-block.cat-personal { border-left-color: #9b7cff; }
.sched-block.cat-other    { border-left-color: var(--ink3); }
.sched-block.done { opacity: .45; }
.sched-block.done .sched-block-title { text-decoration: line-through; }
.sched-block.parsing { opacity: .55; font-style: italic; }
.sched-block-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sched-block-time  { font-family: 'IBM Plex Mono', monospace; font-size: .7rem; color: var(--ink3); }
.sched-block-more {
  position: absolute; top: 2px; right: 4px;
  background: transparent; border: 0;
  color: var(--ink3); padding: 2px 6px; cursor: pointer;
}

/* ── Modal extras ───────────────────────────── */
.kind-row, .cat-row, .wd-row {
  display: flex; gap: .5rem; flex-wrap: wrap; margin: .5rem 0;
}
.kind-btn, .cat-chip, .wd-chip {
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--ink2);
  padding: .35rem .7rem; border-radius: 999px;
  cursor: pointer; font-size: .8rem;
}
.kind-btn.selected, .cat-chip.selected, .wd-chip.selected {
  background: var(--accent); color: var(--bg);
  border-color: var(--accent);
}
.wd-chip { width: 2rem; padding: .35rem 0; text-align: center; }
.time-row { display: flex; gap: .75rem; margin: .5rem 0; }
.time-row label { display: flex; flex-direction: column; gap: .25rem; font-size: .75rem; color: var(--ink3); flex: 1; }
.block-label { display: flex; flex-direction: column; gap: .25rem; font-size: .75rem; color: var(--ink3); margin: .5rem 0; }
```

- [ ] **Step 2: Bump style.css cache version**

In `index.html`, change `style.css?v=3` → `style.css?v=4`.

- [ ] **Step 3: Visual smoke test**

Reload page on Schedule tab. Verify hour labels gutter, hour rule lines every 64px, sample event blocks have category-colored left bars, modal chips look right.

- [ ] **Step 4: Commit**

```bash
git add style.css index.html
git commit -m "style(schedule): timeline grid, blocks, modal chips, violet accent"
```

---

## Task 9: app.js + index.html wiring

**Files:**
- Modify: `app.js`, `index.html`

- [ ] **Step 1: Restore the tab button as Schedule**

In `index.html`, inside `<nav class="tab-bar">`, append before the closing `</nav>`:

```html
<button class="tab-bar-btn" data-tab="schedule" role="tab" aria-selected="false">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/>
    <path d="M3 9h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
  <span>Schedule</span>
</button>
```

- [ ] **Step 2: Import and register schedule in `app.js`**

```js
import * as schedule from './trackers/schedule.js?v=15';
```
Then in the `TRACKERS` object:
```js
const TRACKERS = { tasks, habits, sleep, weight, schedule };
```
And in `buildFullContext`:
```js
schedule: schedule.getContext()
```

- [ ] **Step 3: Bump cache-bust across all module imports to `?v=15`**

```bash
sed -i '' 's/?v=14/?v=15/g' app.js index.html storage.js trackers/*.js
```

- [ ] **Step 4: Manual test**

Reload `localhost:8080`. Tab bar now shows 5 tabs again with Schedule as the rightmost. Click Schedule → timeline renders. Switch tabs back and forth — Tasks/Habits/Sleep/Weight still work.

- [ ] **Step 5: Commit**

```bash
git add app.js index.html storage.js trackers/*.js
git commit -m "feat(app): wire schedule tab into router + context + cache bump"
```

---

## Task 10: Cross-cutting polish + final review

**Files:**
- Modify: any of the above as needed.

- [ ] **Step 1: Edge case audit**

Verify each item from the spec §8:

| Case | Test |
| --- | --- |
| Past dates show occurrences | Navigate back 5 days; routines render. |
| Cross-midnight rejected | In modal set start=23:30 end=01:00, Save → form refuses (toMin compare). |
| Tab switch during AI parse | Type something, immediately switch tab → no crash, item settles correctly in storage. |
| Routine deleted purges done | Delete a routine; matching done rows disappear (handled in delete handler). |
| Empty weekdays warning | Open routine, deselect all → Save disabled. |
| Realtime echo idempotent | Insert via SQL, view auto-updates without duplicates. |

Add fixes inline where any fail. Cross-midnight validation:

```js
if (state.endTime && toMin(state.endTime) <= toMin(state.startTime)) {
  alert('End time must be later than start time.'); return;
}
```
Place inside the `s-save` click handler before the upsert path.

- [ ] **Step 2: Briefing visibility check**

With at least one event on today, click the header Briefing button. Confirm the response mentions the scheduled item. Otherwise tweak `generateBriefing` to make the SCHEDULE section more prominent.

- [ ] **Step 3: Final commit + tag**

```bash
git add -A
git commit -m "fix(schedule): cross-midnight validation + polish"
git tag vox-v4-schedule
```

- [ ] **Step 4: Manual closing smoke test**

- 5 tabs visible. No console errors.
- Schedule shows today's items immediately on mount.
- AI parse round-trip works.
- Tap-done persists across reload.
- Edit through ⋯ works.
- Delete cascades local done rows.
- Realtime SQL insert appears live.

---

## Self-review

1. **Spec coverage:** Each spec section maps to one or more tasks (§3 → Task 1, §4 → Tasks 4/5/7/8, §5 → Tasks 3 & 6, §6 → Task 2, §7 → Tasks 3 & 9, §8 → Task 10).
2. **Placeholder scan:** No "TBD" / "add error handling" / "similar to". Code blocks contain real implementations.
3. **Type consistency:** Field names (`startTime`, `endTime`, `weekdays`, `intervalDays`, `kind`) are consistent across module, prompt, push, pull, and form. Done key uses `itemId` (camelCase) in localStorage and `item_id` (snake_case) in Postgres consistently.
