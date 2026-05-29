# Project A — Schedule & Cross-App Smoothness

**Date:** 2026-05-29
**Status:** Approved (brainstorming)
**Owner:** Bertrand
**Context:** Enhancements to the existing `schedule` tracker plus a cross-app polish pass, so the app is smoother in daily web/mobile use. Push reminders are a separate follow-up (Project B).

---

## 1. Goal

Make the Schedule page (and the app around it) friction-free for daily use as a **mobile-first web app / installed PWA**. Five concrete improvements:

1. Timeline auto-scrolls to "now" / next event on open instead of always sitting at 6:00.
2. Overlapping events render side-by-side instead of stacking on top of each other.
3. A week overview strip lets the user glance at the week and jump to any day.
4. Tasks that have a due time surface on the schedule timeline; untimed tasks due that day show in a thin strip.
5. A mobile polish pass: touch targets, scrolling, safe-area, modal feel.

No backend, no new dependencies. Vanilla ES modules, same no-build constraint as the rest of the app.

## 2. Affected files

| File | Change |
| --- | --- |
| `trackers/schedule.js` | All five features live here (render, occurrence merge, week strip, scroll, task blocks). |
| `trackers/tasks.js` | No change. (Only one tracker mounts at a time, so no cross-module refresh needed.) |
| `storage.js` | No change — `getTasks`, `toggleTask`, `get/set` already exported; schedule imports them directly. |
| `style.css` | Week strip, column-split blocks, task-block + untimed-row styles, mobile/safe-area rules, bottom-sheet modal on narrow screens. |
| `index.html` | No change expected (schedule already wired). |
| `app.js` | No change expected. |

Cache-bust query strings (`?v=15`) bumped to `?v=16` on touched module imports per the existing convention.

## 3. Feature specs

### 3.1 Auto-scroll to now / next event

- The timeline is `.schedule-timeline` (height `(END_HR-START_HR+1)*HOUR_PX` = 1088px) inside the page scroll flow (`tracker-root`, flex column). The page scrolls, not an inner box.
- After each `render()`, in a `requestAnimationFrame` (so layout is settled):
  - If `viewDate === today` and the now-line is within range: scroll it into view positioned ~1/3 from the top of the visible area (`scrollIntoView` with a manual offset, or compute `scrollTop`).
  - Else if there is at least one occurrence: scroll to the earliest occurrence's block, same ~1/3 offset.
  - Else: leave at top.
- Use smooth scrolling. Guard with a `didInitialScroll` flag scoped per mount so day-navigation re-renders still re-scroll (re-scroll on every render is desired here — each day jump should reposition).
- Must not scroll the whole document such that the header/week strip hide content; account for any sticky header height via `scroll-margin-top` on the target.

### 3.2 Overlapping events side-by-side

- Replace the current full-width `left/right` block positioning with computed columns.
- Algorithm (per day, on the sorted occurrence list which already includes merged task blocks — see 3.4):
  1. Sort by `startMin`, then by `endMin`.
  2. Sweep into **clusters**: a new cluster starts when an occurrence's start is ≥ the running max end of the current cluster (no overlap).
  3. Within a cluster, greedily assign each occurrence the lowest-indexed column whose last occupant ends ≤ this start; track column count.
  4. `width = (100% / columns)`, `left = colIndex * width`, with a small inner gutter so adjacent blocks have a visible gap.
- Minimum block height stays `max(30, duration)` minutes mapped to px (unchanged).
- A single (non-overlapping) occurrence renders effectively full width as today.
- Blocks keep `position:absolute`; CSS switches from fixed `left/right` to inline `left`/`width` percentages set by JS.

### 3.3 Week overview strip

- A 7-day strip pinned **above the timeline**, below the existing day-nav (or replacing the bare day-nav — see decision below).
- Shows the week containing `viewDate` (Mon–Sun or Sun–Sat; use locale start = Sunday=0 to match existing `weekdayOf`). Each day cell:
  - Weekday letter + day-of-month number.
  - A density indicator: up to 3 dots representing occurrence count buckets (1, 2, 3+), or empty if none. Counts include merged task occurrences.
  - Today: outlined/accent ring. Selected (`viewDate`): filled accent.
- Tap a day cell → set `viewDate`, `render()` (which re-scrolls per 3.1).
- Strip has its own `‹ ›` to page to previous/next week; the existing per-day `◀ ▶` arrows remain for fine movement.
- The "Today" jump button behavior is unchanged (appears when `viewDate !== today`).
- **Decision:** keep the existing `day-nav` (label + arrows) as the title row; add the week strip directly beneath it. The day label remains tappable for the native date picker (jump to any date, including outside the visible week — which then re-centers the strip).
- Strip is horizontally scroll-safe but sized to fit 7 cells at 375px (≈48px each) without overflow.

### 3.4 Tasks with due times on the timeline

- Schedule gains a read of tasks via `getTasks()` (imported from `storage.js`).
- For the viewed date `D`, partition tasks where `dueDate === D`:
  - **Timed** (`dueTime` present) → converted to a pseudo-occurrence and merged into the occurrence list **before** the overlap/column layout runs, so tasks and events share columns. Pseudo-occurrence shape:
    ```js
    { id: 'task:'+task.id, _task: true, title: task.title,
      startTime: task.dueTime, endTime: null,
      category: 'task', done: task.completed }
    ```
  - **Untimed** (`dueDate === D`, no `dueTime`) → listed in a thin **untimed row** above the hour grid (chips). Completed ones show done-styled.
- Task blocks/chips are visually distinct from events: a checkbox-style left marker and a "task" tint (distinct from the four event categories). A small label or icon signals "task" so it's not confused with an event.
- Interaction:
  - Tap a task block/chip → `toggleTask(task.id)`, then `render()` here **and** call the tasks tracker's `refresh()` so the Tasks tab stays consistent if later viewed. (Tasks tracker reads from storage on mount, so a plain re-read is enough; calling `refresh()` is only needed if Tasks is currently mounted — it is not, since only one tracker mounts at a time. So: just write to storage; no cross-module call required.)
  - No edit/delete of tasks from the schedule (the `⋯` affordance is omitted on task blocks). Editing stays in the Tasks tab.
- Tasks never participate in routines/completion-per-date logic; their `completed` is a single boolean on the task itself.
- `getContext()` is unchanged (still events/routines only) — tasks already have their own chat context via the tasks tracker, avoiding duplication.

### 3.5 Mobile polish pass

- **Touch targets ≥ 44×44px:** day-nav arrows, week-strip day cells, the `⋯` more button, FAB, input-bar buttons. Increase hit area via padding without enlarging visible glyphs where needed.
- **Scrolling:** `-webkit-overflow-scrolling: touch` / momentum where a scroll container exists; `scroll-margin-top` on scroll targets so the now-line/first event isn't hidden under the header + week strip.
- **Safe area:** input bar and FAB respect `env(safe-area-inset-bottom)` and sit above the bottom tab bar (the FAB currently may collide on small screens — verify and offset).
- **Modal as bottom sheet on narrow screens:** at ≤480px the add/edit modal anchors to the bottom, full-width, rounded top corners, internal scroll when content exceeds height, with safe-area bottom padding. On wider screens it stays a centered card.
- **No layout shift:** week strip and untimed row reserve their space; empty states don't jump.

## 4. Data model

No schema changes. Reuses:
- `vox_schedule_items`, `vox_schedule_done` (unchanged).
- `vox_tasks` (read via `getTasks`, write via `toggleTask`).

## 5. Edge cases

| Case | Behavior |
| --- | --- |
| No occurrences and no tasks for the day | Existing empty-state hint; timeline stays at top. |
| Many overlapping items (e.g. 5 at once) | Columns shrink to `100%/5`; text truncates with ellipsis (already styled). |
| Task `dueTime` outside 6:00–23:00 grid | Clamp into view OR place in untimed row. **Decision:** if time falls outside the grid window, show it in the untimed row (with its time as a label) rather than off-screen. |
| Task completed toggled from schedule | Persists to `vox_tasks`; reflected on next Tasks tab mount. |
| viewDate jumped (date picker) outside visible week | Week strip recenters to the week containing the new `viewDate`. |
| Routine + event + task all at same time | All three merge into one cluster and split columns equally. |
| Very long day with auto-scroll | Re-scroll fires on every render including day nav, landing on now/first event. |

## 6. Non-goals (this project)

- Push / background reminders (Project B — separate spec).
- Drag-to-move or resize blocks.
- Multi-day or cross-midnight events.
- Editing or creating tasks from the schedule view (complete-toggle only).
- Two-way "reschedule a task by dragging" interactions.
- Any new dependency or build step.

## 7. Testing plan

Manual smoke, primarily at 375px width (mobile web) and once installed as PWA:

1. Open Schedule on today → timeline auto-scrolls so the now-line sits ~1/3 down, not at 6:00.
2. Navigate to a future day with one event → scrolls to that event.
3. Create two events at the same time → they render side-by-side, both readable and tappable.
4. Week strip shows 7 days with density dots; today ringed, selected filled; tap a day → jumps + re-scrolls.
5. Week strip `‹ ›` pages weeks; per-day `◀ ▶` still works; date-picker jump recenters the strip.
6. Add a task in Tasks tab with a due date = today and a due time → it appears as a task-styled block on the timeline.
7. Add a task due today with no time → appears in the untimed row.
8. Tap a task block → marked done (strike/dim); switch to Tasks tab → shows completed.
9. Touch targets: arrows, day cells, ⋯, FAB all ≥44px; FAB/input clear of the tab bar and home indicator.
10. Open add/edit modal at 375px → bottom-sheet, scrolls if tall, safe-area respected.

## 8. Build order

1. Merge tasks into the occurrence pipeline (`getTasks` read + pseudo-occurrence mapping + untimed split) — render as plain full-width blocks first.
2. Overlap column layout — applied to the merged list.
3. Auto-scroll-to-now after render.
4. Week overview strip + wiring.
5. Task block/chip styling + complete-toggle interaction.
6. Mobile polish pass (CSS: touch targets, safe-area, bottom-sheet modal, scroll-margin).
7. Smoke test the full checklist at 375px.
