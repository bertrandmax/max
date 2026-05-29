import { getTasks, addTask, deleteTask, toggleTask, updateTask } from '../storage.js?v=10';
import { parseTask, hasApiKey } from '../gemini.js?v=10';
import { isSupported, createRecognition } from '../speech.js?v=10';

// ── Template ──────────────────────────────────
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
    <button id="mic-btn" class="mic-btn" aria-label="Voice input">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/>
        <path d="M5 11a7 7 0 0014 0" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M9 21h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
    <input id="task-input" type="text" class="task-input" placeholder="Add a task or speak…" autocomplete="off" spellcheck="false" aria-label="New task">
    <button id="add-btn" class="add-btn" aria-label="Add task">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
`;

// ── State ─────────────────────────────────────
let currentFilter = 'all';
let recognition   = null;
let isListening   = false;

// ── Listener tracking ─────────────────────────
let unmountFns = [];
function on(el, evt, fn) {
  el.addEventListener(evt, fn);
  unmountFns.push(() => el.removeEventListener(evt, fn));
}

// ── DOM refs (resolved at mount time) ─────────
let taskInput, addBtn, micBtn, taskList, emptyState, taskCount, voiceOverlay, voiceTranscript, voiceStopBtn, brandDot;
let mountedContainer = null;

function resolveDom(container) {
  mountedContainer = container;
  taskInput       = container.querySelector('#task-input');
  addBtn          = container.querySelector('#add-btn');
  micBtn          = container.querySelector('#mic-btn');
  taskList        = container.querySelector('#task-list');
  emptyState      = container.querySelector('#empty-state');
  taskCount       = container.querySelector('#task-count');
  voiceOverlay    = document.getElementById('voice-overlay');
  voiceTranscript = document.getElementById('voice-transcript-display');
  voiceStopBtn    = document.getElementById('voice-stop-btn');
  brandDot        = document.getElementById('brand-dot');
}

// ── Module interface ──────────────────────────
export function mount(container) {
  container.innerHTML = TEMPLATE;
  resolveDom(container);

  // Show or hide the no-key banner based on whether a key is saved
  const banner = container.querySelector('#no-key-banner');
  if (banner) banner.classList.toggle('hidden', hasApiKey());

  // Wire the "add one" inline button to open settings
  const openBtn = container.querySelector('#open-settings-inline');
  if (openBtn) {
    on(openBtn, 'click', () => {
      const settingsPanel = document.getElementById('settings-panel');
      const apiKeyInput   = document.getElementById('api-key-input');
      settingsPanel?.classList.remove('hidden');
      apiKeyInput?.focus();
    });
  }

  setupVoice();
  setupTaskEvents();
  renderTasks();
}

export function unmount() {
  if (isListening) { try { recognition?.stop(); } catch {} }
  unmountFns.forEach(fn => fn());
  unmountFns = [];
}

export function getContext() {
  return getTasks();
}

// ── Voice ─────────────────────────────────────
function setupVoice() {
  if (!isSupported()) {
    micBtn.classList.add('no-support');
    micBtn.title = 'Voice input not supported in this browser';
    return;
  }

  recognition = createRecognition();

  recognition.onstart = () => {
    isListening = true;
    voiceOverlay.classList.add('active');
    voiceOverlay.setAttribute('aria-hidden', 'false');
    voiceTranscript.textContent = 'Listening…';
    micBtn.classList.add('listening');
    brandDot.classList.add('listening');
  };

  recognition.onresult = e => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    voiceTranscript.textContent = transcript || 'Listening…';
    taskInput.value = transcript;
  };

  recognition.onend   = endListening;
  recognition.onerror = endListening;

  on(micBtn, 'click', () => {
    if (isListening) stopListening();
    else             startListening();
  });

  on(voiceStopBtn, 'click', stopListening);
  on(voiceOverlay, 'click', e => {
    if (e.target === voiceOverlay) stopListening();
  });
}

function startListening() {
  if (!recognition) return;
  try { recognition.start(); } catch { /* already running */ }
}

function stopListening() {
  if (!recognition) return;
  recognition.stop();
}

function endListening() {
  isListening = false;
  if (voiceOverlay) {
    voiceOverlay.classList.remove('active');
    voiceOverlay.setAttribute('aria-hidden', 'true');
  }
  if (micBtn) micBtn.classList.remove('listening');
  if (brandDot) brandDot.classList.remove('listening');
}

// ── Events ────────────────────────────────────
function setupTaskEvents() {
  on(addBtn,    'click',   handleAddTask);
  on(taskInput, 'keydown', e => { if (e.key === 'Enter') handleAddTask(); });

  // Filter tabs
  const tabs = mountedContainer.querySelectorAll('.filter-tabs .tab');
  tabs.forEach(tab => {
    on(tab, 'click', () => {
      currentFilter = tab.dataset.filter;
      tabs.forEach(t => {
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab);
      });
      renderTasks();
    });
  });
}

// ── Add Task ──────────────────────────────────
async function handleAddTask() {
  const raw = taskInput.value.trim();
  if (!raw) return;

  taskInput.value    = '';
  taskInput.disabled = true;
  addBtn.disabled    = true;

  // Optimistic add with parsing state
  const id   = crypto.randomUUID();
  const task = {
    id,
    title:     raw,
    rawInput:  raw,
    priority:  'medium',
    category:  'other',
    dueDate:   null,
    dueTime:   null,
    completed: false,
    createdAt: new Date().toISOString(),
    parsing:   hasApiKey()
  };

  addTask(task);
  renderTasks();

  // Parse with Gemini if key available
  if (hasApiKey()) {
    try {
      const parsed = await parseTask(raw);
      updateTask(id, { ...parsed, parsing: false });
    } catch {
      updateTask(id, { parsing: false });
    }
    renderTasks();
  }

  taskInput.disabled = false;
  addBtn.disabled    = false;
  taskInput.focus();
}

// ── Render Tasks ──────────────────────────────
function renderTasks() {
  const all = getTasks();
  const visible = all.filter(t => {
    if (currentFilter === 'active')    return !t.completed;
    if (currentFilter === 'completed') return t.completed;
    return true;
  });

  taskList.innerHTML = '';
  emptyState.classList.toggle('hidden', visible.length > 0);

  taskCount.textContent = visible.length > 0 ? `${visible.length} task${visible.length !== 1 ? 's' : ''}` : '';

  visible.forEach((task, i) => {
    const el = buildTaskEl(task);
    el.style.animationDelay = `${Math.min(i * 35, 280)}ms`;
    taskList.appendChild(el);
  });
}

function buildTaskEl(task) {
  const el   = document.createElement('div');
  const prio = task.priority || 'medium';
  el.className = `task-card priority--${prio}${task.completed ? ' task-card--done' : ''}`;
  el.setAttribute('role', 'listitem');

  const dueLabel = formatDue(task.dueDate, task.dueTime);
  const dueCls   = getDueCls(task.dueDate, task.completed);

  el.innerHTML = `
    <button class="task-check" aria-label="${task.completed ? 'Mark incomplete' : 'Mark complete'}">
      ${task.completed ? svgCheck() : svgCircle()}
    </button>
    <div class="task-content">
      <div class="task-title">${escapeHtml(task.title)}</div>
      <div class="task-meta">
        ${dueLabel ? `<span class="task-due ${dueCls}">${escapeHtml(dueLabel)}</span>` : ''}
        ${task.category && task.category !== 'other' ? `<span class="task-category">${task.category}</span>` : ''}
        ${task.parsing ? '<span class="task-parsing">AI parsing…</span>' : ''}
      </div>
    </div>
    <button class="task-delete" aria-label="Delete task">
      ${svgTrash()}
    </button>
  `;

  on(el.querySelector('.task-check'), 'click', () => {
    toggleTask(task.id);
    renderTasks();
  });

  on(el.querySelector('.task-delete'), 'click', () => {
    el.classList.add('task-card--removing');
    setTimeout(() => { deleteTask(task.id); renderTasks(); }, 220);
  });

  return el;
}

// ── Date Helpers ──────────────────────────────
function formatDue(date, time) {
  if (!date) return null;
  const today    = todayStr();
  const tomorrow = tomorrowStr();
  let label;
  if (date === today)         label = 'Today';
  else if (date === tomorrow) label = 'Tomorrow';
  else {
    const d = new Date(date + 'T00:00:00');
    label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  if (time) label += ` · ${fmt12(time)}`;
  return label;
}

function getDueCls(date, completed) {
  if (!date || completed) return '';
  if (date < todayStr()) return 'overdue';
  if (date === todayStr()) return 'today';
  return '';
}

function todayStr()    { return new Date().toISOString().split('T')[0]; }
function tomorrowStr() { return new Date(Date.now() + 86400000).toISOString().split('T')[0]; }

function fmt12(t) {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}

// ── SVG Helpers ───────────────────────────────
function svgCheck() {
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="10" fill="var(--accent)"/>
    <path d="M7 11l3 3 5-5" stroke="var(--bg)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

function svgCircle() {
  return `<svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="10" stroke="var(--border2)" stroke-width="1.5"/>
  </svg>`;
}

function svgTrash() {
  return `<svg width="15" height="15" viewBox="0 0 15 15" fill="none">
    <path d="M1.5 3.5h12M5 3.5V2.5a1 1 0 011-1h3a1 1 0 011 1v1M5.5 6.5v5M9.5 6.5v5M2.5 3.5l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"
      stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

// ── Security ──────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}
