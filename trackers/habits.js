import { get, set } from '../storage.js?v=10';

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
  // cleanup any leftover modal
  document.querySelectorAll('.modal-backdrop[data-from="habits"]').forEach(m => m.remove());
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
  const start = isDone(habitId, today()) ? 0 : 1;
  for (let i = start; i < 365; i++) {
    if (isDone(habitId, daysAgo(i))) count++; else break;
  }
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
  modal.dataset.from = 'habits';
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
