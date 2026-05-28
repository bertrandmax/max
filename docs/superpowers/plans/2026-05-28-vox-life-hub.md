# Vox v2 — Life Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Vox from a task manager into a unified personal life hub with Habits, Sleep, Weight, and Meals trackers under a bottom-tab navigation, all sharing the existing app shell and global Gemini chat.

**Architecture:** ES-module router. Each tracker is a self-contained module with `mount(container)` / `unmount()` / `getContext()`. Router unmounts old, mounts new on tab switch. localStorage namespaced per tracker. Pure CSS/SVG charts — zero new dependencies.

**Tech Stack:** Vanilla JS (ES modules), HTML, CSS. Google Gemini API. Web Speech API. Playwright MCP for smoke verification (no unit-test framework, per spec's zero-deps constraint).

**Source spec:** `docs/superpowers/specs/2026-05-28-vox-life-hub-design.md`

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `index.html` | Modify | Add bottom tab bar, tracker container, per-tab body class hook |
| `style.css` | Modify | Add tab bar styles, tracker layouts, charts, per-tab accent rules |
| `app.js` | Modify | Becomes router; delegates UI to active tracker; builds chat context from all trackers |
| `storage.js` | Modify | Add generic `get(key, default)` / `set(key, val)` helpers; keep existing task helpers |
| `gemini.js` | Modify | Add `parseMeal(rawInput)`; extend chat + briefing prompts |
| `trackers/tasks.js` | Create | Existing Tasks logic extracted from `app.js` as a tracker module |
| `trackers/habits.js` | Create | Habit definitions, daily toggle, streak, 7-day grid |
| `trackers/sleep.js` | Create | Log form, bar chart, week stats |
| `trackers/weight.js` | Create | Log, goal, SVG line chart |
| `trackers/meals.js` | Create | Text-input meal log, AI parse, daily totals, day navigator |
| `speech.js` | Untouched | — |

---

## Verification Strategy

Each task ends with a manual verification step run through Playwright MCP. Tester:
1. Starts local server (`python3 -m http.server 8080`) if not running
2. Navigates to `http://localhost:8080`
3. Performs the stated user actions
4. Confirms stated visible outcome
5. Checks console for errors (none expected unless task notes otherwise)
6. Refreshes page and confirms persistence where relevant

Commits happen at the end of each task. Commit messages use Conventional Commits.

---

## Task 1: Generic storage helpers + active-tab persistence

**Files:**
- Modify: `storage.js` (add generic helpers)
- Modify: `app.js` (no behavior change yet; just import the new helpers — verify nothing broke)

- [ ] **Step 1: Add generic helpers to `storage.js`**

Append below existing task functions:

```js
// ── Generic helpers (any tracker) ────────────
export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('storage.set failed', key, err);
  }
}

export function push(key, item) {
  const arr = get(key, []);
  arr.unshift(item);
  set(key, arr);
  return item;
}

export function remove(key, id) {
  set(key, get(key, []).filter(x => x.id !== id));
}
```

- [ ] **Step 2: Verify no regression**

Hard-refresh `http://localhost:8080`. Existing Tasks tab still works: add a task, toggle, delete, filter, refresh. No console errors.

- [ ] **Step 3: Commit**

```bash
git add storage.js
git commit -m "feat(storage): add generic get/set/push/remove helpers"
```

---

## Task 2: Extract Tasks logic into `trackers/tasks.js`

**Files:**
- Create: `trackers/tasks.js`
- Modify: `app.js` (delegate Tasks rendering to the new module; keep router-less single-tab behavior until Task 3 adds the router)

This is a pure refactor — visible behavior must be identical.

- [ ] **Step 1: Create `trackers/tasks.js` with the module interface**

Move from `app.js` into the new file: `currentFilter`, `renderTasks`, `buildTaskEl`, `handleAddTask`, voice setup, briefing handlers, plus all task-only DOM references. Export:

```js
// trackers/tasks.js
import { getTasks, addTask, deleteTask, toggleTask, updateTask } from '../storage.js';
import { parseTask, hasApiKey, generateBriefing } from '../gemini.js';
import { isSupported, createRecognition } from '../speech.js';

let unmountFns = [];

export function mount(container) {
  // container is unused for Tasks since its DOM lives in index.html;
  // here we just attach listeners and do the initial render.
  setupVoice();
  setupTaskEvents();
  renderTasks();
}

export function unmount() {
  unmountFns.forEach(fn => fn());
  unmountFns = [];
}

export function getContext() {
  return getTasks();
}

// ... (all the existing helper functions, but track every addEventListener
// via a small `on(el, evt, fn)` helper that pushes a remover into unmountFns)
```

Add a small listener helper inside the module:

```js
function on(el, evt, fn) {
  el.addEventListener(evt, fn);
  unmountFns.push(() => el.removeEventListener(evt, fn));
}
```

Replace every `addEventListener` with `on(...)` so `unmount()` cleans up cleanly.

- [ ] **Step 2: Slim `app.js` down to a thin bootstrap**

```js
// app.js
import * as tasks from './trackers/tasks.js';

function init() {
  tasks.mount();
}

init();
```

(Keep API-key settings + chat wiring in `app.js` for now — Task 4 will move chat into the router. Tasks tab logic now lives in `trackers/tasks.js`.)

- [ ] **Step 3: Verify no regression via Playwright MCP**

1. `python3 -m http.server 8080` if not running.
2. Navigate to `http://localhost:8080`.
3. Add task "Buy milk". Confirm appears.
4. Toggle complete. Confirm strikethrough.
5. Click filter "Done". Confirm only completed visible.
6. Click filter "All". Refresh page. Confirm task persists.
7. Click mic button — confirm voice overlay appears (then close it).
8. Console: no errors.

- [ ] **Step 4: Commit**

```bash
git add app.js trackers/tasks.js
git commit -m "refactor(tasks): extract Tasks logic into trackers/tasks.js module"
```

---

## Task 3: Add tab bar + router with empty placeholder tabs

**Files:**
- Modify: `index.html`
- Modify: `style.css`
- Modify: `app.js`
- Create: `trackers/habits.js`, `trackers/sleep.js`, `trackers/weight.js`, `trackers/meals.js` (placeholder shells)

- [ ] **Step 1: Add placeholder tracker shells**

Each of the four new files starts as:

```js
// trackers/habits.js (mirror for sleep.js, weight.js, meals.js — change name)
export function mount(container) {
  container.innerHTML = `
    <div class="tracker-empty">
      <div class="empty-icon">◎</div>
      <p class="empty-title">Habits</p>
      <p class="empty-sub">Coming next.</p>
    </div>
  `;
}
export function unmount() {}
export function getContext() { return null; }
```

- [ ] **Step 2: Add tab-bar markup + tracker container to `index.html`**

Inside `<div id="app">`, replace the existing `<main id="task-list">`, `<div id="empty-state">`, `<div class="filter-tabs">`, AND the `<div class="input-bar">` with a single tracker root:

```html
<main id="tracker-root" class="tracker-root" aria-live="polite"></main>
```

(The Tasks tracker module re-builds its own filter tabs / input bar inside the root in Task 5.)

Add the tab bar just before `</body>` (after the chat panel):

```html
<nav class="tab-bar" role="tablist" aria-label="Sections">
  <button class="tab-bar-btn" data-tab="tasks" role="tab" aria-selected="true">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 11l3 3L22 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Tasks</span>
  </button>
  <button class="tab-bar-btn" data-tab="habits" role="tab" aria-selected="false">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/>
      <circle cx="12" cy="12" r="3" fill="currentColor"/>
    </svg>
    <span>Habits</span>
  </button>
  <button class="tab-bar-btn" data-tab="sleep" role="tab" aria-selected="false">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    <span>Sleep</span>
  </button>
  <button class="tab-bar-btn" data-tab="weight" role="tab" aria-selected="false">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 4h12l2 16H4L6 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
      <path d="M9 9l3-3 3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Weight</span>
  </button>
  <button class="tab-bar-btn" data-tab="meals" role="tab" aria-selected="false">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11h18M5 11v10h14V11M9 4v7M15 4v7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Meals</span>
  </button>
</nav>
```

- [ ] **Step 3: Add tab-bar + tracker-root + accent-class styles to `style.css`**

```css
/* ── Tab bar ─────────────────────────────────── */
:root { --tabbar-h: 64px; }

.tab-bar {
  position: fixed;
  bottom: 0; left: 0; right: 0;
  z-index: 110;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  background: rgba(11, 11, 13, 0.95);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border-top: 1px solid var(--border);
  height: var(--tabbar-h);
  padding-bottom: env(safe-area-inset-bottom);
}

.tab-bar-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  color: var(--ink3);
  font-size: 0.66rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  transition: color 0.15s;
}

.tab-bar-btn:hover { color: var(--ink2); }
.tab-bar-btn[aria-selected="true"] { color: var(--tab-accent, var(--accent)); }

/* per-tab accents driven by body[data-tab] */
body[data-tab="tasks"]  .tab-bar-btn[data-tab="tasks"]  { --tab-accent: var(--accent); }
body[data-tab="habits"] .tab-bar-btn[data-tab="habits"] { --tab-accent: var(--green);  }
body[data-tab="sleep"]  .tab-bar-btn[data-tab="sleep"]  { --tab-accent: var(--slate);  }
body[data-tab="weight"] .tab-bar-btn[data-tab="weight"] { --tab-accent: var(--yellow); }
body[data-tab="meals"]  .tab-bar-btn[data-tab="meals"]  { --tab-accent: var(--red);    }

/* ── Tracker root + chat shift ───────────────── */
.tracker-root { flex: 1; display: flex; flex-direction: column; }

/* Chat panel must now sit above tab bar */
.chat-panel { bottom: var(--tabbar-h); }
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .chat-panel { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); }
}

/* App bottom padding shifts to leave room for tab bar */
#app { padding-bottom: calc(var(--chatbar-h) + var(--tabbar-h) + env(safe-area-inset-bottom, 0px)); }

/* Generic tracker empty state */
.tracker-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--ink3);
}
```

(Note: when Tasks tab is active, its module re-injects the existing `.input-bar` + filter UI into `#tracker-root`. The input bar's existing `position: fixed; bottom` rule needs to be updated so it sits above the tab bar — adjust in Task 5.)

- [ ] **Step 4: Convert `app.js` into the router**

```js
// app.js
import { get, set } from './storage.js';
import * as tasks  from './trackers/tasks.js';
import * as habits from './trackers/habits.js';
import * as sleep  from './trackers/sleep.js';
import * as weight from './trackers/weight.js';
import * as meals  from './trackers/meals.js';
import { setApiKey, getApiKey, hasApiKey, chatWithAI, generateBriefing } from './gemini.js';

const TRACKERS = { tasks, habits, sleep, weight, meals };
const $ = id => document.getElementById(id);
const trackerRoot = $('tracker-root');

let active = null;
let activeName = null;

function switchTab(name) {
  if (name === activeName) return;
  if (active?.unmount) active.unmount();
  trackerRoot.innerHTML = '';
  document.body.dataset.tab = name;
  document.querySelectorAll('.tab-bar-btn').forEach(b => {
    b.setAttribute('aria-selected', b.dataset.tab === name);
  });
  active = TRACKERS[name];
  activeName = name;
  active.mount(trackerRoot);
  set('vox_active_tab', name);
}

function init() {
  document.querySelectorAll('.tab-bar-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  const initial = get('vox_active_tab', 'tasks');
  switchTab(TRACKERS[initial] ? initial : 'tasks');

  // settings + chat wiring kept in app.js (unchanged from earlier)
  wireSettings();
  wireChat();
}

// wireSettings() and wireChat() are direct copies of the existing
// settings + chat code from app.js (loadApiKey, saveKey, testKey,
// toggleChat, handleChat, appendMsg). Chat will be upgraded to use
// full context in Task 8.

init();
```

(Paste the existing `wireSettings` / `wireChat` helpers verbatim — they stay unchanged in this task.)

- [ ] **Step 5: Verify via Playwright MCP**

1. Navigate `localhost:8080`. Confirm tab bar visible bottom, Tasks tab selected, Tasks UI loads (input + list).
2. Tap Habits / Sleep / Weight / Meals — each shows "Coming next." placeholder.
3. Tap Tasks again — Tasks UI restored, previously-added task still there.
4. Active tab icon shows correct accent color (amber/green/violet/yellow/red).
5. Refresh after switching to Habits — Habits tab still active (persisted).
6. Console: no errors.

- [ ] **Step 6: Commit**

```bash
git add index.html style.css app.js trackers/
git commit -m "feat(router): bottom tab bar + placeholder trackers for Habits/Sleep/Weight/Meals"
```

---

## Task 4: Tasks tracker — adapt to mount into `#tracker-root`

**Files:**
- Modify: `trackers/tasks.js`
- Modify: `style.css` (shift `.input-bar` bottom offset)
- Modify: `index.html` (remove the now-duplicate task UI nodes from the static shell — they belong inside the tracker module)

Tasks must now own its own DOM (filter tabs, task list, empty state, input bar) so the router can swap it out.

- [ ] **Step 1: Move task UI from `index.html` into a template string in `tasks.js`**

In `trackers/tasks.js`, define and render:

```js
const TEMPLATE = `
  <div id="no-key-banner" class="no-key-banner hidden">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
      <path d="M12 8v4M12 16h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    </svg>
    <span>AI features need a Gemini key — <button id="open-settings-inline" class="inline-btn">add one</button></span>
  </div>
  <div class="filter-tabs" role="tablist">
    <button class="tab active" data-filter="all" role="tab" aria-selected="true">All</button>
    <button class="tab" data-filter="active" role="tab" aria-selected="false">Active</button>
    <button class="tab" data-filter="completed" role="tab" aria-selected="false">Done</button>
    <div class="tab-count" id="task-count"></div>
  </div>
  <main id="task-list" class="task-list" role="list" aria-label="Task list"></main>
  <div id="empty-state" class="empty-state">
    <div class="empty-icon">◎</div>
    <p class="empty-title">All clear</p>
    <p class="empty-sub">Speak or type a task below.</p>
  </div>
  <div class="input-bar" id="task-input-bar">
    <button id="mic-btn" class="mic-btn" aria-label="Voice input">… (existing SVG)</button>
    <input id="task-input" type="text" class="task-input" placeholder="Add a task or speak…" autocomplete="off" spellcheck="false" aria-label="New task">
    <button id="add-btn" class="add-btn" aria-label="Add task">… (existing SVG)</button>
  </div>
`;

export function mount(container) {
  container.innerHTML = TEMPLATE;
  setupVoice();
  setupTaskEvents();
  renderTasks();
  if (!hasApiKey()) container.querySelector('#no-key-banner').classList.remove('hidden');
}
```

The full SVGs from `index.html` should be pasted inline (no abbreviation — engineers reading out-of-order need everything).

Delete those same nodes (`#no-key-banner`, `.filter-tabs`, `#task-list`, `#empty-state`, `.input-bar`) from `index.html`. The static shell now only has `<header>`, `<div id="settings-panel">`, `<div id="briefing-card">`, `<main id="tracker-root">`, the voice overlay, chat panel, and tab bar.

- [ ] **Step 2: Shift `.input-bar` upward in `style.css`**

```css
.input-bar { bottom: calc(var(--chatbar-h) + var(--tabbar-h) + 8px); }
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .input-bar { bottom: calc(var(--chatbar-h) + var(--tabbar-h) + 8px + env(safe-area-inset-bottom)); }
}
```

- [ ] **Step 3: Make `unmount()` actually tear down**

In `tasks.js`, ensure `unmount()`:
- Calls every remover in `unmountFns`
- Sets `recognition = null` (and aborts if listening)
- Does not touch `#tracker-root` (router clears it)

- [ ] **Step 4: Verify via Playwright MCP**

1. Navigate `localhost:8080`. Tasks loads.
2. Add task "Test mount". Toggle complete. Filter All/Active/Done.
3. Switch to Habits → Tasks input bar disappears.
4. Switch back to Tasks → input bar back, task still there.
5. Refresh — Tasks intact.
6. Console: no duplicate-element errors.

- [ ] **Step 5: Commit**

```bash
git add trackers/tasks.js index.html style.css
git commit -m "refactor(tasks): own full DOM lifecycle inside mount/unmount"
```

---

## Task 5: Habits tracker

**Files:**
- Modify: `trackers/habits.js`
- Modify: `style.css` (habit-card + dot-row + streak-badge styles)

- [ ] **Step 1: Implement `trackers/habits.js`**

```js
import { get, set } from '../storage.js';

const HABITS_KEY = 'vox_habits';
const LOG_KEY    = 'vox_habit_log';
const EMOJIS     = ['💪','🧘','📚','💧','🏃','🥗','✍️','🛏️'];

let removers = [];
let container = null;

export function mount(el) {
  container = el;
  render();
}

export function unmount() {
  removers.forEach(fn => fn());
  removers = [];
  container = null;
}

export function getContext() {
  return { habits: get(HABITS_KEY, []), log: get(LOG_KEY, {}) };
}

function on(el, evt, fn) {
  el.addEventListener(evt, fn);
  removers.push(() => el.removeEventListener(evt, fn));
}

function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}

function isDone(habitId, dateStr) {
  const log = get(LOG_KEY, {});
  return (log[dateStr] || []).includes(habitId);
}

function toggleHabit(habitId) {
  const log = get(LOG_KEY, {});
  const d = today();
  const arr = new Set(log[d] || []);
  if (arr.has(habitId)) arr.delete(habitId); else arr.add(habitId);
  log[d] = [...arr];
  set(LOG_KEY, log);
}

function streak(habitId) {
  let count = 0;
  // streak counts back from today; if today not done, start from yesterday
  let start = isDone(habitId, today()) ? 0 : 1;
  for (let i = start; i < 365; i++) {
    if (isDone(habitId, daysAgo(i))) count++; else break;
  }
  // also add today if done (since we started loop at i=0 in that case)
  return count;
}

function addHabit(name, emoji) {
  const habits = get(HABITS_KEY, []);
  habits.push({ id: crypto.randomUUID(), name, emoji, createdAt: new Date().toISOString() });
  set(HABITS_KEY, habits);
}

function deleteHabit(id) {
  set(HABITS_KEY, get(HABITS_KEY, []).filter(h => h.id !== id));
}

function render() {
  const habits = get(HABITS_KEY, []);
  container.innerHTML = `
    <div class="tracker-header">
      <h2 class="tracker-title">Habits</h2>
      <button class="tracker-add-btn" id="add-habit-btn" aria-label="Add habit">＋ New</button>
    </div>
    <div class="habit-list">
      ${habits.length === 0 ? `
        <div class="tracker-empty">
          <div class="empty-icon">◎</div>
          <p class="empty-title">No habits yet</p>
          <p class="empty-sub">Start with one.</p>
        </div>
      ` : habits.map(h => habitCardHtml(h)).join('')}
    </div>
  `;

  on(container.querySelector('#add-habit-btn'), 'click', openNewHabitModal);
  container.querySelectorAll('.habit-card').forEach(card => {
    const id = card.dataset.id;
    on(card.querySelector('.habit-toggle'), 'click', () => { toggleHabit(id); render(); });
    on(card.querySelector('.habit-delete'), 'click', e => {
      e.stopPropagation();
      if (confirm('Delete this habit? Past logs are kept.')) { deleteHabit(id); render(); }
    });
  });
}

function habitCardHtml(h) {
  const doneToday = isDone(h.id, today());
  const s = streak(h.id);
  const dots = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const dateStr = daysAgo(offset);
    const done = isDone(h.id, dateStr);
    const isToday = offset === 0;
    return `<span class="habit-dot ${done ? 'on' : ''} ${isToday ? 'today' : ''}" title="${dateStr}"></span>`;
  }).join('');
  return `
    <div class="habit-card ${doneToday ? 'done' : ''}" data-id="${h.id}">
      <button class="habit-toggle" aria-label="${doneToday ? 'Unmark today' : 'Mark today done'}">
        <span class="habit-emoji">${h.emoji}</span>
        <div class="habit-meta">
          <div class="habit-name">${escapeHtml(h.name)}</div>
          <div class="habit-dots">${dots}</div>
        </div>
      </button>
      ${s > 0 ? `<div class="habit-streak">🔥 ${s}</div>` : '<div class="habit-streak placeholder">·</div>'}
      <button class="habit-delete" aria-label="Delete habit">×</button>
    </div>
  `;
}

function openNewHabitModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">New Habit</h3>
      <input id="habit-name" class="modal-input" placeholder="Habit name (e.g. Meditate)" autocomplete="off">
      <div class="emoji-row">
        ${EMOJIS.map(e => `<button class="emoji-pick" data-emoji="${e}">${e}</button>`).join('')}
      </div>
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-habit">Cancel</button>
        <button class="btn-save" id="save-habit" disabled>Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  let pickedEmoji = null;
  const nameInput = modal.querySelector('#habit-name');
  const saveBtn = modal.querySelector('#save-habit');
  const refresh = () => { saveBtn.disabled = !(nameInput.value.trim() && pickedEmoji); };

  modal.querySelectorAll('.emoji-pick').forEach(btn => {
    btn.addEventListener('click', () => {
      pickedEmoji = btn.dataset.emoji;
      modal.querySelectorAll('.emoji-pick').forEach(b => b.classList.toggle('selected', b === btn));
      refresh();
    });
  });
  nameInput.addEventListener('input', refresh);
  modal.querySelector('#cancel-habit').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  saveBtn.addEventListener('click', () => {
    addHabit(nameInput.value.trim(), pickedEmoji);
    modal.remove();
    render();
  });
  setTimeout(() => nameInput.focus(), 50);
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

- [ ] **Step 2: Add habit styles to `style.css`**

```css
/* ── Tracker header (shared) ─────────────────── */
.tracker-header {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 1.25rem 1.25rem 0.5rem;
}
.tracker-title {
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 800;
  letter-spacing: -0.02em;
}
.tracker-add-btn {
  padding: 0.4rem 0.85rem;
  border-radius: 100px;
  background: var(--tab-accent, var(--accent));
  color: var(--bg);
  font-weight: 600;
  font-size: 0.82rem;
}
.tracker-add-btn:active { transform: scale(0.95); }

/* ── Habit cards ─────────────────────────────── */
.habit-list { padding: 0.5rem 1.25rem; display: flex; flex-direction: column; gap: 0.6rem; }

.habit-card {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.85rem 1rem;
  border-radius: var(--radius);
  background: var(--bg3);
  border: 1px solid var(--border);
  transition: border-color 0.15s;
}
.habit-card.done { border-color: var(--green); background: rgba(82,214,138,0.05); }

.habit-toggle { flex: 1; display: flex; align-items: center; gap: 0.75rem; text-align: left; }
.habit-emoji { font-size: 1.6rem; line-height: 1; }
.habit-name { font-weight: 600; font-size: 0.97rem; color: var(--ink); }
.habit-dots { display: flex; gap: 4px; margin-top: 6px; }
.habit-dot {
  width: 10px; height: 10px; border-radius: 50%;
  border: 1.5px solid var(--border2);
  background: transparent;
}
.habit-dot.on { background: var(--green); border-color: var(--green); }
.habit-dot.today { outline: 2px solid var(--green-low); outline-offset: 2px; }

.habit-streak {
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--green);
  padding: 0.2rem 0.5rem;
  border-radius: 100px;
  background: var(--green-low);
  white-space: nowrap;
}
.habit-streak.placeholder { color: var(--ink3); background: transparent; }

.habit-delete {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  color: var(--ink3); border-radius: 50%; font-size: 1.1rem;
}
.habit-delete:hover { color: var(--red); background: var(--red-low); }

/* ── Modal (shared) ──────────────────────────── */
.modal-backdrop {
  position: fixed; inset: 0; z-index: 200;
  background: rgba(0,0,0,0.7);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  display: flex; align-items: center; justify-content: center;
  padding: 1rem;
  animation: fadeIn 0.15s ease;
}
.modal-card {
  width: 100%; max-width: 380px;
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.2rem;
  display: flex; flex-direction: column; gap: 0.85rem;
  box-shadow: var(--shadow-lg);
}
.modal-title {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 700;
}
.modal-input {
  padding: 0.7rem 0.85rem;
  border-radius: var(--radius-xs);
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--ink);
  font-size: 0.95rem;
}
.modal-input:focus { border-color: var(--tab-accent, var(--accent)); }
.emoji-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem; }
.emoji-pick {
  font-size: 1.6rem; padding: 0.5rem;
  border-radius: var(--radius-xs);
  border: 1px solid var(--border);
  background: var(--bg3);
  transition: border-color 0.1s, background 0.1s;
}
.emoji-pick.selected { border-color: var(--tab-accent, var(--accent)); background: var(--bg4); }
.modal-actions { display: flex; gap: 0.5rem; justify-content: flex-end; }
.btn-secondary {
  padding: 0.55rem 1rem;
  border-radius: var(--radius-xs);
  background: var(--bg4);
  color: var(--ink2);
  font-weight: 600;
}
```

- [ ] **Step 3: Verify via Playwright MCP**

1. Tap Habits tab. Empty state appears.
2. Tap "＋ New" → modal opens.
3. Type "Meditate", pick 🧘, tap Add. Habit card appears with 7 empty dots.
4. Tap card body → today's dot fills green, card border turns green, streak shows "🔥 1".
5. Tap again → unmarks, streak hides.
6. Add second habit, leave unchecked.
7. Refresh — both habits persist with correct state.
8. Switch to Tasks, back to Habits — cards still rendered.
9. Console: clean.

- [ ] **Step 4: Commit**

```bash
git add trackers/habits.js style.css
git commit -m "feat(habits): daily binary tracker with streak + 7-day grid"
```

---

## Task 6: Sleep tracker

**Files:**
- Modify: `trackers/sleep.js`
- Modify: `style.css`

- [ ] **Step 1: Implement `trackers/sleep.js`**

```js
import { get, set } from '../storage.js';

const KEY = 'vox_sleep';
let removers = [];
let container = null;
let editingDate = null;

export function mount(el) { container = el; render(); }
export function unmount() { removers.forEach(fn => fn()); removers = []; container = null; }
export function getContext() {
  const entries = get(KEY, []).slice(0, 14);
  return entries;
}

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function today() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function computeHours(bedtime, wake) {
  // bedtime like "23:00", wake like "07:00" — handle overnight wrap
  const [bh, bm] = bedtime.split(':').map(Number);
  const [wh, wm] = wake.split(':').map(Number);
  let mins = (wh * 60 + wm) - (bh * 60 + bm);
  if (mins < 0) mins += 24 * 60;
  return Math.round((mins / 60) * 10) / 10;
}

function upsert(entry) {
  const all = get(KEY, []).filter(e => e.date !== entry.date);
  all.unshift(entry);
  all.sort((a, b) => b.date.localeCompare(a.date));
  set(KEY, all);
}

function avgLast(days, offset = 0) {
  const all = get(KEY, []);
  const cutoff = daysAgo(offset);
  const earliest = daysAgo(offset + days - 1);
  const subset = all.filter(e => e.date <= cutoff && e.date >= earliest);
  if (subset.length === 0) return null;
  return subset.reduce((s, e) => s + e.hours, 0) / subset.length;
}

function render() {
  const all = get(KEY, []);
  const thisWeek = avgLast(7, 0);
  const lastWeek = avgLast(7, 7);
  const delta = (thisWeek != null && lastWeek != null) ? thisWeek - lastWeek : null;

  // 7 days bars (oldest left → today right)
  const bars = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const dateStr = daysAgo(offset);
    const entry = all.find(e => e.date === dateStr);
    const hours = entry?.hours ?? 0;
    const quality = entry?.quality ?? 0;
    const pct = Math.min(100, (hours / 12) * 100);
    return `
      <div class="sleep-bar-col">
        <div class="sleep-bar-track">
          <div class="sleep-bar-fill q${quality}" style="height:${pct}%" title="${dateStr}: ${hours || '—'}h"></div>
        </div>
        <div class="sleep-bar-label">${['S','M','T','W','T','F','S'][new Date(dateStr).getDay()]}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="tracker-header">
      <h2 class="tracker-title">Sleep</h2>
    </div>

    <div class="sleep-log-card">
      <p class="card-label">Log last night</p>
      <div class="sleep-form-row">
        <label>Bedtime <input type="time" id="sleep-bed" value="23:00"></label>
        <label>Wake <input type="time" id="sleep-wake" value="07:00"></label>
      </div>
      <div class="sleep-quality-row">
        <span>Quality</span>
        <div class="star-row" id="sleep-quality">
          ${[1,2,3,4,5].map(n => `<button class="star" data-q="${n}">★</button>`).join('')}
        </div>
      </div>
      <input type="text" id="sleep-note" class="modal-input" placeholder="Note (optional)">
      <button class="btn-save" id="sleep-save">Save</button>
    </div>

    <div class="sleep-stats">
      <div>
        <div class="stat-num">${thisWeek ? thisWeek.toFixed(1) + 'h' : '—'}</div>
        <div class="stat-label">This week avg</div>
      </div>
      <div>
        <div class="stat-num ${delta == null ? '' : (delta >= 0 ? 'pos' : 'neg')}">${delta == null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(1) + 'h'}</div>
        <div class="stat-label">vs last week</div>
      </div>
    </div>

    <div class="sleep-bars">${bars}</div>

    <div class="sleep-list">
      ${all.slice(0, 14).map(e => `
        <div class="sleep-row">
          <span class="sleep-date">${e.date}</span>
          <span class="sleep-hours">${e.hours}h</span>
          <span class="sleep-stars">${'★'.repeat(e.quality)}${'☆'.repeat(5 - e.quality)}</span>
        </div>
      `).join('') || '<p class="empty-sub" style="padding:1rem 1.25rem">No entries yet.</p>'}
    </div>
  `;

  let chosenQuality = 0;
  container.querySelectorAll('.star').forEach(btn => {
    on(btn, 'click', () => {
      chosenQuality = +btn.dataset.q;
      container.querySelectorAll('.star').forEach(s => s.classList.toggle('on', +s.dataset.q <= chosenQuality));
    });
  });

  on(container.querySelector('#sleep-save'), 'click', () => {
    const bed = container.querySelector('#sleep-bed').value;
    const wake = container.querySelector('#sleep-wake').value;
    const note = container.querySelector('#sleep-note').value.trim();
    if (!bed || !wake || !chosenQuality) { alert('Bedtime, wake, and quality required.'); return; }
    upsert({
      id: crypto.randomUUID(),
      date: today(),
      bedtime: bed,
      wake,
      hours: computeHours(bed, wake),
      quality: chosenQuality,
      note
    });
    render();
  });
}
```

- [ ] **Step 2: Sleep styles**

```css
/* ── Sleep ───────────────────────────────────── */
.sleep-log-card {
  margin: 0.5rem 1.25rem;
  padding: 1rem;
  background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius);
  display: flex; flex-direction: column; gap: 0.6rem;
}
.card-label {
  font-size: 0.72rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.1em;
  color: var(--slate);
}
.sleep-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
.sleep-form-row label { display: flex; flex-direction: column; font-size: 0.78rem; color: var(--ink3); gap: 0.25rem; }
.sleep-form-row input[type="time"] {
  padding: 0.5rem 0.6rem;
  border-radius: var(--radius-xs);
  background: var(--bg4); border: 1px solid var(--border);
  color: var(--ink); font-size: 0.95rem;
  color-scheme: dark;
}
.sleep-quality-row { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
.star-row { display: flex; gap: 4px; }
.star { font-size: 1.4rem; color: var(--ink3); transition: color 0.1s; }
.star.on { color: var(--slate); }
.btn-save { background: var(--slate); color: var(--bg); padding: 0.65rem 1rem; border-radius: var(--radius-xs); font-weight: 600; }

body[data-tab="sleep"] .btn-save { background: var(--slate); }

.sleep-stats {
  display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;
  padding: 0.75rem 1.25rem;
}
.sleep-stats > div {
  padding: 0.75rem; border-radius: var(--radius-sm);
  background: var(--bg3); border: 1px solid var(--border);
}
.stat-num { font-family: var(--font-display); font-size: 1.4rem; font-weight: 800; color: var(--ink); }
.stat-num.pos { color: var(--green); }
.stat-num.neg { color: var(--red); }
.stat-label { font-size: 0.72rem; color: var(--ink3); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

.sleep-bars {
  display: flex; gap: 6px;
  padding: 0.75rem 1.25rem;
  height: 140px;
  align-items: stretch;
}
.sleep-bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.sleep-bar-track { flex: 1; width: 100%; background: var(--bg3); border-radius: 4px; display: flex; align-items: flex-end; overflow: hidden; }
.sleep-bar-fill { width: 100%; border-radius: 4px; transition: height 0.4s ease; }
.sleep-bar-fill.q1 { background: var(--red); }
.sleep-bar-fill.q2 { background: #c97a3a; }
.sleep-bar-fill.q3 { background: var(--yellow); }
.sleep-bar-fill.q4 { background: #8ad17a; }
.sleep-bar-fill.q5 { background: var(--green); }
.sleep-bar-label { font-family: var(--font-mono); font-size: 0.68rem; color: var(--ink3); }

.sleep-list { padding: 0.5rem 1.25rem 1rem; display: flex; flex-direction: column; gap: 0.4rem; }
.sleep-row {
  display: grid; grid-template-columns: 1fr auto auto;
  gap: 0.75rem; align-items: center;
  padding: 0.55rem 0.8rem;
  background: var(--bg3); border-radius: var(--radius-xs);
  font-size: 0.85rem; color: var(--ink2);
}
.sleep-date { font-family: var(--font-mono); color: var(--ink3); font-size: 0.78rem; }
.sleep-hours { color: var(--ink); font-weight: 600; }
.sleep-stars { color: var(--slate); font-size: 0.78rem; letter-spacing: 1px; }
```

- [ ] **Step 3: Verify via Playwright MCP**

1. Sleep tab. Form visible with bedtime/wake/stars.
2. Set bedtime 22:30, wake 06:30, tap 4 stars, type "good night", Save.
3. Entry appears in list at top, bars show today's bar filled green-ish.
4. Stats row shows "8h / —" (no last week yet).
5. Save another entry — same date overwrites first (only one for today).
6. Refresh — persists.
7. Console: clean.

- [ ] **Step 4: Commit**

```bash
git add trackers/sleep.js style.css
git commit -m "feat(sleep): bedtime/wake/quality logging with 7-day bar chart"
```

---

## Task 7: Weight tracker

**Files:**
- Modify: `trackers/weight.js`
- Modify: `style.css`

- [ ] **Step 1: Implement `trackers/weight.js`**

```js
import { get, set } from '../storage.js';

const KEY = 'vox_weight';
const GOAL_KEY = 'vox_weight_goal';

let removers = [];
let container = null;

export function mount(el) { container = el; render(); }
export function unmount() { removers.forEach(fn => fn()); removers = []; container = null; }
export function getContext() {
  return { entries: get(KEY, []).slice(0, 30), goal: get(GOAL_KEY, null) };
}

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function today() { return new Date().toISOString().split('T')[0]; }

function addEntry(weight, date) {
  const all = get(KEY, []).filter(e => e.date !== date);
  all.unshift({ id: crypto.randomUUID(), date, weight });
  all.sort((a, b) => b.date.localeCompare(a.date));
  set(KEY, all);
}

function deleteEntry(id) { set(KEY, get(KEY, []).filter(e => e.id !== id)); }

function svgChart(entries, goal) {
  if (entries.length < 2) return '<p class="empty-sub" style="padding:1rem">Log at least 2 entries to see trend.</p>';
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const weights = sorted.map(e => e.weight);
  const min = Math.min(...weights, goal?.value ?? Infinity);
  const max = Math.max(...weights, goal?.value ?? -Infinity);
  const range = max - min || 1;
  const W = 340, H = 140, PAD = 20;
  const points = sorted.map((e, i) => {
    const x = PAD + (i / (sorted.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((e.weight - min) / range) * (H - 2 * PAD);
    return `${x},${y}`;
  }).join(' ');
  const goalY = goal ? H - PAD - ((goal.value - min) / range) * (H - 2 * PAD) : null;
  return `
    <svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${goal ? `<line x1="${PAD}" x2="${W - PAD}" y1="${goalY}" y2="${goalY}" stroke="var(--yellow)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>` : ''}
      <polyline points="${points}" fill="none" stroke="var(--yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${sorted.map(e => {
        const i = sorted.indexOf(e);
        const x = PAD + (i / (sorted.length - 1)) * (W - 2 * PAD);
        const y = H - PAD - ((e.weight - min) / range) * (H - 2 * PAD);
        return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--yellow)"/>`;
      }).join('')}
    </svg>
  `;
}

function render() {
  const all = get(KEY, []);
  const goal = get(GOAL_KEY, null);
  const current = all[0];
  const delta = (current && goal) ? current.weight - goal.value : null;
  const unit = goal?.unit ?? 'kg';

  container.innerHTML = `
    <div class="tracker-header">
      <h2 class="tracker-title">Weight</h2>
      <button class="link-btn" id="set-goal-btn">${goal ? 'Edit goal' : 'Set goal'}</button>
    </div>

    <div class="weight-hero">
      <div class="weight-current">${current ? current.weight + ' ' + unit : '—'}</div>
      <div class="weight-delta">${goal ? (
        delta > 0 ? `+${delta.toFixed(1)} ${unit} over goal` :
        delta < 0 ? `${delta.toFixed(1)} ${unit} to go` :
        `At goal ✓`
      ) : 'No goal set'}</div>
    </div>

    ${svgChart(all.slice(0, 30), goal)}

    <div class="weight-list">
      ${all.slice(0, 10).map((e, i, arr) => {
        const next = arr[i + 1];
        const d = next ? e.weight - next.weight : null;
        return `
          <div class="weight-row">
            <span class="sleep-date">${e.date}</span>
            <span class="weight-val">${e.weight} ${unit}</span>
            <span class="weight-delta-mini ${d == null ? '' : (d > 0 ? 'up' : d < 0 ? 'down' : '')}">${
              d == null ? '' : (d > 0 ? '▲ +' : '▼ ') + Math.abs(d).toFixed(1)
            }</span>
            <button class="task-delete" data-id="${e.id}" aria-label="Delete">×</button>
          </div>
        `;
      }).join('') || '<p class="empty-sub" style="padding:1rem 1.25rem">No entries yet.</p>'}
    </div>

    <button class="fab" id="add-weight-fab" aria-label="Log weight">＋</button>
  `;

  on(container.querySelector('#add-weight-fab'), 'click', openLogModal);
  on(container.querySelector('#set-goal-btn'), 'click', openGoalModal);
  container.querySelectorAll('.weight-row .task-delete').forEach(btn => {
    on(btn, 'click', () => { deleteEntry(btn.dataset.id); render(); });
  });
}

function openLogModal() {
  const goal = get(GOAL_KEY, null);
  const unit = goal?.unit ?? 'kg';
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">Log weight</h3>
      <input type="number" step="0.1" id="w-val" class="modal-input" placeholder="Weight in ${unit}" autocomplete="off">
      <input type="date" id="w-date" class="modal-input" value="${today()}" max="${today()}">
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-w">Cancel</button>
        <button class="btn-save" id="save-w">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.querySelector('#cancel-w').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#save-w').addEventListener('click', () => {
    const v = parseFloat(modal.querySelector('#w-val').value);
    const d = modal.querySelector('#w-date').value;
    if (!v || !d) return;
    addEntry(v, d);
    modal.remove();
    render();
  });
  setTimeout(() => modal.querySelector('#w-val').focus(), 50);
}

function openGoalModal() {
  const existing = get(GOAL_KEY, { value: '', unit: 'kg' });
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">Goal weight</h3>
      <div class="unit-toggle">
        <button data-u="kg" class="unit-btn ${existing.unit === 'kg' ? 'selected' : ''}">kg</button>
        <button data-u="lb" class="unit-btn ${existing.unit === 'lb' ? 'selected' : ''}">lb</button>
      </div>
      <input type="number" step="0.1" id="g-val" class="modal-input" placeholder="Goal weight" value="${existing.value}">
      <div class="modal-actions">
        <button class="btn-secondary" id="cancel-g">Cancel</button>
        <button class="btn-save" id="save-g">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  let unit = existing.unit;
  modal.querySelectorAll('.unit-btn').forEach(b => {
    b.addEventListener('click', () => {
      unit = b.dataset.u;
      modal.querySelectorAll('.unit-btn').forEach(x => x.classList.toggle('selected', x === b));
    });
  });
  modal.querySelector('#cancel-g').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#save-g').addEventListener('click', () => {
    const v = parseFloat(modal.querySelector('#g-val').value);
    if (!v) return;
    set(GOAL_KEY, { value: v, unit });
    modal.remove();
    render();
  });
}
```

- [ ] **Step 2: Weight styles**

```css
/* ── Weight ──────────────────────────────────── */
.weight-hero { text-align: center; padding: 1rem 1.25rem 0.25rem; }
.weight-current {
  font-family: var(--font-display);
  font-size: 3rem; font-weight: 800; letter-spacing: -0.03em;
  color: var(--yellow);
}
.weight-delta { font-size: 0.85rem; color: var(--ink3); margin-top: 4px; }

.weight-chart {
  width: calc(100% - 2.5rem);
  display: block;
  margin: 0.75rem 1.25rem;
  height: 140px;
  background: var(--bg3);
  border-radius: var(--radius-sm);
  padding: 0.5rem;
}

.weight-list { padding: 0.5rem 1.25rem; display: flex; flex-direction: column; gap: 0.4rem; }
.weight-row {
  display: grid; grid-template-columns: 1fr auto auto 30px;
  align-items: center; gap: 0.5rem;
  padding: 0.5rem 0.8rem;
  background: var(--bg3); border-radius: var(--radius-xs);
  font-size: 0.85rem;
}
.weight-val { font-weight: 600; color: var(--ink); }
.weight-delta-mini { font-family: var(--font-mono); font-size: 0.76rem; color: var(--ink3); }
.weight-delta-mini.up   { color: var(--red); }
.weight-delta-mini.down { color: var(--green); }

.link-btn {
  font-size: 0.82rem;
  color: var(--yellow);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.unit-toggle { display: flex; gap: 4px; }
.unit-btn {
  flex: 1; padding: 0.5rem; border-radius: var(--radius-xs);
  background: var(--bg3); border: 1px solid var(--border);
  color: var(--ink2); font-weight: 600;
}
.unit-btn.selected { background: var(--yellow); color: var(--bg); border-color: var(--yellow); }

/* ── Floating action button (shared) ─────────── */
.fab {
  position: fixed;
  bottom: calc(var(--tabbar-h) + var(--chatbar-h) + env(safe-area-inset-bottom, 0px) + 16px);
  right: 1.25rem;
  width: 56px; height: 56px;
  border-radius: 50%;
  background: var(--tab-accent, var(--accent));
  color: var(--bg);
  font-size: 1.8rem; font-weight: 300;
  box-shadow: var(--shadow-md);
  z-index: 80;
  transition: transform 0.1s;
}
.fab:active { transform: scale(0.94); }

body[data-tab="weight"] .btn-save { background: var(--yellow); }
```

- [ ] **Step 3: Verify via Playwright MCP**

1. Weight tab. Hero shows "—", "No goal set".
2. Tap FAB → modal. Enter 78.5, today, Save.
3. Hero updates to "78.5 kg".
4. Tap "Set goal" → modal. Pick kg, enter 75, Save.
5. Delta shows "+3.5 kg over goal".
6. Log a second entry yesterday (manually edit date) at 79.0 — chart line + dashed goal line render.
7. List shows two rows with delta arrows.
8. Refresh — persists.
9. Console: clean.

- [ ] **Step 4: Commit**

```bash
git add trackers/weight.js style.css
git commit -m "feat(weight): hero number, goal, SVG line chart, log modal"
```

---

## Task 8: Meals tracker + `parseMeal` Gemini prompt

**Files:**
- Modify: `gemini.js` (add `parseMeal`)
- Modify: `trackers/meals.js`
- Modify: `style.css`

- [ ] **Step 1: Add `parseMeal` to `gemini.js`**

```js
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
```

- [ ] **Step 2: Implement `trackers/meals.js`**

```js
import { get, set } from '../storage.js';
import { parseMeal, hasApiKey } from '../gemini.js';

const KEY = 'vox_meals';
let removers = [];
let container = null;
let viewDate = todayStr();

export function mount(el) { container = el; render(); }
export function unmount() { removers.forEach(fn => fn()); removers = []; container = null; }
export function getContext() {
  // last 7 days of meals grouped by date
  const all = get(KEY, []);
  const cutoff = daysAgo(7);
  return all.filter(m => m.date >= cutoff);
}

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function todayStr() { return new Date().toISOString().split('T')[0]; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }

function addMeal(meal) {
  const all = get(KEY, []);
  all.unshift({ ...meal, id: crypto.randomUUID(), date: viewDate });
  set(KEY, all);
}

function deleteMeal(id) { set(KEY, get(KEY, []).filter(m => m.id !== id)); }

function totals(dayMeals) {
  return dayMeals.reduce((t, m) => ({
    cal: t.cal + (m.calories || 0),
    p:   t.p   + (m.protein  || 0),
    c:   t.c   + (m.carbs    || 0),
    f:   t.f   + (m.fat      || 0)
  }), { cal: 0, p: 0, c: 0, f: 0 });
}

function render() {
  const all = get(KEY, []);
  const todays = all.filter(m => m.date === viewDate);
  const t = totals(todays);
  const isToday = viewDate === todayStr();
  const dayLabel = isToday ? 'Today'
                   : viewDate === daysAgo(1) ? 'Yesterday'
                   : viewDate;

  container.innerHTML = `
    <div class="tracker-header">
      <h2 class="tracker-title">Meals</h2>
    </div>

    <div class="day-nav">
      <button class="day-arrow" id="day-prev" aria-label="Previous day">◀</button>
      <span class="day-label">${dayLabel}</span>
      <button class="day-arrow" id="day-next" aria-label="Next day" ${isToday ? 'disabled' : ''}>▶</button>
    </div>

    <div class="meal-totals">
      <div class="totals-row">
        <div><div class="totals-num">${t.cal}</div><div class="totals-lbl">kcal</div></div>
        <div><div class="totals-num">${t.p}g</div><div class="totals-lbl">Protein</div></div>
        <div><div class="totals-num">${t.c}g</div><div class="totals-lbl">Carbs</div></div>
        <div><div class="totals-num">${t.f}g</div><div class="totals-lbl">Fat</div></div>
      </div>
    </div>

    <div class="meal-list">
      ${todays.map(m => `
        <div class="meal-row ${m._failed ? 'failed' : ''}">
          <div class="meal-main">
            <div class="meal-name">${escapeHtml(m.name)}</div>
            <div class="meal-meta">${m.grams ? m.grams + 'g · ' : ''}${m.calories} kcal · P${m.protein} C${m.carbs} F${m.fat}${m._failed ? ' · parse failed' : ''}</div>
          </div>
          <button class="task-delete" data-id="${m.id}" aria-label="Delete">×</button>
        </div>
      `).join('') || '<p class="empty-sub" style="padding:1rem 1.25rem">No meals logged for this day.</p>'}
    </div>

    <div class="meal-input-bar">
      <input id="meal-input" type="text" class="task-input"
        placeholder="${hasApiKey() ? 'Log a meal — e.g. 200g chicken breast' : 'Add Gemini key in settings to log meals'}"
        ${hasApiKey() ? '' : 'disabled'}>
      <button id="meal-send" class="add-btn" ${hasApiKey() ? '' : 'disabled'} aria-label="Log meal">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  `;

  on(container.querySelector('#day-prev'), 'click', () => { viewDate = shiftDate(viewDate, -1); render(); });
  on(container.querySelector('#day-next'), 'click', () => {
    if (viewDate !== todayStr()) { viewDate = shiftDate(viewDate, 1); render(); }
  });
  container.querySelectorAll('.meal-row .task-delete').forEach(btn => {
    on(btn, 'click', () => { deleteMeal(btn.dataset.id); render(); });
  });

  const input = container.querySelector('#meal-input');
  const send  = container.querySelector('#meal-send');
  const submit = async () => {
    const raw = input.value.trim();
    if (!raw || !hasApiKey()) return;
    input.value = '';
    input.disabled = true; send.disabled = true;
    // optimistic placeholder
    const placeholderId = crypto.randomUUID();
    const all = get(KEY, []);
    all.unshift({ id: placeholderId, date: viewDate, name: raw, grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0, _parsing: true });
    set(KEY, all);
    render();
    try {
      const parsed = await parseMeal(raw);
      const updated = get(KEY, []).map(m => m.id === placeholderId
        ? { ...m, ...parsed, _parsing: false, rawInput: raw }
        : m);
      set(KEY, updated);
    } catch {
      // leave as failed entry
    }
    render();
    container.querySelector('#meal-input')?.focus();
  };
  if (input && send) {
    on(send, 'click', submit);
    on(input, 'keydown', e => { if (e.key === 'Enter') submit(); });
  }
}

function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

- [ ] **Step 3: Meal styles**

```css
/* ── Meals ───────────────────────────────────── */
.day-nav {
  display: flex; align-items: center; justify-content: center; gap: 1rem;
  padding: 0.5rem 1.25rem;
}
.day-arrow {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; color: var(--ink2);
  background: var(--bg3); border: 1px solid var(--border);
}
.day-arrow:disabled { opacity: 0.3; }
.day-label {
  font-family: var(--font-display); font-size: 1rem; font-weight: 700;
  color: var(--ink); min-width: 110px; text-align: center;
}

.meal-totals { padding: 0.5rem 1.25rem; }
.totals-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.4rem;
  padding: 0.85rem; background: var(--bg3);
  border: 1px solid var(--border); border-radius: var(--radius);
}
.totals-row > div { text-align: center; }
.totals-num {
  font-family: var(--font-display); font-size: 1.15rem;
  font-weight: 800; color: var(--red);
}
.totals-lbl { font-size: 0.66rem; color: var(--ink3); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 2px; }

.meal-list { padding: 0.25rem 1.25rem 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; }
.meal-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.65rem 0.85rem;
  background: var(--bg3); border: 1px solid var(--border); border-radius: var(--radius-sm);
}
.meal-row.failed { border-color: var(--red); background: var(--red-low); }
.meal-main { flex: 1; min-width: 0; }
.meal-name { font-weight: 600; color: var(--ink); font-size: 0.92rem; }
.meal-meta { font-family: var(--font-mono); font-size: 0.72rem; color: var(--ink3); margin-top: 2px; }

.meal-input-bar {
  position: sticky; bottom: 0;
  display: flex; gap: 0.5rem;
  padding: 0.75rem 1.25rem;
  background: var(--bg2);
  border-top: 1px solid var(--border);
}
body[data-tab="meals"] .meal-input-bar .add-btn { background: var(--red); box-shadow: 0 2px 12px rgba(224,85,85,0.35); }
body[data-tab="meals"] .btn-save { background: var(--red); }
```

- [ ] **Step 4: Verify via Playwright MCP**

(Requires working Gemini API key.)
1. Meals tab. Today totals: all zeros.
2. Type "200g chicken breast" → Send. Optimistic row appears with zeros, then updates to ~330 cal / P62 / C0 / F7.
3. Type "two slices of toast" → row appears with realistic numbers.
4. Tap ◀ — switches to yesterday, empty list, ▶ now enabled.
5. Tap ▶ → back to today, meals still there.
6. Delete a meal — row removes, totals update.
7. Refresh — meals persist on correct day.
8. Without API key (clear in devtools): input disabled, banner via placeholder text.
9. Console: clean.

- [ ] **Step 5: Commit**

```bash
git add gemini.js trackers/meals.js style.css
git commit -m "feat(meals): AI-parsed meal logging with daily totals and day nav"
```

---

## Task 9: Global chat context + extended briefing

**Files:**
- Modify: `app.js` (build full context from every tracker)
- Modify: `gemini.js` (update chat + briefing prompts)

- [ ] **Step 1: Update `chatWithAI` prompt in `gemini.js`**

```js
export async function chatWithAI(question, fullContext) {
  const today = new Date().toISOString().split('T')[0];
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

MEALS (last 7 days):
${JSON.stringify(fullContext.meals ?? [], null, 2)}

Answer the user concisely. Reference specific data points (titles, dates, numbers) when useful. If a tracker has no data relevant to the question, ignore it silently.

User: "${question}"`;
  return await callGemini(prompt);
}
```

- [ ] **Step 2: Update `generateBriefing` prompt**

```js
export async function generateBriefing(fullContext) {
  const today = new Date().toISOString().split('T')[0];
  const prompt =
`You are a personal productivity assistant. Generate a warm, motivating morning briefing (4–6 sentences, plain text only — no markdown, no bullets).

Today: ${today}

TASKS: ${JSON.stringify(fullContext.tasks ?? [])}
HABITS: ${JSON.stringify(fullContext.habits ?? {})}
SLEEP (last 7): ${JSON.stringify((fullContext.sleep ?? []).slice(0, 7))}
WEIGHT (last 7): ${JSON.stringify({ entries: (fullContext.weight?.entries ?? []).slice(0, 7), goal: fullContext.weight?.goal })}
MEALS (today): ${JSON.stringify((fullContext.meals ?? []).filter(m => m.date === today))}

Cover what's relevant from: tasks due today, overdue tasks, a top priority, any habit streak at risk (yesterday missed), unusual sleep (under 6h two nights running), weight trend, today's calorie progress.

If a section has no data, skip it silently. Keep it brief.`;
  return await callGemini(prompt);
}
```

- [ ] **Step 3: Build full context in `app.js`**

Replace existing `handleChat` / `handleBriefing` bodies to:

```js
function buildFullContext() {
  return {
    tasks:  tasks.getContext(),
    habits: habits.getContext(),
    sleep:  sleep.getContext(),
    weight: weight.getContext(),
    meals:  meals.getContext()
  };
}

async function handleChat() {
  const q = chatInput.value.trim();
  if (!q) return;
  chatInput.value = '';
  appendMsg('user', q);
  if (!hasApiKey()) { appendMsg('assistant', 'Add a Gemini API key in settings to use AI chat.'); return; }
  const thinking = appendMsg('assistant', '…', true);
  try {
    const reply = await chatWithAI(q, buildFullContext());
    thinking.textContent = reply;
    thinking.classList.remove('thinking');
  } catch (err) {
    thinking.textContent = `Error: ${err.message}`;
    thinking.classList.remove('thinking');
  }
}

async function handleBriefing() {
  briefingCard.classList.remove('hidden');
  if (!hasApiKey()) {
    briefingContent.innerHTML = '<p>Add your Gemini API key in settings to generate briefings.</p>';
    return;
  }
  briefingContent.innerHTML = '<div class="briefing-loading">Generating your briefing<span class="dots"></span></div>';
  try {
    const text = await generateBriefing(buildFullContext());
    briefingContent.innerHTML = `<p>${escapeHtml(text)}</p>`;
  } catch (err) {
    briefingContent.innerHTML = `<p style="color:var(--red)">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
```

**Important:** `tasks.getContext()` reads from localStorage directly — so it works even when the Tasks tab is not currently mounted. Same for the others. Verify each tracker's `getContext()` does not depend on `container` being non-null. If any does, fix it now (move the data fetch to localStorage-only logic).

- [ ] **Step 4: Verify via Playwright MCP**

(Requires working Gemini key, plus some data in multiple trackers.)
1. Pre-seed: at least one task, one habit done today, one sleep entry, one weight entry, one meal.
2. Open chat, ask "how am I doing this week?"
3. Confirm response references at least two trackers.
4. Tap Briefing button (top right). Confirm briefing mentions tasks AND at least one other tracker.
5. Switch to Habits tab — open chat from there — ask "what's my workout streak?" — confirm answer references habits.
6. Console: clean.

- [ ] **Step 5: Commit**

```bash
git add app.js gemini.js
git commit -m "feat(chat): full-context chat + cross-tracker morning briefing"
```

---

## Task 10: Final polish + verification sweep

**Files:**
- Modify: anything found broken

- [ ] **Step 1: Mobile viewport sweep**

In Playwright: resize viewport to 375×812 (iPhone). For each tab:
- Tab bar reachable, all 5 labels readable
- Primary CTA (Add habit, Save sleep, FAB, Send meal) thumb-reachable
- No horizontal scroll
- Modals fit screen
- Chat panel opens, doesn't overlap tab bar

Fix any overflow / clipping found.

- [ ] **Step 2: Empty-state sweep**

Clear localStorage. Visit each tab.
- Habits: "No habits yet. Start with one." + working "＋ New" button
- Sleep: form visible, "No entries yet." in list
- Weight: hero "—", "No goal set", "Log at least 2 entries…" in chart slot, FAB visible
- Meals: zeros, "No meals logged for this day.", working day nav

- [ ] **Step 3: Cross-mount safety**

Rapidly switch tabs 10× in sequence. Check via devtools that:
- No accumulating event listeners (window listener count stays stable)
- No leftover modal backdrops
- No console errors

Fix any tracker whose `unmount` leaks (most likely culprit: modal listeners attached to `document.body`).

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "fix: polish from mobile + empty-state + leak sweep"
```

---

## Done

Tag the release:

```bash
git tag vox-v2-life-hub
```

All 5 tabs working, all data persisting to localStorage, Gemini drives meals + briefing + chat with full cross-tracker context.
