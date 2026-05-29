# Vox Schedule Tracker — Design Spec

**Date:** 2026-05-29
**Status:** Approved (brainstorming)
**Replaces:** Meals tracker (removed in commit `3295eb5`)

---

## 1. Goal

Add a `Schedule` tracker that replaces the Meals slot in Vox. Tracks **one-off events** with a specific date + time, and **routines** that recur on selected weekdays at a fixed `every N days` cadence. Default view is a today timeline.

## 2. Architecture

- New module `trackers/schedule.js` with the standard tracker contract (`mount`, `unmount`, `getContext`, `refresh`).
- Owns two localStorage keys mirrored to Supabase:
  - `vox_schedule_items` — array of schedule item records (templates).
  - `vox_schedule_done` — array of `(item_id, date)` completion rows.
- Two new Postgres tables (`schedule_items`, `schedule_completions`) with owner-only RLS and realtime publication.
- AI parsing via new `parseScheduleItem(rawInput)` in `gemini.js`.
- Chat context + briefing prompt augmented with a `schedule` section.

## 3. Data Model

### `schedule_items`
| field | type | notes |
| --- | --- | --- |
| `id` | uuid pk | client-generated |
| `user_id` | uuid fk → `auth.users` | RLS |
| `kind` | `'event' \| 'routine'` | discriminator |
| `title` | text | required |
| `start_time` | text (`HH:MM`) | required |
| `end_time` | text (`HH:MM`) nullable | if null, render as 30-min block |
| `category` | text default `'other'` | one of `work \| health \| personal \| other` |
| `notes` | text nullable | |
| `date` | date nullable | populated when `kind='event'` |
| `weekdays` | `int[]` nullable | subset of `0..6` (Sun=0). Populated when `kind='routine'` |
| `interval_days` | int default 1 | every Nth matching day |
| `created_at` | timestamptz default `now()` | also acts as routine anchor for `interval_days` math |

### `schedule_completions`
| field | type | notes |
| --- | --- | --- |
| `item_id` | uuid fk → `schedule_items` (cascade) | |
| `user_id` | uuid fk → `auth.users` (cascade) | RLS |
| `date` | date | the occurrence date being marked done |
| `completed_at` | timestamptz default `now()` | |
| primary key | (`item_id`, `date`) | |

### Occurrence rule (client-side)

For a viewed date `D`, an item produces an occurrence iff:

- `kind = 'event' AND date = D`, **or**
- `kind = 'routine' AND weekday(D) ∈ weekdays AND floor((D - created_at_date) / 1 day) mod interval_days = 0`.

Completion is looked up by `(item.id, D)` in `vox_schedule_done`.

## 4. UI

### Tab + nav

Replace Meals slot in `index.html` tab bar with `data-tab="schedule"` button. Calendar/clock SVG icon. Add accent color rule `body[data-tab="schedule"]` in `style.css` (reuse one of the existing accent palettes — e.g. blue).

### Header strip

```
◀  Mon 02 Jun  ▶        [Today]
```

- Left/right arrows shift `viewDate` by ±1 day.
- Tapping the date label opens a native `<input type="date">` to jump.
- `Today` button appears only when `viewDate ≠ today`.

### Timeline

- Vertical hour grid 6:00–23:00 (17 hours). Each hour row = 64px → 1088px scroll container.
- Hour labels left gutter, faint horizontal rules between hours.
- Events absolutely positioned: `top = (startMin - 360) * 64/60`, `height = max(durationMin, 30) * 64/60`.
- Block content: title (one line, truncated), `start–end` time row, category-colored left border (3px).
- Tap block toggles completion for `(item.id, viewDate)`. Done state → opacity 0.5 + strike-through on title.
- Long-press / overflow `⋯` button → action sheet: Edit / Delete.
- "Now" red 1px line if `viewDate == today`, positioned at current minute.

### Empty state

If no occurrences for the day: centered hint *"Nothing scheduled — tap ＋ or speak below."*

### Input bar (bottom-pinned, matches Tasks)

```
[ 🎤 ]  [ Speak or type an event… ]  [ ➤ ]
```

- Voice button uses same `speech.js`; transcript → input value on stop.
- Send button calls `parseScheduleItem(raw)` and inserts the parsed item optimistically.
- Disabled with `Add Gemini key for natural language` placeholder when no key. In that state, the FAB stays usable (explicit form path).

### FAB

Bottom-right `＋` button → opens Add/Edit modal directly.

### Add/Edit modal

Fields in order:
1. Title (text)
2. Kind radio: `One-off` / `Routine` (defaults to `One-off`)
3. Start time (`<input type="time">`)
4. End time (`<input type="time">`, optional)
5. Category chips (Work / Health / Personal / Other, single-select, default `Personal`)
6. If `One-off`: Date picker (defaults to `viewDate`)
7. If `Routine`:
   - Weekday chips `S M T W T F S` (single row, click toggles, default all on)
   - `Every N days` number input (default 1, min 1)
8. Notes (textarea, optional)

Buttons: `Cancel`, `Save` (disabled until title + start_time present).

## 5. AI parsing

New `parseScheduleItem(rawInput)` in `gemini.js`:

Prompt instructs the model to return ONLY JSON:
```json
{
  "title": "string",
  "kind": "event" | "routine",
  "startTime": "HH:MM",
  "endTime": "HH:MM" | null,
  "date": "YYYY-MM-DD" | null,
  "weekdays": [0..6] | null,
  "intervalDays": 1,
  "category": "work" | "health" | "personal" | "other"
}
```

Prompt receives today's local date for relative-time resolution ("tomorrow", "Friday", "every Mon Wed Fri").

Failure path (no key, network error, JSON parse fail) → fallback:
```js
{ title: rawInput, kind: 'event', startTime: '09:00', endTime: null,
  date: viewDate, weekdays: null, intervalDays: 1, category: 'other' }
```

Optimistic UI: write placeholder with `_parsing: true`, swap fields after parse, render again. On mount, clear any stuck `_parsing: true` rows from a prior crashed session (mirror the Meals pattern that was just removed).

## 6. Sync

### cloud.js

Add four functions following existing patterns:
- `pushScheduleItems()` → upserts `schedule_items` rows. Skips records with `_parsing: true`.
- `pullScheduleItems()` → orders by `created_at` desc.
- `pushScheduleDone()` → upserts `schedule_completions` with `onConflict: 'item_id,date'`.
- `pullScheduleDone()` → returns flat array of `{item_id, date}` (the only fields the client needs).

Wire keys into `PUSHERS`, `PULLERS`, `pushAll`, `pullAll`. Add two realtime channels (`schedule_items`, `schedule_completions`) filtered by `user_id`.

### storage.js

No changes required — `set()` already calls `pushLocal()` for any key.

## 7. Chat + Briefing context

`app.js` `buildFullContext()` adds:
```js
schedule: schedule.getContext()
```
where `getContext()` returns:
```js
{
  today:    [...occurrences for today, sorted by start_time],
  upcoming: [...next-3-days occurrences, sorted by date+start_time]
}
```

`chatWithAI` prompt: add `SCHEDULE (today + next 3 days):` section.
`generateBriefing` prompt: add `SCHEDULE (today): ${today list}` line. Briefing copy guidance: mention overlapping events, busy stretches, and "first event at HH:MM" as wake/focus anchor.

## 8. Edge cases

- **Past dates**: routines still produce occurrences (history view). One-off events too. Tap-to-done still works.
- **Time math at midnight**: `end_time` strictly later than `start_time`. Cross-midnight events out of scope for v1 (validate and reject in form).
- **Tab switch during AI parse**: same `if (!container) return;` guard pattern from Tasks.
- **Routine deleted**: `schedule_completions` cascades — old done rows go with it. Acceptable.
- **Realtime echo**: client just pulled local state after debounced push; realtime re-pull is idempotent. No de-dup needed.
- **Empty weekdays array for routine**: treat as "no occurrences" but allow saving (user can edit later). Show warning in form: "Routine has no active weekdays."

## 9. Aesthetic

Inherit Vox's dark editorial palette. Accent color for Schedule tab: pick a clear distinct hue not already used by other tabs (Tasks=amber, Habits=green-ish, Sleep=blue-ish, Weight=yellow) — propose **violet** `#9b7cff` to keep separation crisp. Category colors inside blocks use a separate small palette so per-block accent doesn't fight the tab accent.

Typography matches existing (Syne display, DM Sans body, IBM Plex Mono for time labels).

## 10. Testing checklist

- Add a one-off event for today; appears on timeline at correct y/height.
- Add a one-off event for tomorrow; appears only when navigating to tomorrow.
- Add a routine "Workout every Mon Wed Fri 18:00"; appears on those weekdays only.
- Add a routine "Stretch every 2 days 07:00"; alternating-day pattern verified across a week.
- Tap an event → done state visible, persists across reload.
- Edit event → updated fields persist.
- Delete event → row gone from cloud + local.
- Voice "tomorrow 3 to 4 pm dentist" → parsed event in tomorrow's view.
- Realtime: insert row via SQL → appears without reload.
- Briefing covers today's first event in copy.

## 11. Out of scope (v1)

- Multi-day events / cross-midnight.
- Monthly / yearly recurrence.
- Calendar import (ICS), Google Calendar sync.
- Drag-to-move blocks.
- Conflict / overlap detection beyond "they overlap visually".
- Reminders / push notifications.

## 12. File touch list

- New: `trackers/schedule.js`.
- Modify: `index.html` (tab button), `app.js` (import, TRACKERS, buildFullContext), `gemini.js` (`parseScheduleItem` + chat/briefing prompts), `cloud.js` (push/pull/realtime), `style.css` (tab accent + timeline + modal + block styles).
- Delete: none.
- Supabase: new migration `vox_schedule_schema` creating both tables, RLS policies, realtime adds.
