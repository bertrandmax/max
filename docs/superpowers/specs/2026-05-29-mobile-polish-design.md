# Mobile UI Polish

**Date:** 2026-05-29  
**Scope:** Mobile-only. No desktop changes.

## Problem

Three fixed bars stack at the bottom on every tab:

| Bar | Height | Always visible |
|-----|--------|----------------|
| Input bar (mic + field + add) | 72px | Yes — but only relevant on Tasks |
| Chat toggle strip | 52px | Yes |
| Tab bar | 64px | Yes |
| **Total** | **188px** | |

On a 844px-tall iPhone 13 this is 22% of screen height taken by chrome that is partially irrelevant on 4 of 5 tabs. Additionally, the chat toggle strip opens a small 300px drawer — a cramped, awkward interaction on mobile.

## Solution

### 1. Contextual input bar

The input bar (`.input-bar`) becomes invisible on all tabs except Tasks. It only ever served the Tasks tab — other trackers have their own add controls in the tracker header.

- `body:not([data-tab="tasks"]) .input-bar { display: none }`
- `#app` bottom padding becomes tab-only on non-Tasks tabs:
  - Tasks tab: `var(--inputbar-h) + var(--tabbar-h) + safe-area`
  - All other tabs: `var(--tabbar-h) + safe-area`

**Result:** Non-Tasks tabs drop from 188px to 64px of bottom chrome.

### 2. Chat FAB + Bottom Sheet (replaces chat panel)

The entire `.chat-panel` (toggle strip + collapsible drawer) is removed. Replaced by:

**Chat FAB** — a 44×44px circular floating button, fixed above the tab bar (bottom-right corner):
- Position: `bottom: calc(var(--tabbar-h) + 12px); right: 1rem`
- Style: `bg4` background, `border2` border, chat bubble icon, accent on active
- Always visible (all tabs)

**Chat Bottom Sheet** — slides up from the bottom when FAB is tapped:
- Full-width panel, `height: 70dvh`, `border-radius: 20px 20px 0 0`
- Drag handle at top center
- Header row: "Ask Max" label + close (×) button
- Messages area (scrollable, same `.chat-messages` structure)
- Input row at bottom (same `.chat-input-field` + `.chat-send-btn`)
- Backdrop overlay behind it; tapping backdrop closes sheet
- Slide-up/down animation: `transform: translateY` transition

### 3. Bug fixes

- **Schedule tab accent color:** Add `--teal: #4dd9c0` and `--teal-low: rgba(77, 217, 192, 0.12)` to `:root`. Add `body[data-tab="schedule"] .tab-bar-btn[data-tab="schedule"] { --tab-accent: var(--teal) }`.
- **Dead meals CSS:** Remove `body[data-tab="meals"]` rule from tab bar accent section.
- **`--chatbar-h` variable:** Set to `0` or remove from all `calc()` expressions since the chat toggle bar is gone.

## Files changed

| File | Changes |
|------|---------|
| `style.css` | Remove `.chat-panel` / `.chat-toggle` / `.chat-body` / `.chat-chevron` styles. Add `.chat-fab` + `.chat-sheet` + `.chat-backdrop` styles. Update `#app` padding-bottom and `.input-bar` bottom calc. Fix schedule accent. Remove meals dead rule. |
| `index.html` | Replace `<div id="chat-panel">` block with FAB button + sheet markup. |
| `app.js` | Replace chat toggle open/close logic with FAB → sheet open/close. Keep all AI message send/receive logic identical. |

## Non-goals

- No desktop layout changes (app is mobile-only)
- No changes to chat AI logic, Gemini integration, or message rendering
- No changes to tracker UIs (Tasks, Habits, Sleep, Weight, Schedule)
- No swipe gestures on the bottom sheet (out of scope for this pass)
