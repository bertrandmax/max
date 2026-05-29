import { get, set } from '../storage.js?v=14';

const KEY = 'vox_weight';
const GOAL_KEY = 'vox_weight_goal';

let removers = [];
let container = null;

export function mount(el) { container = el; render(); }
export function unmount() {
  removers.forEach(fn => fn());
  removers = [];
  document.querySelectorAll('.modal-backdrop[data-from="weight"]').forEach(m => m.remove());
  container = null;
}
export function getContext() {
  return { entries: get(KEY, []).slice(0, 30), goal: get(GOAL_KEY, null) };
}
export function refresh() { if (container) render(); }

function on(el, evt, fn) { el.addEventListener(evt, fn); removers.push(() => el.removeEventListener(evt, fn)); }
function localDateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function today() { return localDateStr(new Date()); }

function addEntry(weight, date) {
  const all = get(KEY, []).filter(e => e.date !== date);
  all.unshift({ id: crypto.randomUUID(), date, weight });
  all.sort((a, b) => b.date.localeCompare(a.date));
  set(KEY, all);
}

function deleteEntry(id) { set(KEY, get(KEY, []).filter(e => e.id !== id)); }

function svgChart(entries, goal) {
  if (entries.length < 2) return '<p class="empty-sub" style="padding:1rem 1.25rem">Log at least 2 entries to see trend.</p>';
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
  const dots = sorted.map((e, i) => {
    const x = PAD + (i / (sorted.length - 1)) * (W - 2 * PAD);
    const y = H - PAD - ((e.weight - min) / range) * (H - 2 * PAD);
    return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--yellow)"/>`;
  }).join('');
  return `
    <svg class="weight-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${goal ? `<line x1="${PAD}" x2="${W - PAD}" y1="${goalY}" y2="${goalY}" stroke="var(--yellow)" stroke-width="1" stroke-dasharray="3,3" opacity="0.6"/>` : ''}
      <polyline points="${points}" fill="none" stroke="var(--yellow)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
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
  modal.dataset.from = 'weight';
  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="modal-title">Log weight</h3>
      <input type="number" step="0.1" id="w-val" class="modal-input" placeholder="Weight in ${unit}" autocomplete="off" aria-label="Weight in ${unit}">
      <input type="date" id="w-date" class="modal-input" value="${today()}" max="${today()}" aria-label="Date">
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
  modal.dataset.from = 'weight';
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
