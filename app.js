import * as tasks  from './trackers/tasks.js';
import * as habits from './trackers/habits.js';
import * as sleep  from './trackers/sleep.js';
import * as weight from './trackers/weight.js';
import * as meals  from './trackers/meals.js';
import { getTasks, get, set } from './storage.js';
import { chatWithAI, generateBriefing, getApiKey, setApiKey, hasApiKey } from './gemini.js';

// ── State ─────────────────────────────────────
let chatOpen = false;

// ── DOM ───────────────────────────────────────
const $ = id => document.getElementById(id);

const briefingBtn        = $('briefing-btn');
const briefingCard       = $('briefing-card');
const briefingContent    = $('briefing-content');
const closeBriefing      = $('close-briefing');
const settingsBtn        = $('settings-btn');
const settingsPanel      = $('settings-panel');
const apiKeyInput        = $('api-key-input');
const saveKeyBtn         = $('save-key-btn');
const keyStatus          = $('key-status');
const noKeyBanner        = $('no-key-banner');
const openSettingsInline = $('open-settings-inline');
const chatToggle         = $('chat-toggle');
const chatChevron        = $('chat-chevron');
const chatBody           = $('chat-body');
const chatMessages       = $('chat-messages');
const chatInput          = $('chat-input');
const chatSend           = $('chat-send');

// ── Router ────────────────────────────────────
const TRACKERS = { tasks, habits, sleep, weight, meals };
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

  // Show/hide the static Tasks DOM elements based on active tab
  // Note: #no-key-banner visibility is managed by loadApiKey/saveKey, not here
  const tasksDom = ['.filter-tabs', '#task-list', '#empty-state', '.input-bar'];
  tasksDom.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) el.style.display = (name === 'tasks') ? '' : 'none';
  });
  // Always keep no-key-banner hidden on non-tasks tabs; restore its class-driven state on tasks
  if (noKeyBanner) {
    if (name !== 'tasks') {
      noKeyBanner.style.display = 'none';
    } else {
      noKeyBanner.style.display = '';
    }
  }
}

// ── Init ──────────────────────────────────────
function init() {
  document.querySelectorAll('.tab-bar-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  const initial = get('vox_active_tab', 'tasks');
  switchTab(TRACKERS[initial] ? initial : 'tasks');
  wireSettings();
  wireChat();
}

// ── Settings ──────────────────────────────────
function wireSettings() {
  loadApiKey();

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
    if (!settingsPanel.classList.contains('hidden')) apiKeyInput.focus();
  });
  saveKeyBtn.addEventListener('click', saveKey);
  apiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
  $('test-key-btn').addEventListener('click', testKey);
  openSettingsInline?.addEventListener('click', () => {
    settingsPanel.classList.remove('hidden');
    apiKeyInput.focus();
  });

  // Close settings on outside click
  document.addEventListener('click', e => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsBtn && !settingsBtn.contains(e.target)) {
      settingsPanel.classList.add('hidden');
    }
  });

  // Briefing
  briefingBtn.addEventListener('click', handleBriefing);
  closeBriefing.addEventListener('click', () => briefingCard.classList.add('hidden'));
}

// ── API Key ───────────────────────────────────
async function testKey() {
  const key = apiKeyInput.value.trim();
  if (!key) { keyStatus.textContent = 'Enter a key first.'; keyStatus.style.color = 'var(--yellow)'; return; }
  keyStatus.textContent = 'Testing…'; keyStatus.style.color = 'var(--ink3)';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Say "OK" only.' }] }] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
    keyStatus.textContent = '✓ Key works!'; keyStatus.style.color = 'var(--green)';
  } catch (err) {
    keyStatus.textContent = `✗ ${err.message}`; keyStatus.style.color = 'var(--red)';
  }
}

function loadApiKey() {
  const key = getApiKey();
  if (key) {
    apiKeyInput.value = key;
    noKeyBanner.classList.add('hidden');
  } else {
    noKeyBanner.classList.remove('hidden');
  }
}

function saveKey() {
  const key = apiKeyInput.value.trim();
  if (!key) return;
  setApiKey(key);
  keyStatus.textContent = '✓ Saved';
  keyStatus.style.color = 'var(--green)';
  noKeyBanner.classList.add('hidden');
  setTimeout(() => {
    keyStatus.textContent = '';
    settingsPanel.classList.add('hidden');
  }, 1200);
}

// ── Briefing ──────────────────────────────────
async function handleBriefing() {
  briefingCard.classList.remove('hidden');

  if (!hasApiKey()) {
    briefingContent.innerHTML = '<p>Add your Gemini API key in settings to generate briefings.</p>';
    return;
  }

  briefingContent.innerHTML = '<div class="briefing-loading">Generating your briefing<span class="dots"></span></div>';

  try {
    const text = await generateBriefing(getTasks());
    briefingContent.innerHTML = `<p>${escapeHtml(text)}</p>`;
  } catch (err) {
    briefingContent.innerHTML = `<p style="color:var(--red)">Error: ${escapeHtml(err.message)}</p>`;
  }
}

// ── Chat ──────────────────────────────────────
function wireChat() {
  chatToggle.addEventListener('click', toggleChat);
  chatSend.addEventListener('click', handleChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleChat(); });
}

function toggleChat() {
  chatOpen = !chatOpen;
  chatBody.classList.toggle('open', chatOpen);
  chatChevron.classList.toggle('open', chatOpen);
  chatToggle.setAttribute('aria-expanded', chatOpen);
  chatBody.setAttribute('aria-hidden', !chatOpen);
  if (chatOpen) chatInput.focus();
}

async function handleChat() {
  const q = chatInput.value.trim();
  if (!q) return;
  chatInput.value = '';

  appendMsg('user', q);

  if (!hasApiKey()) {
    appendMsg('assistant', 'Add a Gemini API key in settings to use AI chat.');
    return;
  }

  const thinking = appendMsg('assistant', '…', true);

  try {
    const reply = await chatWithAI(q, getTasks());
    thinking.textContent = reply;
    thinking.classList.remove('thinking');
  } catch (err) {
    thinking.textContent = `Error: ${err.message}`;
    thinking.classList.remove('thinking');
  }
}

function appendMsg(role, text, thinking = false) {
  const el = document.createElement('div');
  el.className = `chat-msg chat-msg--${role}${thinking ? ' thinking' : ''}`;
  el.textContent = text;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return el;
}

// ── Security ──────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Bootstrap ─────────────────────────────────
init();
