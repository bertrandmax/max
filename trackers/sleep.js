import { get, set } from '../storage.js?v=14';

const KEY = 'vox_sleep';
let removers = [];
let container = null;

export function mount(el) { container = el; render(); }
export function unmount() { removers.forEach(fn => fn()); removers = []; container = null; }
export function getContext() {
  return get(KEY, []).slice(0, 14);
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
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return localDateStr(d); }

function computeHours(bedtime, wake) {
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

  const bars = Array.from({ length: 7 }, (_, i) => {
    const offset = 6 - i;
    const dateStr = daysAgo(offset);
    const entry = all.find(e => e.date === dateStr);
    const hours = entry?.hours ?? 0;
    const quality = entry?.quality ?? 0;
    const pct = Math.min(100, (hours / 12) * 100);
    const dayLetter = ['S','M','T','W','T','F','S'][new Date(dateStr + 'T00:00:00').getDay()];
    return `
      <div class="sleep-bar-col">
        <div class="sleep-bar-track">
          <div class="sleep-bar-fill q${quality}" style="height:${pct}%" title="${dateStr}: ${hours || '—'}h"></div>
        </div>
        <div class="sleep-bar-label">${dayLetter}</div>
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
