<div align="center">

<img src="assets/logo.svg" alt="Chalk" width="116" />

# Chalk

### Find what you don't know yet — then drill it until you do.

A local-first flashcard app built for **proofs, problem sets, and anything you work out by hand.**
Rate your confidence, and Chalk keeps surfacing your weakest cards until they aren't weak anymore.

<br/>

![License: MIT](https://img.shields.io/badge/license-MIT-1a1a1a?style=flat-square)
![Python 3](https://img.shields.io/badge/python-3-1a1a1a?style=flat-square&logo=python&logoColor=white)
![Dependencies: none](https://img.shields.io/badge/dependencies-none-8b5cf6?style=flat-square)
![No build step](https://img.shields.io/badge/build_step-none-d946ef?style=flat-square)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-f97316?style=flat-square)

</div>

---

Most flashcard apps treat every card the same. Chalk doesn't. It tracks how confident you feel on every
single card and spends your study time where it actually matters — the stuff you're shakiest on — while
letting you keep a full digital record of work you do on **paper or a blackboard.**

It runs entirely on your own machine. No account, no cloud, no tracking, no build step. Just Python and a browser.

```
┌──────────────────────────────────────────────────────┐
│  2:14                                           Edit   │
│                                                        │
│        Let (X, 𝓜, μ) be a measure space with          │
│        μ(X) < ∞.  Show that L²(μ) ⊆ L¹(μ).             │
│                                                        │
│            ▸ Show Hint                                 │
│            tap or press Space to flip                  │
└──────────────────────────────────────────────────────┘
        How confident are you?   0 ──────●──── 10
                                         4
```

---

## ◇ Why Chalk

### 🎯 &nbsp;Confidence scoring that hunts your weak spots

This is the heart of Chalk. After each card you rate your confidence **0–10**, and Chalk remembers every
rating you've ever given. That history drives what you see next:

- **First pass** — go through every card once, shuffled, so nothing gets skipped.
- **Review** — once you've seen everything, Chalk re-sorts the deck **lowest-confidence-first**. Every time
  you rate a card the queue rebuilds, so your weakest cards keep floating to the top until they stop being weak.
- **Catalogue** — the whole deck at a glance with **red / yellow / green** confidence badges and full rating
  history, sortable by *weakest first*.

You stop re-reading what you already know and start fixing what you don't.

### ✍️ &nbsp;Photograph your handwritten work

The best math and science gets done with a pen, on paper or at a blackboard — Chalk lets you keep all of it
digitally. Snap a photo straight from your webcam or upload one for any card. Your worked solutions live
right next to the problem in a swipeable carousel, with a fullscreen lightbox, zoom, and rotate. Think in
ink, keep a clean digital record.

### ∑ &nbsp;Markdown + LaTeX, beautifully rendered

Problem statements and your own notes both render real math with [KaTeX](https://katex.org/) — `$...$` inline,
`$$...$$` display. Write notes per card in Markdown + LaTeX and they're typeset on the spot. No fighting with
plain-text equations.

### 🔁 &nbsp;A study loop that remembers

See everything once, then drill weakest-first — automatically. Per-card timers keep you honest, one-sentence
hints unstick you without giving it away, and a **"Copy for Claude"** button hands any problem to your AI tutor
with a prompt tuned for rigorous, double-checked reasoning.

---

## ◇ Quick start

You need **macOS**, **Python 3** (already installed on every Mac), and a browser. Nothing to install.

```bash
git clone https://github.com/your-username/chalk.git
cd chalk
python3 server.py
```

Then open **http://localhost:8000**.

Prefer a double-click? Use **`Start Chalk.command`** — it launches the server and opens the app for you.

> Chalk ships empty so it's yours from the first launch. Hit **+ New course** on the landing page to start
> building, or drop in a ready-made deck (see below).

---

## ◇ Add your own courses

A course is just data — **no code changes required.** Register it in `data/courses.json`, then add one JSON
file per assignment with your problems. You can do the whole thing from inside the app with the **+ New course**
and **+ Add Card** buttons, or edit the files directly.

```json
{
  "id": "probability",
  "number": 1,
  "statement": "Let $X_1, X_2, \\dots$ be i.i.d. with $\\mathbb{E}[X_1] = \\mu$. State and prove the WLLN.",
  "hint": "Truncate, bound the variance, then apply Chebyshev.",
  "tags": ["limit-theorems", "convergence"]
}
```

Full schema, the data model, and the recommendation algorithm are documented in
[`CLAUDE.md`](CLAUDE.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## ◇ Contribute — bring your courses with you

**The best thing you can do for Chalk is share the deck you're studying.** Prelims, quals, finals — whatever
you're grinding through, someone else is too. If you've built a Real Analysis, Probability, Algebra, Topology,
or ML deck, **open a PR and add it** so the next student doesn't start from a blank page.

- 📚 **Add a course** — share your problems and hints. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the one-file-per-assignment format.
- 🛠️ **Improve the app** — features and fixes welcome; keep it dependency-free.
- 💡 **Have an idea?** Open an issue.

> Only contribute content you have the right to share — original or openly-licensed problems, not copyrighted
> solution manuals. Your personal progress and photos are gitignored, so they never end up in a PR.

---

## ◇ Built with

- **Vanilla JavaScript** — no framework, no bundler
- **Python standard library** — the entire server is one file, zero pip installs
- **[KaTeX](https://katex.org/)** — vendored locally for fast, offline math rendering
- **Your machine, only** — everything stays local; no account, no cloud, no telemetry

No `node_modules`. No build step. Clone it and run it.

---

<div align="center">

Built for everyone studying something genuinely hard. ◇

**[Get started](#-quick-start)** · **[Add a course](CONTRIBUTING.md)** · **[MIT License](LICENSE)**

</div>
