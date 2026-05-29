import { get, set } from '../storage.js?v=11';
import { parseMeal, hasApiKey } from '../gemini.js?v=11';

const KEY = 'vox_meals';
let removers = [];
let container = null;
let viewDate = todayStr();

export function mount(el) {
  container = el;
  // Clean up any stuck _parsing entries from prior crashed mounts
  const all = get(KEY, []);
  if (all.some(m => m._parsing)) {
    set(KEY, all.map(m => m._parsing ? { ...m, _parsing: false, _failed: true } : m));
  }
  render();
}
export function unmount() { removers.forEach(fn => fn()); removers = []; container = null; }
export function getContext() {
  const all = get(KEY, []);
  const cutoff = daysAgo(7);
  return all.filter(m => m.date >= cutoff);
}

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(new Date()); }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }

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
      <button class="day-arrow" id="day-prev" aria-label="Previous day">&#9664;</button>
      <span class="day-label">${dayLabel}</span>
      <button class="day-arrow" id="day-next" aria-label="Next day" ${isToday ? 'disabled' : ''}>&#9654;</button>
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
        <div class="meal-row ${m._failed ? 'failed' : ''} ${m._parsing ? 'parsing' : ''}">
          <div class="meal-main">
            <div class="meal-name">${escapeHtml(m.name)}</div>
            <div class="meal-meta">${m._parsing ? 'parsing…' : `${m.grams ? m.grams + 'g \xb7 ' : ''}${m.calories} kcal \xb7 P${m.protein} C${m.carbs} F${m.fat}${m._failed ? ' \xb7 parse failed' : ''}`}</div>
          </div>
          <button class="task-delete" data-id="${m.id}" aria-label="Delete">\xd7</button>
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
      // fall through — record stays as _parsing or gets cleared on mount
    }
    if (!container) return;   // tab switched away
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
