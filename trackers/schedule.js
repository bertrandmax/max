import { get, set, getTasks, toggleTask } from '../storage.js?v=15';
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

function render() {
  const dayLabel = viewDate === todayStr() ? `Today · ${fmtDayLabel(viewDate)}` : fmtDayLabel(viewDate);
  const occs = timelineOccurrences(viewDate);
  assignColumns(occs);

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
  scrollToFocus();
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

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

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
    if (state.endTime && toMin(state.endTime) <= toMin(state.startTime)) {
      alert('End time must be later than start time.'); return;
    }
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
