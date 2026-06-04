# Contributing to Chalk

Thanks for helping make Chalk better. Two kinds of contributions are especially welcome:

1. **Courses** — share the decks you're studying so other students don't start from a blank page.
2. **Features & fixes** — anything that makes the app nicer to study with.

---

## ◇ Contribute a course

This is the highest-impact thing you can do. If you've built a Real Analysis, Probability, Algebra, Topology, ML, or any other deck — open a PR and let the next person studying that subject benefit.

A course is just data — no code changes required.

### 1. Register the course in `data/courses.json`

```json
{
  "id": "probability",
  "name": "Probability",
  "subcourses": [
    {
      "id": "probability",
      "name": "Probability",
      "dataDir": "data/probability/probability",
      "pdfDir": "Course Materials/Probability",
      "assignments": ["hw1", "hw2", "midterm", "final"]
    }
  ]
}
```

### 2. Add one JSON file per assignment under `dataDir`

`data/probability/probability/hw1.json`:

```json
{
  "assignment": "HW1",
  "course": "Probability",
  "courseId": "probability",
  "parentCourseId": "probability",
  "solutionPdf": "",
  "problems": [
    {
      "id": "probability-hw1-p1",
      "number": 1,
      "statement": "Let $X$ be a random variable with ... $LaTeX$ allowed.",
      "hint": "One-sentence nudge grounded in the actual solution.",
      "tags": ["expectation", "independence"]
    }
  ]
}
```

You can also build the whole course **inside the app** with the **+ New course** and **+ Add Card** buttons, then commit the generated files.

### Course PR guidelines

- **Card IDs are globally unique**: `{subcourseId}-{assignment}-p{number}`.
- **Multi-part problems stay on one card** — put (a)(b)(c) in a single `statement`.
- **Hints are one sentence**, grounded in the real solution — not a guess.
- **Only contribute content you have the right to share.** Don't commit copyrighted problem sets, solution manuals, or PDFs you don't own. Original or openly-licensed problems only. Leave `solutionPdf` blank if you can't share the PDF — the rest of the card still works.
- Keep `statement` text faithful to the source so the card matches what you'll see on the exam.

## ◇ Contribute a feature or fix

- The whole app is dependency-free: vanilla JS (`app.js`), a Python stdlib server (`server.py`), one HTML shell, and one stylesheet. No build step.
- Run it with `python3 server.py` and open `http://localhost:8000`.
- Keep it dependency-free and the data model backward-compatible.
- See [`CLAUDE.md`](CLAUDE.md) for the full architecture, data model, and the confidence/recommendation algorithm.

## Opening a pull request

1. Fork and branch.
2. Make your change; test locally (`python3 server.py`).
3. Make sure you haven't committed personal study data — `state/progress.json` and `uploads/` are gitignored for exactly this reason.
4. Open the PR with a short description. For a course, say which subject and roughly how many cards.

Happy studying. ◇
