# Mobile UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce mobile bottom chrome from 188px to 64–136px by hiding the input bar on non-Tasks tabs and replacing the clunky chat toggle strip with a floating button that opens a full-height bottom sheet.

**Architecture:** CSS-only layout changes for contextual input bar visibility and new sheet positioning. HTML swap of chat panel markup. Minimal JS update to wire the new FAB and sheet open/close — all AI chat logic is untouched.

**Tech Stack:** Vanilla JS ES modules, plain CSS custom properties, no build step. Open `index.html` in a mobile browser (or DevTools device mode) to verify.

---

### Task 1: CSS — Zero out chatbar height + layout fixes

**Files:**
- Modify: `style.css`

The `--chatbar-h` variable drives all layout offsets for the chat toggle strip. Setting it to `0px` collapses those offsets in one shot. We also add the contextual rule to hide the input bar on non-Tasks tabs, fix the schedule tab-bar accent, remove the dead meals rule, and remove the old `.chat-panel` bottom positioning block.

- [ ] **Step 1: Verify current state in browser**

Open `index.html` in DevTools with iPhone 14 Pro device preset (393×852). Observe three bars stacked at bottom on Habits/Sleep/Weight/Schedule tabs. Note total chrome height ~188px.

- [ ] **Step 2: Zero out `--chatbar-h`**

In `style.css` line 49, change:
```css
  --chatbar-h:    52px;
```
to:
```css
  --chatbar-h:    0px;
```

- [ ] **Step 3: Add schedule tab-bar accent + remove dead meals rule**

In `style.css`, find this block (around line 1004–1008):
```css
body[data-tab="tasks"]  .tab-bar-btn[data-tab="tasks"]  { --tab-accent: var(--accent); }
body[data-tab="habits"] .tab-bar-btn[data-tab="habits"] { --tab-accent: var(--green);  }
body[data-tab="sleep"]  .tab-bar-btn[data-tab="sleep"]  { --tab-accent: var(--slate);  }
body[data-tab="weight"] .tab-bar-btn[data-tab="weight"] { --tab-accent: var(--yellow); }
body[data-tab="meals"]  .tab-bar-btn[data-tab="meals"]  { --tab-accent: var(--red);    }
```
Replace with (adds schedule, removes meals):
```css
body[data-tab="tasks"]    .tab-bar-btn[data-tab="tasks"]    { --tab-accent: var(--accent); }
body[data-tab="habits"]   .tab-bar-btn[data-tab="habits"]   { --tab-accent: var(--green);  }
body[data-tab="sleep"]    .tab-bar-btn[data-tab="sleep"]    { --tab-accent: var(--slate);  }
body[data-tab="weight"]   .tab-bar-btn[data-tab="weight"]   { --tab-accent: var(--yellow); }
body[data-tab="schedule"] .tab-bar-btn[data-tab="schedule"] { --tab-accent: #9b7cff;       }
```

- [ ] **Step 4: Remove old `.chat-panel` bottom positioning**

Find and delete this block (around lines 1013–1017):
```css
/* Chat panel must now sit above tab bar */
.chat-panel { bottom: var(--tabbar-h); }
@supports (padding-bottom: env(safe-area-inset-bottom)) {
  .chat-panel { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom)); }
}
```

- [ ] **Step 5: Add contextual `#app` padding for non-Tasks tabs**

Directly after the `#app` padding-bottom line (around line 1020):
```css
/* App bottom padding shifts to leave room for tab bar */
#app { padding-bottom: calc(var(--inputbar-h) + var(--chatbar-h) + var(--tabbar-h) + env(safe-area-inset-bottom, 0px)); }
```
Add below it:
```css
/* Non-Tasks tabs don't have an input bar */
body:not([data-tab="tasks"]) #app {
  padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px));
}
```

- [ ] **Step 6: Hide input bar on non-Tasks tabs**

Directly after the `.input-bar` bottom rules (around line 1025), add:
```css
/* Input bar only needed on Tasks tab */
body:not([data-tab="tasks"]) .input-bar { display: none; }
```

- [ ] **Step 7: Verify in browser**

Reload. Switch to Habits tab — input bar should be gone, content fills to the tab bar. Switch to Tasks tab — input bar should reappear. Schedule tab icon should glow purple when active.

- [ ] **Step 8: Commit**

```bash
git add style.css
git commit -m "fix: contextual input bar + schedule tab accent + zero chatbar-h"
```

---

### Task 2: CSS — Remove old chat panel styles + add FAB + bottom sheet styles

**Files:**
- Modify: `style.css`

- [ ] **Step 1: Delete the old chat panel CSS block**

Find and delete the entire section from the comment `/* CHAT PANEL */` through `.chat-send-btn:active` — but **preserve** the following rules which will be reused in the new sheet:
- `.chat-messages` and its scrollbar rules
- `@keyframes msgIn`
- `.chat-msg`, `.chat-msg--user`, `.chat-msg--assistant`, `.chat-msg--assistant.thinking`
- `.chat-input-row`, `.chat-input-field` and its states, `.chat-send-btn` and its states

Replace the entire `/* CHAT PANEL */` section (lines ~778–914) with this trimmed version:

```css
/* ══════════════════════════════════════════════
   CHAT MESSAGES (shared styles used in sheet)
   ══════════════════════════════════════════════ */
.chat-messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.75rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  scroll-behavior: smooth;
}

.chat-messages::-webkit-scrollbar { width: 3px; }
.chat-messages::-webkit-scrollbar-track { background: transparent; }
.chat-messages::-webkit-scrollbar-thumb { background: var(--border2); border-radius: 2px; }

.chat-msg {
  max-width: 88%;
  padding: 0.6rem 0.85rem;
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  line-height: 1.55;
  animation: msgIn 0.2s ease;
}

@keyframes msgIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

.chat-msg--user {
  align-self: flex-end;
  background: var(--accent-low);
  border: 1px solid rgba(232, 146, 74, 0.25);
  color: var(--ink);
  border-radius: var(--radius-sm) var(--radius-sm) 2px var(--radius-sm);
}

.chat-msg--assistant {
  align-self: flex-start;
  background: var(--bg4);
  border: 1px solid var(--border);
  color: var(--ink2);
  border-radius: 2px var(--radius-sm) var(--radius-sm) var(--radius-sm);
}

.chat-msg--assistant.thinking {
  color: var(--ink3);
  animation: blink 1s ease-in-out infinite;
}

.chat-input-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 1.25rem 0.75rem;
  border-top: 1px solid var(--border);
}

.chat-input-field {
  flex: 1;
  height: 38px;
  padding: 0 0.75rem;
  border-radius: var(--radius-xs);
  background: var(--bg3);
  border: 1px solid var(--border);
  color: var(--ink);
  font-size: 0.85rem;
  transition: border-color 0.15s;
}

.chat-input-field::placeholder { color: var(--ink3); }
.chat-input-field:focus { border-color: var(--accent); }

.chat-send-btn {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent);
  color: var(--bg);
  flex-shrink: 0;
  transition: opacity 0.15s, transform 0.1s;
}

.chat-send-btn:hover  { opacity: 0.88; }
.chat-send-btn:active { transform: scale(0.92); }
```

- [ ] **Step 2: Remove old chat `@media` blocks**

Find and delete these two blocks:

```css
  .chat-panel {
    max-width: 680px;
    left: 50%;
    transform: translateX(-50%);
    border-radius: 0;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
  }
```
(inside the `@media (min-width: 768px)` block)

And:
```css
@media (min-width: 1024px) {
  .chat-body.open { height: 360px; }
  .chat-messages  { height: calc(360px - 58px); }
}
```

- [ ] **Step 3: Add chat FAB + sheet styles**

At the end of `style.css`, append:

```css
/* ══════════════════════════════════════════════
   CHAT FAB
   ══════════════════════════════════════════════ */
.chat-fab {
  position: fixed;
  bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px) + 12px);
  right: 1rem;
  z-index: 95;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg4);
  border: 1px solid var(--border2);
  color: var(--ink2);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--shadow-md);
  transition: color 0.15s, background 0.15s, border-color 0.15s, transform 0.1s;
}

.chat-fab:hover { color: var(--accent); border-color: rgba(232,146,74,0.4); }
.chat-fab:active { transform: scale(0.92); }
.chat-fab.open {
  background: var(--accent-low);
  border-color: rgba(232,146,74,0.4);
  color: var(--accent);
}

/* ══════════════════════════════════════════════
   CHAT BOTTOM SHEET
   ══════════════════════════════════════════════ */
.chat-sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  pointer-events: none;
}

.chat-sheet.open {
  pointer-events: all;
}

.chat-sheet-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.chat-sheet.open .chat-sheet-backdrop {
  opacity: 1;
}

.chat-sheet-panel {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 70dvh;
  background: var(--bg2);
  border-radius: 20px 20px 0 0;
  border-top: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  transform: translateY(100%);
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.chat-sheet.open .chat-sheet-panel {
  transform: translateY(0);
}

.chat-sheet-handle {
  width: 36px;
  height: 4px;
  background: var(--border2);
  border-radius: 2px;
  margin: 10px auto 0;
  flex-shrink: 0;
}

.chat-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.25rem 0.5rem;
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
}

.chat-sheet-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--ink2);
}

.chat-sheet-close {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink3);
  font-size: 1.2rem;
  line-height: 1;
  transition: color 0.15s, background 0.15s;
}

.chat-sheet-close:hover { color: var(--ink); background: var(--bg4); }
```

- [ ] **Step 4: Verify styles compile without errors**

Reload `index.html`. Open DevTools console — no CSS parse errors. The bottom-right area above the tab bar should be empty (FAB not in HTML yet, that's next task). All other UI should look identical.

- [ ] **Step 5: Commit**

```bash
git add style.css
git commit -m "style: replace chat panel styles with FAB + bottom sheet"
```

---

### Task 3: HTML — Replace chat panel markup with FAB + sheet

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Remove the old chat panel block**

In `index.html`, find and delete the entire block (lines 113–141):
```html
<!-- AI Chat Panel -->
<div id="chat-panel" class="chat-panel" aria-label="AI Assistant">
  <button id="chat-toggle" class="chat-toggle" aria-expanded="false">
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
    </svg>
    <span>Ask Max</span>
    <svg class="chat-chevron" id="chat-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M18 15l-6-6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>
  <div id="chat-body" class="chat-body" aria-hidden="true">
    <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-atomic="false"></div>
    <div class="chat-input-row">
      <input
        id="chat-input"
        type="text"
        class="chat-input-field"
        placeholder="What's due this week?"
        autocomplete="off"
        aria-label="Ask Max"
      >
      <button id="chat-send" class="chat-send-btn" aria-label="Send message">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add chat FAB + sheet in its place**

In the same location (between `</nav>` and `<script>`), insert:

```html
<!-- Chat FAB -->
<button id="chat-fab" class="chat-fab" aria-label="Ask Max">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
  </svg>
</button>

<!-- Chat Bottom Sheet -->
<div id="chat-sheet" class="chat-sheet" aria-hidden="true">
  <div id="chat-backdrop" class="chat-sheet-backdrop"></div>
  <div class="chat-sheet-panel">
    <div class="chat-sheet-handle"></div>
    <div class="chat-sheet-header">
      <div class="chat-sheet-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        Ask Max
      </div>
      <button id="chat-close" class="chat-sheet-close" aria-label="Close chat">×</button>
    </div>
    <div id="chat-messages" class="chat-messages" role="log" aria-live="polite" aria-atomic="false"></div>
    <div class="chat-input-row">
      <input
        id="chat-input"
        type="text"
        class="chat-input-field"
        placeholder="What's due this week?"
        autocomplete="off"
        aria-label="Ask Max"
      >
      <button id="chat-send" class="chat-send-btn" aria-label="Send message">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Verify HTML renders**

Reload. FAB (chat bubble icon) should appear bottom-right above tab bar. Clicking it does nothing yet (JS not updated). No console errors.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat: replace chat panel with FAB + bottom sheet markup"
```

---

### Task 4: JS — Wire FAB and sheet open/close

**Files:**
- Modify: `app.js`

- [ ] **Step 1: Update DOM refs at top of file**

Find the chat DOM ref block (lines 25–30):
```js
const chatToggle         = $('chat-toggle');
const chatChevron        = $('chat-chevron');
const chatBody           = $('chat-body');
const chatMessages       = $('chat-messages');
const chatInput          = $('chat-input');
const chatSend           = $('chat-send');
```
Replace with:
```js
const chatFab            = $('chat-fab');
const chatSheet          = $('chat-sheet');
const chatBackdrop       = $('chat-backdrop');
const chatClose          = $('chat-close');
const chatMessages       = $('chat-messages');
const chatInput          = $('chat-input');
const chatSend           = $('chat-send');
```

- [ ] **Step 2: Rewrite `wireChat()` and `toggleChat()`**

Find the entire chat section (lines 169–183):
```js
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
```
Replace with:
```js
// ── Chat ──────────────────────────────────────
function wireChat() {
  chatFab.addEventListener('click', openChat);
  chatBackdrop.addEventListener('click', closeChat);
  chatClose.addEventListener('click', closeChat);
  chatSend.addEventListener('click', handleChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleChat(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && chatOpen) closeChat(); });
}

function openChat() {
  chatOpen = true;
  chatSheet.classList.add('open');
  chatSheet.setAttribute('aria-hidden', 'false');
  chatFab.classList.add('open');
  chatInput.focus();
}

function closeChat() {
  chatOpen = false;
  chatSheet.classList.remove('open');
  chatSheet.setAttribute('aria-hidden', 'true');
  chatFab.classList.remove('open');
}
```

- [ ] **Step 3: Verify full flow in browser**

Reload in DevTools (iPhone 14 Pro). 
- Tap chat FAB → sheet slides up from bottom, backdrop appears, input focused.
- Tap backdrop → sheet slides down.
- Tap × button → sheet slides down.
- Press Escape key → sheet closes.
- Type a message and send (with API key set) → AI reply appears in messages list.

- [ ] **Step 4: Verify contextual input bar**

- Switch to Habits tab → input bar hidden, only 64px chrome at bottom.
- Switch to Sleep tab → same.
- Switch to Tasks tab → input bar visible.

- [ ] **Step 5: Verify Schedule tab accent**

- Tap Schedule tab → tab icon glows purple (#9b7cff).

- [ ] **Step 6: Commit**

```bash
git add app.js
git commit -m "feat: wire chat FAB + bottom sheet, replace toggleChat"
```

---

## Self-Review

**Spec coverage:**
- ✅ Contextual input bar — Task 1 steps 5–6
- ✅ Chat FAB — Tasks 2–4
- ✅ Chat bottom sheet — Tasks 2–4
- ✅ Schedule tab accent — Task 1 step 3
- ✅ Dead meals tab rule removed — Task 1 step 3
- ✅ `--chatbar-h` set to 0 — Task 1 step 2
- ✅ `.chat-panel` bottom positioning removed — Task 1 step 4

**Placeholder scan:** None found. All steps show exact code.

**Type consistency:**
- `chatOpen` state variable — used in `openChat()`, `closeChat()`, `handleChat()` — consistent.
- `chat-sheet` ID matches `$('chat-sheet')` ref and HTML id — consistent.
- `chat-fab` ID matches `$('chat-fab')` ref and HTML id — consistent.
- `chat-backdrop` ID matches `$('chat-backdrop')` ref and HTML id — consistent.
- `chat-close` ID matches `$('chat-close')` ref and HTML id — consistent.
- `.open` class used on both `chatSheet` and `chatFab` — consistent with CSS.
