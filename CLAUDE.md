# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

Chalk is a locally-running flashcard app for serious self-study — built for graduate-level math and science, but works for any subject. Runs on macOS only. User double-clicks `Start Chalk.command` to launch; opens Safari at `http://localhost:8000`.

## How to Launch

- **End user**: double-click `Start Chalk.command`. Opens a new Safari window and starts the Python server. Closing the terminal window stops it.
- **Dev**: `cd` into the repo and run `python3 server.py`, then open `http://localhost:8000`.

No dependencies, no build step — Python 3 (standard library only) and a browser are all you need.

## Architecture

Single-page vanilla JS app served by a minimal Python stdlib HTTP server. No npm, no build step.

- `server.py` — HTTP server, all API endpoints, reads/writes state as JSON on disk, serves static files, opens PDFs in Preview via macOS `open`. API responses send `Cache-Control: no-store` so Safari never serves stale state. Auto-creates `state/progress.json` on first run if missing.
- `index.html` — single-page app shell, all views (landing, course home, card front/back, catalogue, camera overlay).
- `app.js` — all client logic: view routing, KaTeX rendering, session management, recommendation algorithm, timer, hint, image upload (file or camera), comments, fancy mode.
- `style.css` — CSS variables for theming; two themes (default white, `body.fancy` purple/pink with gradients).
- `vendor/katex/` — vendored KaTeX library (do not CDN-load).
- `Start Chalk.command` — bash launcher (uses AppleScript to open a new Safari document).
- `.gitignore` — excludes `.DS_Store`, Python cache, tmp files, plus `state/progress.json` and `uploads/*` so personal progress and photos are never committed. Course content under `data/` IS tracked (that's what course-contribution PRs add).

## Data Model

### `data/courses.json` — Course Registry

Top-level courses displayed on the landing page. Each course has one or more subcourses (a subcourse = one directory of assignment JSONs + one PDF directory). A single subcourse is the common case; the structure supports splitting a course into, e.g., HW and exams. Ships empty (`{"courses": []}`) — add courses in-app or by editing this file.

```json
{
  "courses": [
    {
      "id": "real-analysis",
      "name": "Real Analysis",
      "subcourses": [
        {
          "id": "real-analysis",
          "name": "Real Analysis",
          "dataDir": "data/real-analysis/real-analysis",
          "pdfDir": "Course Materials/Real Analysis",
          "assignments": ["hw1", "hw2", "midterm", "final"]
        }
      ]
    }
  ]
}
```

### Assignment JSON files (one per HW/midterm/final)

Under the subcourse's `dataDir`:

```json
{
  "assignment": "HW1",
  "course": "Real Analysis",
  "courseId": "real-analysis",
  "parentCourseId": "real-analysis",
  "solutionPdf": "HW1_Sol.pdf",
  "problems": [
    {
      "id": "real-analysis-hw1-p1",
      "number": 1,
      "statement": "Problem statement with $LaTeX$",
      "hint": "One-sentence hint grounded in the solution",
      "tags": ["sigma-algebra", "cardinality"]
    }
  ]
}
```

Rules:
- **Problem statements should be verbatim from your source** — no rewriting or added commentary, so the card matches what you'll see on the exam.
- **IDs are globally unique**: format `{subcourseId}-{assignment}-p{number}`.
- **Multi-part problems (a)(b)(c) stay as ONE card** — include all parts in the single statement.
- **Hints are one sentence**, grounded in the actual solution strategy (not guessed).
- LaTeX: `$...$` inline, `$$...$$` display. Escape backslashes for JSON: `\\mathcal{M}`.

### `state/progress.json` — User State (gitignored)

Written by the server on every rating/upload/seen/comment event. Keys:
- `confidenceHistory{cardId: [{rating, timestamp}]}` — append-only history of 0–10 ratings
- `images{cardId: [{filename, uploadedAt, rotation?}]}` — references to files in `uploads/{cardId}/`. `rotation` is an optional 0/90/180/270 field applied as a CSS `transform: rotate()` at display time (file bytes are never re-encoded).
- `firstPassComplete{courseId: bool}` — set to `true` only when every card in the course has been rated at least once
- `seenCards{courseId: [cardId]}` — cards that have been flipped at least once
- `comments{cardId: "text"}` — per-card notes edited via the Comments textarea on card back; single string, last saved wins

### `uploads/{cardId}/img_NNN.{jpg,png}` (gitignored)

Uploaded photos (file upload or MacBook camera capture). Filenames are `img_NNN.{ext}` where `NNN = max(existing numbers) + 1` (or 1 if none). Using `max + 1` (not `count + 1`) prevents collisions when an earlier image in the sequence has been deleted.

## Recommendation Algorithm and Session Modes

The client tracks a `studyMode` variable (`"first-pass"`, `"review"`, or `"catalogue"`) set when a session starts. Arrow-left/arrow-right and `submitRating` behave mode-specifically.

| Mode | Entered by | Queue contents | Arrow ←→ | After rating |
|---|---|---|---|---|
| **first-pass** | Click "Study" when `firstPassComplete[courseId]` is false | Unrated cards only, shuffled once at session start | wrap-around ±1 within queue | Splice the just-rated card out of the queue. If queue empty → `handleQueueComplete` (which marks first-pass done when all course cards are rated). |
| **review** | Click "Study" when first pass is complete | All cards sorted by latest confidence ascending, random tiebreaker | wrap-around ±1 within queue | Rebuild the queue from fresh history (dynamic re-sort). If the just-rated card is at position 0, `studyIndex = 1` so the user sees the next-lowest instead of the same card again. |
| **catalogue** | Click a row in the Catalogue view | All cards in **canonical source order** (see below) | wrap-around ±1 within queue | `studyIndex = (studyIndex + 1) % length`. The queue stays full and ordered; rating never removes cards. |

**Canonical source order** is produced by `server.py:_serve_problems` — it reads the `assignments` array from `courses.json` in order, then sorts problems within each file by their `number` field. The returned problems array is the single source of truth for what "next in order" means; the client just uses `allProblems.map(p => p.id)`.

**First-pass completion**: when `handleQueueComplete` fires and every card in the course has at least one confidence rating, POST `/api/first-pass-complete` is called and `firstPassComplete[courseId] = true`. The next Study click enters review mode.

**Catalogue display order vs. navigation order**: the Catalogue view sorts rows by the dropdown (source / confidence / unrated), but clicking a row always uses the canonical order for arrow navigation — the sort only affects what the user sees in the table.

## Adding a New Course

To add any course:

1. **Add PDFs** (optional) to `Course Materials/{CourseName}/` (create the directory). These open in Preview from the card back.
2. **Add an entry to `data/courses.json`** with a new top-level course `id`, `name`, and one or more subcourses. Each subcourse needs `id`, `name`, `dataDir`, `pdfDir`, `assignments`. (The in-app **+ New course** button does this for you.)
3. **Create the data directory** at the path specified in `dataDir` (e.g., `data/probability/probability/`).
4. **Add problems**: create one JSON file per assignment following the schema above. You can add cards one at a time via the in-app **+ Add Card** button, or write the JSON directly.

**No code changes needed** in `server.py`, `app.js`, `index.html`, or `style.css`. The app reads courses dynamically. `_open_pdf()` and `_serve_problems()` both look up `pdfDir`/`dataDir` from `courses.json`, so they work generically.

## API Endpoints (server.py)

All JSON responses include `Cache-Control: no-store, no-cache, must-revalidate` so the client always sees fresh state.

- `GET /api/courses` — course registry
- `GET /api/problems/{courseId}/{subcourseId}` — all problems in canonical source order (see Recommendation Algorithm section)
- `GET /api/state` — current progress state
- `POST /api/rate` `{cardId, rating}` — append to confidence history
- `POST /api/seen` `{courseId, cardId}` — mark card as seen
- `POST /api/first-pass-complete` `{courseId}` — mark first pass done
- `POST /api/reset-progress` `{courseId}` — clear seenCards + firstPassComplete for a course
- `POST /api/clear-all-history` `{courseId, cardIds}` — clear ratings + progress (keeps images and comments)
- `POST /api/delete-card` `{cardId}` — permanently delete a card: removes the problem from its assignment JSON and clears its ratings, comments, images (and the `uploads/{cardId}/` directory)
- `POST /api/comment` `{cardId, text}` — overwrite the saved comment for a card
- `POST /api/upload/{cardId}` (multipart) — saves to `uploads/{cardId}/img_NNN.ext`
- `POST /api/delete-image` `{cardId, filename}` — delete an uploaded image
- `POST /api/rotate-image` `{cardId, filename}` — increment that image's `rotation` by 90° (mod 360); display-only rotation, file bytes unchanged
- `GET /api/images/{cardId}` — list images for a card
- `POST /api/reorder-courses` `{order: [courseId, ...]}` — rewrite `data/courses.json` with the courses in the given order; rejects requests whose ID set doesn't match the existing courses
- `GET /open-pdf/{subcourseId}/{filename}` — opens the solution PDF in macOS Preview

## Features Summary

- Fullscreen flashcard front with huge KaTeX-rendered math; text fills viewport width (4vw padding)
- Timer starts when card is shown, persists across flip, resets on next card
- Hint button (grounded in solution strategy, one sentence, KaTeX-rendered)
- Confidence slider 0–10 with keyboard shortcuts (number keys, Shift+0 for 10, Enter to submit). Shortcuts are suppressed when a textarea/input is focused so typing in the Comments box doesn't trigger a rating.
- ArrowLeft / ArrowRight navigate within the current session queue — see the Recommendation Algorithm table for exact per-mode semantics (wrap-around, first-pass filters to unrated only, etc.)
- Space flips card in both directions
- **Comments textarea** on card back (above My Work) with an explicit Save button; persists per card in `state/progress.json` under `comments`. No autosave — unsaved text is lost on navigation.
- Image upload (file picker) AND camera capture via `getUserMedia` (requires camera permission)
- Image carousel with prev/next on card back, fullscreen lightbox on click
- Catalogue view: all problems, confidence badges (red/yellow/green), full rating history, sort by source/confidence/unrated. Clicking a row enters catalogue mode (arrow navigation through canonical source order).
- Clear All History button on catalogue (double-confirm, preserves images and comments)
- Fancy Mode: purple/pink gradient theme + YouTube lofi stream in background; toggled by FANCY button bottom-right, persisted in localStorage
- "Copy for Claude" button on card back — copies the problem with a prompt asking for concise, rigorous, double-checked reasoning
- **Rearrange courses** on landing: every course row is draggable (subtle `≡` handle on the left); dropping reorders and auto-saves via `POST /api/reorder-courses` (rewrites `data/courses.json`). Clicking a course still navigates as normal — drag is detected by the browser's HTML5 DnD events

## Textbook References

If your problems reference a textbook (e.g. "Problem 1.2.3 of Folland"), keep the reference as part of the verbatim statement so the card matches the source exactly.

## Working with Solution PDFs

- If a solution PDF includes both the problem statement and the solution, the problem statement is the text BEFORE "Proof." or "Sol." — do NOT include the solution in the card's `statement`.
- PDFs are often LaTeX-typeset; convert mathematical notation to KaTeX-compatible LaTeX with `$...$` / `$$...$$`.
