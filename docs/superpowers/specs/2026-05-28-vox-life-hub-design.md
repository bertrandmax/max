# Vox v2 — Personal Life Hub

**Date:** 2026-05-28
**Status:** Approved design, ready for plan
**Owner:** Bertrand

## 1. Purpose

Extend Vox from a voice-first task manager into a unified personal life hub. Add four new trackers — Habits, Sleep, Weight, Meals — that share the existing app shell, Gemini chat, and dark editorial aesthetic. The user can ask Vox questions that span all data ("how did I sleep this week and am I hitting my workout habit?").

## 2. Scope

**In scope (v2):**
- Bottom tab bar navigation across 5 screens: Tasks, Habits, Sleep, Weight, Meals
- Habit tracker: daily binary check-ins, streak counter, 7-day grid
- Sleep tracker: bedtime/wake/quality logging, 7-day hours bar chart, weekly average
- Weight tracker: daily entries, goal weight, 30-entry SVG line chart
- Meal tracker: text input → Gemini parses calories + macros, daily totals
- Global chat context expanded to include all tracker data
- Per-tab accent color while preserving overall palette

**Out of scope (v2):**
- Voice input for non-task trackers (text-only logging)
- Body composition (fat %, measurements)
- Detailed sleep tags (dreams, caffeine, etc.)
- Quantified habits (just binary done/not done)
- Mood/journal/symptoms tracking
- Supabase backend (still localStorage; Phase 5 from original PRD comes later)
- Notifications/reminders
- Cross-device sync

## 3. Architecture

Single-page app, no build step, ES modules. Existing files preserved; new structure introduces a `trackers/` folder where each tracker is a self-contained module.

### File layout

```
TASKMANAGER/
├── index.html         # shell, tab bar, chat, settings, voice overlay
├── style.css          # shared + tracker styles
├── app.js             # router (tab switching), shared state, chat wiring
├── storage.js         # generic helpers: get(key), set(key, val)
├── speech.js          # unchanged — only used by Tasks tab
├── gemini.js          # parseTask, parseMeal, chatWithAI, generateBriefing
└── trackers/
    ├── tasks.js       # existing Tasks logic, extracted as module
    ├── habits.js
    ├── sleep.js
    ├── weight.js
    └── meals.js
```

### Module interface

Each tracker module exports:

```js
export function mount(container)   // render into element, attach own events
export function unmount()          // remove listeners, clear container (called on tab switch)
export function getContext()       // returns this tracker's data for chat prompt
```

The router (`app.js`) calls `unmount()` on the old tracker, then `mount()` on the new one. Only one tracker is mounted at a time, so DOM stays light and event listeners stay clean.

### State boundaries

- Each tracker owns its localStorage namespace and never reads another tracker's keys directly.
- `gemini.js` is data-agnostic — `chatWithAI(question, contextObject)` receives an object built by `app.js` from each tracker's `getContext()`.
- Tab state lives in `app.js` only.

## 4. Data Model

All data in `localStorage` (browser-local). One key per tracker:

| Key | Shape | Notes |
|---|---|---|
| `vox_tasks` | existing | unchanged |
| `vox_habits` | `[{ id, name, emoji, createdAt }]` | habit definitions |
| `vox_habit_log` | `{ "YYYY-MM-DD": ["habit-id", ...] }` | array of completed habit IDs per date |
| `vox_sleep` | `[{ id, date, bedtime, wake, hours, quality, note }]` | one entry per day; latest first |
| `vox_weight` | `[{ id, date, weight }]` | weight is a number in user's chosen unit |
| `vox_weight_goal` | `{ value, unit }` | unit = `"kg"` or `"lb"` |
| `vox_meals` | `[{ id, date, name, grams, calories, protein, carbs, fat, rawInput }]` | grouped by date in UI |
| `vox_gemini_key` | existing | unchanged |
| `vox_active_tab` | `"tasks" | "habits" | "sleep" | "weight" | "meals"` | persist last tab on refresh |

IDs: `crypto.randomUUID()` everywhere.

Dates: stored as `YYYY-MM-DD` strings (local timezone) for log keys and per-day grouping. Timestamps where needed use ISO format.

## 5. UI Specs

### Shared shell

- Header unchanged (brand, briefing, settings) — visible on all tabs.
- Chat panel pinned bottom, above the new tab bar — global, full-context.
- **Bottom tab bar**: 5 icons + labels, fixed bottom, above safe-area inset. Active tab highlighted with that tab's accent color (filled icon + accent text). Tap = switch tab + persist to `vox_active_tab`.
- Tab bar replaces the chat panel's current bottom position; chat panel moves above tab bar.

### Tab: Tasks (existing, unchanged)

Existing input bar + filter tabs + task list + voice overlay. Accent: amber.

### Tab: Habits

- Top: "+ New Habit" button → modal with name input + emoji picker (8 preset emojis: 💪 🧘 📚 💧 🏃 🥗 ✍️ 🛏️).
- For each habit, a card:
  - Emoji + name (left)
  - 7-day dot row (Mon-Sun, current week) — filled dot = completed, empty = missed, today is outlined
  - Tap card → toggles today's completion (with subtle press animation)
  - Streak badge in top-right corner: 🔥 N (current consecutive-days streak ending today/yesterday)
- Empty state: "No habits yet. Start with one."
- Accent: green `#52d68a`.

### Tab: Sleep

- Top card: "Log last night" form
  - Bedtime input (time picker, default 23:00)
  - Wake input (time picker, default 07:00)
  - Quality: 5-star tap row
  - Optional note input
  - "Save" button — computes `hours` (handles overnight wrap), appends/replaces today's entry
- Stats row: "This week avg: 7.4h" and delta vs last week ("+0.3h" green / "-0.5h" red)
- 7-day bar chart: CSS-only divs, each bar height proportional to hours (0-12h range), color tinted by quality (1★ red → 5★ green)
- Below: scrollable list of last 14 entries (date + hours + stars)
- Accent: slate-violet `#7b8ee8`.

### Tab: Weight

- Hero number: current (most recent) weight, big display font
- Below hero: "Goal: 72 kg · −3.2 kg to go" (or "+1 kg over" if past goal)
- 30-entry SVG line chart with subtle goal line overlay (dashed)
- "+" floating action button bottom-right → modal with weight input (number) + date (default today, editable)
- Settings inline: tap "Goal" → modal to set goal weight + unit (kg/lb toggle)
- Below chart: list of last 10 entries with delta from previous (▲ 0.3 kg / ▼ 0.1 kg)
- Accent: yellow `#e8c14a`.

### Tab: Meals

- Top: today's totals card with 4 small ring/donut visuals or stacked numbers — Calories, Protein, Carbs, Fat (each with target hint, e.g. "1,840 / 2,200 kcal")
- Day navigator: ◀ Today ▶ (tap to go to previous/next day, max = today)
- List: today's meals in chronological order — each shows name, grams, calories, macros
- Bottom input bar (replaces normal app input on this tab): text field placeholder "Log a meal — e.g. '200g chicken breast'" + send button → calls `parseMeal()` → adds entry. Shows loading state while AI parses.
- If no API key: input disabled, banner says "AI meal parsing needs Gemini key."
- Accent: red-orange `#e05555`.

## 6. Gemini Integration

### New prompt: `parseMeal(rawInput)`

```
You are a nutrition parser. Extract structured nutrition data from the user's meal log.

User input: "${rawInput}"

Return ONLY a valid JSON object (no markdown, no explanation) with realistic estimates:
{
  "name": "clean meal name",
  "grams": number (estimated portion weight in grams if user didn't specify),
  "calories": number (kcal),
  "protein": number (grams),
  "carbs": number (grams),
  "fat": number (grams)
}

Be reasonable with estimates. If user says "a banana" assume ~120g. Numbers must be integers.
```

Fallback on parse failure: store entry with `name = rawInput`, all macros = 0, surface a small "couldn't parse" badge on the entry (user can delete + retry).

### Extended: `chatWithAI(question, fullContext)`

`fullContext` is built by `app.js` like:

```js
{
  tasks: tasksTracker.getContext(),
  habits: habitsTracker.getContext(),
  sleep: sleepTracker.getContext(),  // last 14 days
  weight: weightTracker.getContext(), // last 30 entries
  meals: mealsTracker.getContext()   // last 7 days
}
```

System prompt updates to: "You are a personal life assistant. You have access to the user's tasks, habits, sleep, weight, and meal logs. Answer concisely and reference specific data when relevant."

Token concern: meals/sleep/weight all bounded to recent windows above. Habits is small. Tasks unbounded — keep as-is for now; if it grows, trim to last 60.

### Briefing prompt: extended

Briefing now also mentions: any habit streak at risk (yesterday missed), unusual sleep (< 6h two nights running), weight trend (last 7 days), meal calorie average if logged. Tone stays warm + concise.

## 7. Visual Design

Reuses existing palette + typography (Syne display, DM Sans body, IBM Plex Mono). Each tab gets one accent tint applied to:
- Active tab bar icon + label
- Primary CTA buttons within that tab
- Chart fills / streak badges / hero numbers

Palette extension (already defined in `style.css`):
- Tasks: `--accent` amber `#e8924a`
- Habits: `--green` `#52d68a`
- Sleep: `--slate` `#7b8ee8`
- Weight: `--yellow` `#e8c14a`
- Meals: `--red` `#e05555`

Charts are pure CSS divs (bars) or inline SVG (lines) — **zero chart library** to preserve the no-build, no-dependency constraint.

## 8. Error Handling

| Failure | Behavior |
|---|---|
| No Gemini key + meal log | Disable input, show banner |
| `parseMeal` API failure | Store with raw name + zero macros + retry badge |
| `chatWithAI` failure | Show raw error message (matches current Tasks behavior) |
| localStorage quota exceeded | Wrap all writes in try/catch, surface toast "Storage full — delete old entries" |
| Invalid date math (bedtime > wake) | Treat as overnight: hours = (24 − bedtime) + wake |
| Stale tab in localStorage (renamed/removed) | Router falls back to "tasks" |

## 9. Testing Plan

Manual smoke per tab:
1. Add → list updates → refresh → persists
2. Toggle / edit / delete → list updates → persists
3. Tab switch → new tab mounts cleanly, old listeners gone (verify in devtools)
4. Chat asks cross-tracker question → response references multiple data sources
5. Mobile viewport 375px wide — all touch targets ≥ 44×44 px
6. iOS safe-area inset — tab bar sits above home indicator

## 10. Non-Functional

- Mobile-first: tab bar is thumb-zone, all primary actions reachable with one hand
- Offline (Phase 1–4): only `chatWithAI` and `parseMeal` need network
- Performance: tab switch < 50ms (mount swap, no animation required); render lists virtualized only if > 200 entries (defer until needed)
- Accessibility: tab bar has `role="tablist"`, each tab `role="tab"` + `aria-selected`; charts have textual fallback (avg/total) for screen readers
- No new dependencies — vanilla JS ES modules only

## 11. Build Order

1. Refactor `app.js` to router + extract `tasks.js` (no behavior change) — **checkpoint: Tasks still works**
2. Add tab bar UI + tab switching (Habits/Sleep/Weight/Meals are empty placeholders)
3. Build `habits.js` end-to-end
4. Build `sleep.js` end-to-end
5. Build `weight.js` end-to-end
6. Build `meals.js` + `parseMeal` in `gemini.js`
7. Wire global chat context — collect from all trackers
8. Extend briefing prompt for cross-tracker insights — **checkpoint: full Life Hub**

## 12. Open Questions

None — all design decisions resolved during brainstorming.
