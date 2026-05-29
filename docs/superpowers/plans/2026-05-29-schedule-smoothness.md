# Schedule & Cross-App Smoothness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Schedule page friction-free for daily mobile-web/PWA use — auto-scroll to now, side-by-side overlapping events, a week overview strip, due-timed tasks surfaced on the timeline, and a mobile polish pass.

**Architecture:** All behavior lives in `trackers/schedule.js` (the standard `mount`/`unmount`/`getContext`/`refresh` tracker module). Tasks are read via `getTasks()` and toggled via `toggleTask()` from `storage.js` and merged into the occurrence pipeline as pseudo-occurrences before a column-layout pass positions every block. Styling is added to `style.css`. No schema, no backend, no new dependencies.

**Tech Stack:** Vanilla ES modules, no build step. Static files served locally for verification. Playwright MCP drives the browser, seeding `localStorage` to create deterministic state.

---

## Conventions for every task

- **No test runner exists.** Verification = drive the app in a browser via Playwright MCP against seeded `localStorage`, then read a snapshot/screenshot. This replaces unit tests.
- **Serve the app** (once, kept running for all tasks):
  ```bash
  python3 -m http.server 8123 --directory . >/tmp/sched-serve.log 2>&1 &
  ```
  App URL: `http://localhost:8123/`. Stop with `kill %1` (or the matching PID) when done.
- **Seeding pattern** (used in verification steps) — run in the browser via `browser_evaluate`, then reload:
  ```js
  () => {
    localStorage.setItem('vox_active_tab', '"schedule"');
    localStorage.setItem('vox_schedule_items', JSON.stringify(ITEMS));
    localStorage.setItem('vox_schedule_done', '[]');
    localStorage.setItem('vox_tasks', JSON.stringify(TASKS));
  }
  ```
  (Where `ITEMS`/`TASKS` are inlined per task. `vox_active_tab` is stored JSON-stringified because `set()`/`get()` JSON-encode values.)
- **Cache-bust:** touched module imports currently use `?v=15`. When editing `schedule.js`, bump its import query strings to `?v=16` **and** bump the `<script>`/import references that load it. Check first whether `index.html`/`app.js` reference a version; only bump what exists. If unsure, leave versions and hard-reload in Playwright with cache disabled (`browser_navigate` already loads fresh). **Decision: do not churn version strings** — Playwright loads fresh each navigate, so skip version bumps entirely for this plan.
- **Commit after each task.**

---

## File structure

| File | Responsibility after this plan |
| --- | --- |
| `trackers/schedule.js` | Day timeline + week strip + merged event/routine/task occurrences + column layout + auto-scroll. |
| `style.css` | Week strip, untimed row, task-block tint, column-split block rules, mobile/safe-area/bottom-sheet polish. |
| `storage.js` | Unchanged — `getTasks`, `toggleTask`, `get`, `set` already exported. |

---

## Task 1: Merge due-timed tasks into the occurrence pipeline

**Files:**
- Modify: `trackers/schedule.js` (imports near line 1; add helpers after `occurrencesFor`, ~line 75; use in `render` ~line 79)

- [ ] **Step 1: Add `getTasks`, `toggleTask` to the storage import**

Change line 1 of `trackers/schedule.js` from:
```js
import { get, set } from '../storage.js?v=15';
```
to:
```js
import { get, set, getTasks, toggleTask } from '../storage.js?v=15';
```

- [ ] **Step 2: Add task helpers and a merged-occurrences function**

Insert immediately after the `occurrencesFor` function (after its closing `}`, ~line 75):
```js
function inGrid(t) { const m = toMin(t); return m >= START_HR * 60 && m <= (END_HR + 1) * 60; }

function tasksForDate(date) { return getTasks().filter(t => t.dueDate === date); }

function timedTaskOccurrences(date) {
  return tasksForDate(date)
    .filter(t => t.dueTime && inGrid(t.dueTime))
    .map(t => ({
      id: 'task:' + t.id, _task: true, taskId: t.id,
      title: t.title, startTime: t.dueTime, endTime: null,
      category: 'task', done: !!t.completed
    }));
}

function untimedTasks(date) {
  return tasksForDate(date).filter(t => !t.dueTime || !inGrid(t.dueTime));
}

// Events + routines + due-timed tasks, sorted by start time.
function timelineOccurrences(date) {
  return [...occurrencesFor(date), ...timedTaskOccurrences(date)]
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
}
```

- [ ] **Step 3: Use `timelineOccurrences` in `render`**

In `render()` change:
```js
  const occs = occurrencesFor(viewDate);
```
to:
```js
  const occs = timelineOccurrences(viewDate);
```

- [ ] **Step 4: Verify timed task appears as a block**

Start the server (see Conventions). In Playwright: `browser_navigate` to `http://localhost:8123/`, then `browser_evaluate` with today computed live:
```js
() => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vox_active_tab', '"schedule"');
  localStorage.setItem('vox_schedule_items', '[]');
  localStorage.setItem('vox_schedule_done', '[]');
  localStorage.setItem('vox_tasks', JSON.stringify([
    { id:'t1', title:'Call dentist', dueDate: today, dueTime:'10:00', completed:false }
  ]));
}
```
Reload (`browser_navigate` again). Snapshot.
Expected: a `.sched-block` with title "☑ Call dentist" at the 10:00 row. (Verification only — no time-math assertion needed beyond it being present and labeled as a task.)

- [ ] **Step 5: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): merge due-timed tasks into timeline occurrences

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Side-by-side column layout for overlapping blocks

**Files:**
- Modify: `trackers/schedule.js` (add `assignColumns` after `timelineOccurrences`; call it in `render`; rewrite `blockMarkup` ~line 144)
- Modify: `style.css` (`.sched-block` left/right rule ~line 1377)

- [ ] **Step 1: Add the column-assignment algorithm**

Insert after `timelineOccurrences` (from Task 1):
```js
// Greedy interval partitioning. Mutates each occ with _col (column index)
// and _cols (column count in its overlap cluster). occs MUST be start-sorted.
function assignColumns(occs) {
  const items = occs.map(o => {
    const start = toMin(o.startTime);
    const dur = Math.max(30, o.endTime ? toMin(o.endTime) - toMin(o.startTime) : 30);
    return { o, start, end: start + dur };
  });
  let i = 0;
  while (i < items.length) {
    let j = i, maxEnd = items[i].end;
    while (j + 1 < items.length && items[j + 1].start < maxEnd) {
      j++; maxEnd = Math.max(maxEnd, items[j].end);
    }
    const cluster = items.slice(i, j + 1);
    const colEnds = [];
    cluster.forEach(it => {
      let placed = false;
      for (let c = 0; c < colEnds.length; c++) {
        if (colEnds[c] <= it.start) { colEnds[c] = it.end; it.o._col = c; placed = true; break; }
      }
      if (!placed) { it.o._col = colEnds.length; colEnds.push(it.end); }
    });
    cluster.forEach(it => { it.o._cols = colEnds.length; });
    i = j + 1;
  }
  return occs;
}
```

- [ ] **Step 2: Call `assignColumns` in `render`**

Right after `const occs = timelineOccurrences(viewDate);` add:
```js
  assignColumns(occs);
```

- [ ] **Step 3: Rewrite `blockMarkup` to position by column**

Replace the entire `blockMarkup` function (~lines 144–158) with:
```js
function blockMarkup(o) {
  const startMin = toMin(o.startTime) - START_HR * 60;
  const durMin = Math.max(30, o.endTime ? (toMin(o.endTime) - toMin(o.startTime)) : 30);
  const top = (startMin / 60) * HOUR_PX;
  const height = (durMin / 60) * HOUR_PX;
  const cols = o._cols || 1;
  const col = o._col || 0;
  const gap = 2; // px gutter between columns
  const widthPct = 100 / cols;
  const leftPct = col * widthPct;
  const cat = o._task ? 'task' : (o.category || 'other');
  const moreBtn = o._task
    ? ''
    : `<button class="sched-block-more" aria-label="More actions" data-id="${o.id}">⋯</button>`;
  return `
    <div class="sched-block cat-${cat} ${o.done ? 'done' : ''} ${o._parsing ? 'parsing' : ''} ${o._task ? 'is-task' : ''}"
         data-id="${o.id}" ${o._task ? `data-task="${o.taskId}"` : ''}
         style="top:${top}px;height:${height}px;left:calc(${leftPct}% + ${gap}px);width:calc(${widthPct}% - ${gap * 2}px)">
      <div class="sched-block-title">${o._task ? '☑ ' : ''}${escapeHtml(o.title)}</div>
      <div class="sched-block-time">${o.startTime}${o.endTime ? '–' + o.endTime : ''}${o._parsing ? ' · parsing…' : ''}</div>
      ${moreBtn}
    </div>
  `;
}
```

- [ ] **Step 4: Drop the conflicting `left/right` from `.sched-block` CSS**

In `style.css` change the `.sched-block` rule (~line 1377–1378) from:
```css
.sched-block {
  position: absolute; left: .25rem; right: .25rem;
```
to:
```css
.sched-block {
  position: absolute;
```
(Inline `left`/`width` now control horizontal placement; leaving `right` would over-constrain.)

- [ ] **Step 5: Verify two same-time events sit side-by-side**

Playwright seed (after `browser_navigate`):
```js
() => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vox_active_tab', '"schedule"');
  localStorage.setItem('vox_schedule_done', '[]');
  localStorage.setItem('vox_tasks', '[]');
  localStorage.setItem('vox_schedule_items', JSON.stringify([
    { id:'a', kind:'event', title:'Standup',  startTime:'14:00', endTime:'15:00', date: today, category:'work',     createdAt:new Date().toISOString() },
    { id:'b', kind:'event', title:'1:1 Sarah', startTime:'14:00', endTime:'14:30', date: today, category:'personal', createdAt:new Date().toISOString() }
  ]));
}
```
Reload. Then `browser_evaluate`:
```js
() => [...document.querySelectorAll('.sched-block')].map(b => ({ t: b.querySelector('.sched-block-title').textContent.trim(), left: b.style.left, width: b.style.width }))
```
Expected: two blocks, one with `left: calc(0% + 2px)` and one with `left: calc(50% + 2px)`, each `width: calc(50% - 4px)`.

- [ ] **Step 6: Commit**

```bash
git add trackers/schedule.js style.css
git commit -m "feat(schedule): side-by-side layout for overlapping blocks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Auto-scroll to now / first event after render

**Files:**
- Modify: `trackers/schedule.js` (add `scrollToFocus`; call at end of `render`)

- [ ] **Step 1: Add `scrollToFocus`**

Insert after `nowLineMarkup` (~line 142):
```js
function scrollToFocus() {
  requestAnimationFrame(() => {
    const tl = container?.querySelector('#timeline');
    if (!tl) return;
    let targetTop = null;
    if (viewDate === todayStr()) {
      const nl = tl.querySelector('.now-line');
      if (nl) targetTop = parseFloat(nl.style.top);
    }
    if (targetTop == null) {
      const first = tl.querySelector('.sched-block');
      if (first) targetTop = parseFloat(first.style.top);
    }
    if (targetTop == null) return;
    const absY = window.scrollY + tl.getBoundingClientRect().top + targetTop;
    window.scrollTo({ top: Math.max(0, absY - window.innerHeight / 3), behavior: 'smooth' });
  });
}
```

- [ ] **Step 2: Call it at the end of `render`**

At the very end of `render()` (after the `if (jumpBtn) ...` line, before the closing `}`), add:
```js
  scrollToFocus();
```

- [ ] **Step 3: Verify it scrolls away from the top on today**

Playwright: seed an event at a late hour so scroll is observable, reload:
```js
() => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vox_active_tab', '"schedule"');
  localStorage.setItem('vox_schedule_done', '[]');
  localStorage.setItem('vox_tasks', '[]');
  localStorage.setItem('vox_schedule_items', JSON.stringify([
    { id:'late', kind:'event', title:'Evening run', startTime:'21:00', endTime:'21:30', date: today, category:'health', createdAt:new Date().toISOString() }
  ]));
}
```
Reload, wait ~500ms (`browser_wait_for` time), then `browser_evaluate`:
```js
() => window.scrollY
```
Expected: `window.scrollY > 0` (page scrolled toward the now-line / event rather than sitting at 6:00). If it returns `0`, the scroll container is not `window`; in that case find the scrollable ancestor of `#timeline` and scroll that instead — adjust `scrollToFocus` to walk up parents checking `scrollHeight > clientHeight` and overflow, then re-verify.

- [ ] **Step 4: Commit**

```bash
git add trackers/schedule.js
git commit -m "feat(schedule): auto-scroll timeline to now / first event

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Week overview strip

**Files:**
- Modify: `trackers/schedule.js` (add `weekStartStr`, `weekStripMarkup`, `wireWeekStrip`; insert markup in `render`; call wiring in `render`)
- Modify: `style.css` (week strip styles)

- [ ] **Step 1: Add week helpers and markup**

Insert after `fmtDayLabel` (~line 54):
```js
function weekStartStr(date) {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() - d.getDay()); // Sunday=0 start
  return localDateStr(d);
}

function weekStripMarkup() {
  const start = weekStartStr(viewDate);
  const today = todayStr();
  const cells = [0,1,2,3,4,5,6].map(i => {
    const ds = shiftDate(start, i);
    const count = timelineOccurrences(ds).length;
    const dots = '•'.repeat(Math.min(3, count));
    const d = new Date(ds + 'T00:00:00');
    const letter = d.toLocaleDateString('en-US', { weekday: 'narrow' });
    return `<button class="week-day ${ds === viewDate ? 'selected' : ''} ${ds === today ? 'today' : ''}" data-date="${ds}">
      <span class="wd-letter">${letter}</span>
      <span class="wd-num">${d.getDate()}</span>
      <span class="wd-dots">${dots}</span>
    </button>`;
  }).join('');
  return `<div class="week-nav">
    <button class="week-arrow" id="week-prev" aria-label="Previous week">&#8249;</button>
    <div class="week-strip">${cells}</div>
    <button class="week-arrow" id="week-next" aria-label="Next week">&#8250;</button>
  </div>`;
}
```

- [ ] **Step 2: Add `wireWeekStrip`**

Insert after `wireNav` (~line 177):
```js
function wireWeekStrip() {
  container.querySelectorAll('.week-day').forEach(el =>
    on(el, 'click', () => { viewDate = el.dataset.date; render(); }));
  const wp = container.querySelector('#week-prev');
  const wn = container.querySelector('#week-next');
  if (wp) on(wp, 'click', () => { viewDate = shiftDate(viewDate, -7); render(); });
  if (wn) on(wn, 'click', () => { viewDate = shiftDate(viewDate,  7); render(); });
}
```

- [ ] **Step 3: Insert the strip markup in `render`**

In the `container.innerHTML = ...` template, add the strip between the `.day-nav` `</div>` and the `.schedule-timeline` div:
```js
    ${weekStripMarkup()}

    <div class="schedule-timeline" id="timeline" style="height:${(END_HR - START_HR + 1) * HOUR_PX}px">
```
(i.e. the line `${weekStripMarkup()}` goes immediately before the existing timeline `<div>`.)

- [ ] **Step 4: Call `wireWeekStrip()` in `render`**

After the existing `wireNav();` call add:
```js
  wireWeekStrip();
```

- [ ] **Step 5: Add week-strip CSS**

Append to `style.css` after the schedule modal block (end of file is fine):
```css
/* ── Week strip ─────────────────────────────── */
.week-nav { display: flex; align-items: stretch; gap: .25rem; padding: 0 .75rem .25rem; }
.week-strip { display: flex; flex: 1; gap: .25rem; }
.week-arrow {
  flex: 0 0 auto; min-width: 32px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  color: var(--ink2);
}
.week-day {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  padding: .35rem 0 .25rem;
  background: var(--bg3); border: 1px solid var(--border); border-radius: 8px;
  color: var(--ink2); cursor: pointer;
}
.week-day .wd-letter { font-size: .62rem; text-transform: uppercase; color: var(--ink3); }
.week-day .wd-num { font-family: var(--font-display); font-weight: 700; font-size: .95rem; color: var(--ink); }
.week-day .wd-dots { font-size: .5rem; line-height: .5rem; height: .6rem; color: var(--accent); letter-spacing: 1px; }
.week-day.today { border-color: var(--accent); }
.week-day.selected { background: var(--accent); border-color: var(--accent); }
.week-day.selected .wd-letter,
.week-day.selected .wd-num,
.week-day.selected .wd-dots { color: var(--bg); }
```

- [ ] **Step 6: Verify the strip renders 7 days, marks today/selected, and jumps**

Playwright: seed empty schedule on `schedule` tab, reload, then `browser_evaluate`:
```js
() => {
  const days = [...document.querySelectorAll('.week-day')];
  return {
    count: days.length,
    hasToday: days.some(d => d.classList.contains('today')),
    selected: days.filter(d => d.classList.contains('selected')).length
  };
}
```
Expected: `{ count: 7, hasToday: true, selected: 1 }`.
Then `browser_click` the first `.week-day`, and `browser_evaluate` `() => document.querySelector('.week-day.selected')?.dataset.date` — expected: the first day's date (selection moved).

- [ ] **Step 7: Commit**

```bash
git add trackers/schedule.js style.css
git commit -m "feat(schedule): week overview strip with density and jump

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Untimed-task row + task block interaction

**Files:**
- Modify: `trackers/schedule.js` (`untimedMarkup`; insert in `render`; extend `wireBlocks` for tasks + untimed chips)
- Modify: `style.css` (untimed row + task-block tint)

- [ ] **Step 1: Add `untimedMarkup`**

Insert after `weekStripMarkup` (from Task 4):
```js
function untimedMarkup(date) {
  const ut = untimedTasks(date);
  if (!ut.length) return '';
  return `<div class="untimed-row">${ut.map(t =>
    `<button class="untimed-chip ${t.completed ? 'done' : ''}" data-task="${t.id}">
      <span class="untimed-check">☑</span>${escapeHtml(t.title)}${t.dueTime ? ` <span class="untimed-time">${t.dueTime}</span>` : ''}
    </button>`).join('')}</div>`;
}
```

- [ ] **Step 2: Insert untimed row in `render`**

Add `${untimedMarkup(viewDate)}` immediately after `${weekStripMarkup()}` and before the timeline `<div>`:
```js
    ${weekStripMarkup()}
    ${untimedMarkup(viewDate)}

    <div class="schedule-timeline" id="timeline" ...>
```

- [ ] **Step 3: Extend `wireBlocks` for task blocks and untimed chips**

Replace the `wireBlocks` function (~lines 178–196) with:
```js
function wireBlocks(occs) {
  container.querySelectorAll('.sched-block').forEach(el => {
    if (el.classList.contains('is-task')) {
      on(el, 'click', () => { toggleTask(el.dataset.task); render(); });
      return;
    }
    const id = el.dataset.id;
    const item = occs.find(o => o.id === id);
    if (!item) return;
    on(el, 'click', e => {
      if (e.target.classList.contains('sched-block-more')) return;
      toggleDone(item.id, viewDate);
      render();
    });
    const more = el.querySelector('.sched-block-more');
    if (more) on(more, 'click', e => { e.stopPropagation(); openModal(item); });
  });
  container.querySelectorAll('.untimed-chip').forEach(el =>
    on(el, 'click', () => { toggleTask(el.dataset.task); render(); }));
}
```

- [ ] **Step 4: Add task-block + untimed-row CSS**

Append to `style.css`:
```css
/* ── Tasks on schedule ──────────────────────── */
.sched-block.cat-task { border-left-color: var(--accent); border-left-style: dashed; }
.sched-block.is-task .sched-block-title { color: var(--ink2); }

.untimed-row { display: flex; flex-wrap: wrap; gap: .35rem; padding: .25rem 1rem .5rem; }
.untimed-chip {
  display: inline-flex; align-items: center; gap: .3rem;
  max-width: 100%;
  padding: .3rem .6rem;
  background: var(--bg3); border: 1px dashed var(--border2); border-radius: 999px;
  color: var(--ink2); font-size: .8rem; cursor: pointer;
}
.untimed-chip .untimed-check { color: var(--accent); }
.untimed-chip .untimed-time { font-family: var(--font-mono); font-size: .7rem; color: var(--ink3); }
.untimed-chip.done { opacity: .5; text-decoration: line-through; }
```

- [ ] **Step 5: Verify untimed chip + completing a task block**

Playwright seed (timed + untimed task today), reload:
```js
() => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vox_active_tab', '"schedule"');
  localStorage.setItem('vox_schedule_items', '[]');
  localStorage.setItem('vox_schedule_done', '[]');
  localStorage.setItem('vox_tasks', JSON.stringify([
    { id:'tt', title:'Submit report', dueDate: today, dueTime:'11:00', completed:false },
    { id:'uu', title:'Buy milk',      dueDate: today, dueTime:null,    completed:false }
  ]));
}
```
Reload. `browser_evaluate`:
```js
() => ({ chips: [...document.querySelectorAll('.untimed-chip')].map(c => c.textContent.trim()),
         taskBlocks: [...document.querySelectorAll('.sched-block.is-task')].map(b => b.dataset.task) })
```
Expected: chips include "Buy milk"; taskBlocks includes `"tt"`.
Then `browser_click` the task block (`.sched-block.is-task`), then `browser_evaluate`:
```js
() => JSON.parse(localStorage.getItem('vox_tasks')).find(t => t.id==='tt').completed
```
Expected: `true`.

- [ ] **Step 6: Commit**

```bash
git add trackers/schedule.js style.css
git commit -m "feat(schedule): untimed task row + complete tasks from timeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Mobile / PWA polish pass

**Files:**
- Modify: `style.css` (touch targets, scroll-margin, safe-area, bottom-sheet modal)

- [ ] **Step 1: Enlarge touch targets and add scroll-margin**

Append to `style.css`:
```css
/* ── Schedule mobile polish ─────────────────── */
.day-arrow { min-width: 44px; min-height: 44px; }
.week-arrow { min-height: 44px; }
.week-day { min-height: 44px; }
.sched-block-more { min-width: 44px; min-height: 32px; padding: 6px 10px; }
.schedule-timeline { scroll-margin-top: 96px; }
.sched-block { scroll-margin-top: 96px; }
.now-line { scroll-margin-top: 96px; }
```

- [ ] **Step 2: Make the add/edit modal a bottom sheet on narrow screens**

Append to `style.css`:
```css
@media (max-width: 480px) {
  .modal-backdrop[data-from="schedule"] { align-items: flex-end; }
  .modal-backdrop[data-from="schedule"] .modal-card {
    width: 100%; max-width: 100%;
    border-radius: 16px 16px 0 0;
    max-height: 88vh; overflow-y: auto;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
  }
}
```
(If `.modal-backdrop` does not already center its card via fl.align-items, this still applies — the rule only adjusts the schedule modal. Confirm the base `.modal-backdrop` is a flex container; if it is not, add `display:flex; align-items:center; justify-content:center;` to the base `.modal-backdrop` rule as part of this step.)

- [ ] **Step 3: Verify bottom-sheet at 375px**

Playwright: `browser_resize` to width 375, height 720. Seed schedule tab, reload. `browser_click` the `.fab`. `browser_evaluate`:
```js
() => {
  const card = document.querySelector('.modal-backdrop[data-from="schedule"] .modal-card');
  const r = card.getBoundingClientRect();
  return { width: Math.round(r.width), bottomGap: Math.round(window.innerHeight - r.bottom) };
}
```
Expected: `width` ≈ 375 (full width), `bottomGap` small (sheet anchored to bottom). Close the modal afterward (`browser_press_key` Escape or click backdrop) to leave clean state.

- [ ] **Step 4: Verify touch-target sizes**

`browser_evaluate`:
```js
() => ['.day-arrow', '.week-arrow', '.week-day'].map(sel => {
  const el = document.querySelector(sel); if (!el) return [sel, 'missing'];
  const r = el.getBoundingClientRect(); return [sel, Math.round(r.width), Math.round(r.height)];
})
```
Expected: each element's width and height ≥ 44 (week-day width may be <44 on a 375px screen split 7 ways — that is acceptable; height must be ≥44).

- [ ] **Step 5: Commit**

```bash
git add style.css
git commit -m "feat(schedule): mobile/PWA polish — touch targets, safe-area, bottom-sheet modal

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full smoke pass at 375px

**Files:** none (verification only)

- [ ] **Step 1: Run the full checklist**

With the server running, `browser_resize` 375×720. Seed a rich day, reload:
```js
() => {
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  localStorage.setItem('vox_active_tab', '"schedule"');
  localStorage.setItem('vox_schedule_done', '[]');
  localStorage.setItem('vox_schedule_items', JSON.stringify([
    { id:'a', kind:'event', title:'Standup',  startTime:'09:00', endTime:'09:30', date: today, category:'work',     createdAt:new Date().toISOString() },
    { id:'b', kind:'event', title:'1:1',       startTime:'09:00', endTime:'09:45', date: today, category:'personal', createdAt:new Date().toISOString() },
    { id:'c', kind:'event', title:'Lunch',     startTime:'12:30', endTime:'13:30', date: today, category:'health',   createdAt:new Date().toISOString() }
  ]));
  localStorage.setItem('vox_tasks', JSON.stringify([
    { id:'t1', title:'Email client', dueDate: today, dueTime:'15:00', completed:false },
    { id:'t2', title:'Water plants', dueDate: today, dueTime:null,    completed:false }
  ]));
}
```
Reload. Confirm via snapshot/evaluate:
- [ ] Two 09:00 events render side-by-side (`left` 0% and 50%).
- [ ] `window.scrollY > 0` (auto-scroll engaged).
- [ ] Week strip shows 7 cells, today ringed, one selected, density dots on today.
- [ ] Task "Email client" appears as a dashed task block at 15:00.
- [ ] "Water plants" appears as an untimed chip.
- [ ] Tap a task block → its task `completed` flips to `true` in `localStorage`.
- [ ] Tap a week-day cell → timeline switches to that day and re-scrolls.

- [ ] **Step 2: Stop the server**

```bash
kill %1 2>/dev/null || pkill -f "http.server 8123"
```

- [ ] **Step 3: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "test(schedule): smoke pass at 375px viewport" || echo "nothing to commit"
```

---

## Notes for the implementer

- Only one tracker is mounted at a time, so completing a task from the schedule writes to `localStorage` (`vox_tasks`) and the Tasks tab re-reads on its next mount — no cross-module call needed.
- `getContext()` stays events/routines only; tasks already have their own chat context via the tasks tracker.
- Routines, completion-per-date, voice, AI parsing, and the FAB modal are untouched by this plan beyond the `wireBlocks`/`render` edits above.
- Cross-midnight events, drag-to-move, and push reminders are explicitly out of scope (reminders = Project B).
