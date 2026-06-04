/* ── Prelim Flashcard App ────────────────────────────────────────
   All client-side logic. No dependencies beyond KaTeX (loaded in HTML).

   To add new courses: only data/courses.json and data files need to change.
   This code is course-agnostic — it reads the course structure dynamically.
────────────────────────────────────────────────────────────────── */

// ── Global State ────────────────────────────────────────────────
let courses = [];
let currentCourse = null;      // the course object from courses.json
let allProblems = [];           // flat array of all problems for current course
let studyQueue = [];            // ordered card IDs for current study session
let studyIndex = 0;
let studyMode = null;           // "first-pass" | "review" | "catalogue"
let selectedConfidence = null;
let progressState = null;       // from server: confidenceHistory, images, etc.
let cardTimerStart = null;      // timestamp when current card was shown
let cardTimerInterval = null;   // setInterval id for timer updates
let timerCardIndex = -1;        // which studyIndex the timer is for
let dragSourceId = null;        // course ID being dragged on the landing page

// ── Init ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", init);

async function init() {
    // Restore fancy mode preference
    if (localStorage.getItem("fancyMode") === "true") {
        document.body.classList.add("fancy");
        startMusic();
    }
    const res = await fetch("/api/courses");
    const data = await res.json();
    courses = data.courses;
    renderCourseList();
}

// ── Fancy Mode ──────────────────────────────────────────────────
function toggleFancyMode() {
    const on = document.body.classList.toggle("fancy");
    localStorage.setItem("fancyMode", on);
    if (on) {
        startMusic();
    } else {
        stopMusic();
    }
}

function startMusic() {
    const iframe = document.getElementById("bg-music");
    // YouTube embed with autoplay, loop
    iframe.src = "https://www.youtube.com/embed/k9ts6p63ns0?autoplay=1&loop=1&playlist=k9ts6p63ns0";
}

function stopMusic() {
    const iframe = document.getElementById("bg-music");
    iframe.src = "";
}

// ── Clear All History ───────────────────────────────────────────
async function clearAllHistory() {
    const confirmed = confirm(
        "WARNING: This will permanently delete ALL your study progress, " +
        "confidence ratings, and session history for this course.\n\n" +
        "Uploaded images will NOT be deleted.\n\n" +
        "Are you sure?"
    );
    if (!confirmed) return;
    const doubleConfirm = confirm(
        "This cannot be undone. Type OK to confirm you want to erase all history."
    );
    if (!doubleConfirm) return;

    await fetch("/api/reset-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: currentCourse.id })
    });
    // Also clear confidence history for all cards in this course
    await fetch("/api/clear-all-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId: currentCourse.id, cardIds: allProblems.map(p => p.id) })
    });
    await loadState();
    renderProgressSummary();
}

// ── Delete Card ─────────────────────────────────────────────────
async function deleteCard(p) {
    const label = `${p._course} ${p._assignment} #${p.number}`;
    const confirmed = confirm(
        `Permanently delete this card?\n\n${label}\n\n` +
        `This removes the card from its assignment file and deletes its ratings, comments, and uploaded images. This cannot be undone.`
    );
    if (!confirmed) return;
    const doubleConfirm = confirm(`Really delete "${label}"? This cannot be undone.`);
    if (!doubleConfirm) return;

    const res = await fetch("/api/delete-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: p.id })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(`Failed to delete card: ${data.error || res.status}`);
        return;
    }
    await reloadCourseData();
    await loadState();
    renderCatalogueTable();
}

// ── Timer ───────────────────────────────────────────────────────
function startTimer() {
    stopTimer();
    cardTimerStart = Date.now();
    updateTimerDisplay();
    cardTimerInterval = setInterval(updateTimerDisplay, 1000);
}

function stopTimer() {
    if (cardTimerInterval) {
        clearInterval(cardTimerInterval);
        cardTimerInterval = null;
    }
}

function updateTimerDisplay() {
    if (!cardTimerStart) return;
    const elapsed = Math.floor((Date.now() - cardTimerStart) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const str = `${mins}:${secs.toString().padStart(2, "0")}`;
    const frontTimer = document.getElementById("card-timer");
    const backTimer = document.getElementById("card-timer-back");
    if (frontTimer) frontTimer.textContent = str;
    if (backTimer) backTimer.textContent = str;
}

// ── Hint ────────────────────────────────────────────────────────
function toggleHint() {
    const hintText = document.getElementById("hint-text");
    const hintBtn = document.getElementById("hint-btn");
    if (hintText.classList.contains("visible")) {
        hintText.classList.remove("visible");
        hintBtn.textContent = "Show Hint";
    } else {
        const problem = getProblemById(studyQueue[studyIndex]);
        if (problem && problem.hint) {
            renderLatex(hintText, problem.hint);
        } else {
            hintText.textContent = "No hint available for this problem.";
        }
        hintText.classList.add("visible");
        hintBtn.textContent = "Hide Hint";
    }
}

// ── View Management ─────────────────────────────────────────────
function showView(name) {
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("view-" + name).classList.add("active");
}

// ── Landing: Course List ────────────────────────────────────────
function renderCourseList() {
    const container = document.getElementById("course-list");
    container.innerHTML = "";

    courses.forEach((course, i) => {
        const btn = document.createElement("button");
        btn.className = "course-card";
        btn.style.setProperty("--card-index", i);
        btn.dataset.courseId = course.id;
        btn.setAttribute("draggable", "true");

        const handle = document.createElement("span");
        handle.className = "course-handle";
        handle.setAttribute("aria-hidden", "true");
        handle.textContent = "≡";

        const idx = document.createElement("span");
        idx.className = "course-index";
        idx.textContent = String(i + 1).padStart(2, "0");

        const name = document.createElement("span");
        name.className = "course-card-name";
        name.textContent = course.name;

        const arrow = document.createElement("span");
        arrow.className = "course-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "→";

        btn.append(handle, idx, name, arrow);
        btn.onclick = () => {
            // Suppress the click if it was actually the end of a drag.
            if (btn.dataset.justDragged === "1") {
                btn.dataset.justDragged = "";
                return;
            }
            selectCourse(course);
        };
        installCardDragHandlers(btn);
        container.appendChild(btn);
    });

    // Ghost row: + new course (not draggable)
    const addBtn = document.createElement("button");
    addBtn.className = "course-card course-card-add";
    addBtn.style.setProperty("--card-index", courses.length);
    const addHandle = document.createElement("span");
    addHandle.className = "course-handle";
    addHandle.setAttribute("aria-hidden", "true");
    addHandle.textContent = "≡";
    const addIdx = document.createElement("span");
    addIdx.className = "course-index";
    addIdx.textContent = "+";
    const addName = document.createElement("span");
    addName.className = "course-card-name";
    addName.textContent = "New course";
    const addArrow = document.createElement("span");
    addArrow.className = "course-arrow";
    addArrow.setAttribute("aria-hidden", "true");
    addArrow.textContent = "→";
    addBtn.append(addHandle, addIdx, addName, addArrow);
    addBtn.onclick = openAddCourseForm;
    container.appendChild(addBtn);

    const countEl = document.getElementById("landing-count");
    if (countEl) {
        countEl.textContent = String(courses.length).padStart(2, "0");
    }
    updateLandingMeta();
}

function installCardDragHandlers(btn) {
    btn.addEventListener("dragstart", e => {
        dragSourceId = btn.dataset.courseId;
        btn.classList.add("dragging");
        try { e.dataTransfer.setData("text/plain", dragSourceId); } catch (_) {}
        e.dataTransfer.effectAllowed = "move";
    });
    btn.addEventListener("dragend", () => {
        btn.classList.remove("dragging");
        document.querySelectorAll(".course-card.drop-above, .course-card.drop-below")
            .forEach(el => el.classList.remove("drop-above", "drop-below"));
        dragSourceId = null;
        // Block the synthetic click that fires after drop on some browsers.
        btn.dataset.justDragged = "1";
        setTimeout(() => { btn.dataset.justDragged = ""; }, 50);
    });
    btn.addEventListener("dragover", e => {
        if (!dragSourceId || dragSourceId === btn.dataset.courseId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const rect = btn.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;
        btn.classList.toggle("drop-above", above);
        btn.classList.toggle("drop-below", !above);
    });
    btn.addEventListener("dragleave", () => {
        btn.classList.remove("drop-above", "drop-below");
    });
    btn.addEventListener("drop", async e => {
        e.preventDefault();
        const targetId = btn.dataset.courseId;
        if (!dragSourceId || dragSourceId === targetId) return;
        const rect = btn.getBoundingClientRect();
        const above = (e.clientY - rect.top) < rect.height / 2;

        const order = courses.map(c => c.id);
        const fromIdx = order.indexOf(dragSourceId);
        order.splice(fromIdx, 1);
        let toIdx = order.indexOf(targetId);
        if (!above) toIdx += 1;
        order.splice(toIdx, 0, dragSourceId);

        // Reorder local state immediately for snappy feedback.
        const byId = new Map(courses.map(c => [c.id, c]));
        courses = order.map(id => byId.get(id));
        renderCourseList();

        // Persist. On failure, surface and reload from server.
        const res = await fetch("/api/reorder-courses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order })
        });
        if (!res.ok) {
            alert("Failed to save new course order.");
            const r = await fetch("/api/courses", { cache: "no-store" });
            const data = await r.json();
            courses = data.courses || [];
            renderCourseList();
        }
    });
}

function updateLandingMeta() {
    const el = document.getElementById("landing-meta");
    if (!el) return;
    const d = new Date();
    const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
    const mm = months[d.getMonth()];
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    el.textContent = `${mm} ${dd} ${yyyy}  ·  ${hh}:${mi}  ·  LIVE`;
}
setInterval(() => {
    if (document.getElementById("view-landing")?.classList.contains("active")) {
        updateLandingMeta();
    }
}, 30000);

// ── Course Home ─────────────────────────────────────────────────
async function selectCourse(course) {
    currentCourse = course;
    document.getElementById("course-title").textContent = course.name;

    // Load all problems from all subcourses
    allProblems = [];
    for (const sc of course.subcourses) {
        const res = await fetch(`/api/problems/${course.id}/${sc.id}`);
        const data = await res.json();
        allProblems = allProblems.concat(data.problems);
    }

    // Load progress state. Server recomputes firstPassComplete on every read,
    // so the flag is always correct (self-heals after cards are added/removed).
    await loadState();
    renderProgressSummary();
    showView("course");
}

async function loadState() {
    const res = await fetch("/api/state", { cache: "no-store" });
    progressState = await res.json();
}

function renderProgressSummary() {
    const el = document.getElementById("study-progress-summary");
    const courseId = currentCourse.id;
    const seen = (progressState.seenCards || {})[courseId] || [];
    const total = allProblems.length;
    const firstPassDone = (progressState.firstPassComplete || {})[courseId] || false;

    if (total === 0) {
        el.textContent = "No problems loaded yet.";
        return;
    }

    const rated = allProblems.filter(p => {
        const h = (progressState.confidenceHistory || {})[p.id];
        return h && h.length > 0;
    }).length;

    if (firstPassDone) {
        el.innerHTML = `First pass complete. ${rated}/${total} rated.<br>Study mode will focus on low-confidence cards.`;
    } else {
        el.innerHTML = `First pass: ${rated}/${total} rated. Rate all ${total} to unlock review mode.`;
    }
}

// ── Study Mode ──────────────────────────────────────────────────
async function startStudy() {
    await loadState();
    const courseId = currentCourse.id;
    const firstPassDone = (progressState.firstPassComplete || {})[courseId] || false;

    if (firstPassDone) {
        studyMode = "review";
        buildReviewQueue();
    } else {
        studyMode = "first-pass";
        buildFirstPassQueue();
    }

    if (studyQueue.length === 0) {
        alert("No cards to study!");
        return;
    }

    studyIndex = 0;
    timerCardIndex = -1; // force timer to start on first card
    showCardFront();
}

function buildFirstPassQueue() {
    // Queue contains only cards that have never been rated.
    // Shuffled once at session start; in first-pass mode submitRating
    // splices the rated card out, so the queue only ever holds unrated cards.
    const history = progressState.confidenceHistory || {};
    const unrated = allProblems.filter(p => {
        const h = history[p.id];
        return !h || h.length === 0;
    });
    shuffle(unrated);
    studyQueue = unrated.map(p => p.id);
}

function buildReviewQueue() {
    // All cards sorted by latest confidence ascending. Unrated cards (shouldn't
    // exist by the time we're here, but defensively) get top priority.
    // Random tiebreaker among equal confidences.
    const scored = allProblems.map(p => {
        const history = (progressState.confidenceHistory || {})[p.id] || [];
        const latest = history.length > 0 ? history[history.length - 1].rating : -1;
        const score = latest === -1 ? -1 : latest;
        return { id: p.id, score, tiebreaker: Math.random() };
    });

    scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.tiebreaker - b.tiebreaker;
    });

    studyQueue = scored.map(s => s.id);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// ── Skip (no metadata change, wraps at boundaries) ──────────────
function skipNext() {
    if (studyQueue.length === 0) return;
    studyIndex = (studyIndex + 1) % studyQueue.length;
    showCardFront();
}

function skipPrev() {
    if (studyQueue.length === 0) return;
    studyIndex = (studyIndex - 1 + studyQueue.length) % studyQueue.length;
    showCardFront();
}

// ── Card Front ──────────────────────────────────────────────────
function showCardFront() {
    if (studyIndex >= studyQueue.length) {
        stopTimer();
        handleQueueComplete();
        return;
    }

    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) { studyIndex++; showCardFront(); return; }

    document.getElementById("card-progress").textContent =
        `${studyIndex + 1} / ${studyQueue.length}`;
    renderLatex(document.getElementById("card-statement"), problem.statement);
    document.getElementById("card-source").textContent =
        `${problem._course} ${problem._assignment}, Problem ${problem.number}`;

    // Reset hint
    document.getElementById("hint-text").classList.remove("visible");
    document.getElementById("hint-btn").textContent = "Show Hint";
    // Hide hint button if no hint available
    document.getElementById("hint-btn").style.display = problem.hint ? "" : "none";

    // Start timer only for a new card (don't reset when flipping back from card back)
    if (timerCardIndex !== studyIndex) {
        timerCardIndex = studyIndex;
        startTimer();
    }

    // Always leave edit mode when (re)entering the front
    setCardEditMode(false);

    showView("card-front");
}

// ── Card Front: Edit statement / hint ───────────────────────────
function setCardEditMode(editing) {
    const display = document.getElementById("card-display");
    const edit = document.getElementById("card-edit");
    const editBtn = document.getElementById("edit-card-btn");
    if (!display || !edit) return;
    display.style.display = editing ? "none" : "";
    edit.style.display = editing ? "flex" : "none";
    editBtn.style.display = editing ? "none" : "";
}

function openCardEdit() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;
    document.getElementById("edit-statement-ta").value = problem.statement || "";
    document.getElementById("edit-hint-ta").value = problem.hint || "";
    setCardEditMode(true);
    document.getElementById("edit-statement-ta").focus();
}

function cancelCardEdit() {
    setCardEditMode(false);
}

async function saveCardEdit() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;
    const statement = document.getElementById("edit-statement-ta").value;
    const hint = document.getElementById("edit-hint-ta").value;

    const res = await fetch("/api/edit-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: problem.id, statement, hint })
    });
    if (!res.ok) {
        alert("Failed to save card edit.");
        return;
    }

    // Update the in-memory problem so the UI reflects the edit without a reload.
    problem.statement = statement;
    problem.hint = hint;

    renderLatex(document.getElementById("card-statement"), problem.statement);
    // Reset hint visibility and show/hide the Hint button based on new value.
    document.getElementById("hint-text").classList.remove("visible");
    document.getElementById("hint-btn").textContent = "Show Hint";
    document.getElementById("hint-btn").style.display = problem.hint ? "" : "none";

    setCardEditMode(false);
}

async function handleQueueComplete() {
    const courseId = currentCourse.id;
    const firstPassDone = (progressState.firstPassComplete || {})[courseId] || false;

    if (!firstPassDone) {
        // Check if ALL cards have been rated (not just seen)
        const allRated = allProblems.every(p => {
            const h = (progressState.confidenceHistory || {})[p.id];
            return h && h.length > 0;
        });

        if (allRated) {
            await fetch("/api/first-pass-complete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ courseId })
            });
            await loadState();
            alert("First pass complete! From now on, study mode will prioritize your lowest-confidence cards.");
        } else {
            const rated = allProblems.filter(p => {
                const h = (progressState.confidenceHistory || {})[p.id];
                return h && h.length > 0;
            }).length;
            alert(`Session ended. ${rated}/${allProblems.length} rated — rate all problems to complete the first pass.`);
        }
    } else {
        alert("Review session complete! Start again to continue drilling weak spots.");
    }

    showView("course");
    renderProgressSummary();
}

// ── Card Back ───────────────────────────────────────────────────
function flipCard() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;

    // Mark as seen
    const courseId = currentCourse.id;
    fetch("/api/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, cardId: problem.id })
    });
    // Update local state
    if (!progressState.seenCards) progressState.seenCards = {};
    if (!progressState.seenCards[courseId]) progressState.seenCards[courseId] = [];
    if (!progressState.seenCards[courseId].includes(problem.id)) {
        progressState.seenCards[courseId].push(problem.id);
    }

    renderLatex(document.getElementById("card-statement-back"), problem.statement);
    renderConfidenceSlider(problem.id);
    renderImageGallery(problem.id);
    loadComment(problem.id);

    showView("card-back");
}

// ── Comments ────────────────────────────────────────────────────
function setCommentMode(mode, text) {
    const view = document.getElementById("comment-view");
    const rendered = document.getElementById("comment-rendered");
    const ta = document.getElementById("comment-textarea");
    const saveBtn = document.getElementById("btn-save-comment");
    if (!view || !ta) return;
    if (mode === "view") {
        renderMarkdown(rendered, text);
        view.style.display = "flex";
        ta.style.display = "none";
        saveBtn.style.display = "none";
    } else {
        view.style.display = "none";
        ta.style.display = "block";
        saveBtn.style.display = "inline-block";
        saveBtn.textContent = "Save";
    }
}

function loadComment(cardId) {
    const existing = (progressState.comments || {})[cardId] || "";
    const ta = document.getElementById("comment-textarea");
    if (ta) ta.value = existing;
    if (existing.trim() === "") {
        setCommentMode("edit");
    } else {
        setCommentMode("view", existing);
    }
}

function editComment() {
    setCommentMode("edit");
    const ta = document.getElementById("comment-textarea");
    if (ta) ta.focus();
}

async function saveComment() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;
    const text = document.getElementById("comment-textarea").value;

    await fetch("/api/comment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: problem.id, text })
    });

    if (!progressState.comments) progressState.comments = {};
    progressState.comments[problem.id] = text;

    if (text.trim() === "") {
        const btn = document.getElementById("btn-save-comment");
        btn.textContent = "Saved ✓";
        setTimeout(() => { btn.textContent = "Save"; }, 1200);
    } else {
        setCommentMode("view", text);
    }
}

function renderConfidenceSlider(cardId) {
    const container = document.getElementById("confidence-slider");
    container.innerHTML = "";
    selectedConfidence = null;
    document.getElementById("btn-done").disabled = true;

    // Get previous rating to show as hint
    const history = (progressState.confidenceHistory || {})[cardId] || [];
    const lastRating = history.length > 0 ? history[history.length - 1].rating : null;

    for (let i = 0; i <= 10; i++) {
        const btn = document.createElement("button");
        btn.className = "conf-btn";
        btn.textContent = i;
        if (lastRating === i) {
            btn.style.borderColor = "#999";
        }
        btn.onclick = () => selectConfidence(i);
        container.appendChild(btn);
    }
}

function selectConfidence(value) {
    selectedConfidence = value;
    document.querySelectorAll(".conf-btn").forEach((btn, i) => {
        btn.classList.toggle("selected", i === value);
    });
    document.getElementById("btn-done").disabled = false;
}

async function submitRating() {
    if (selectedConfidence === null) return;

    const problem = getProblemById(studyQueue[studyIndex]);
    const justRatedId = problem.id;

    await fetch("/api/rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: justRatedId, rating: selectedConfidence })
    });

    // Update local state so the next queue decision sees the new rating.
    if (!progressState.confidenceHistory) progressState.confidenceHistory = {};
    if (!progressState.confidenceHistory[justRatedId]) {
        progressState.confidenceHistory[justRatedId] = [];
    }
    progressState.confidenceHistory[justRatedId].push({
        rating: selectedConfidence,
        timestamp: new Date().toISOString()
    });

    if (studyMode === "first-pass") {
        // Drop the card we just rated; the queue must only ever contain unrated.
        studyQueue.splice(studyIndex, 1);
        if (studyIndex >= studyQueue.length) studyIndex = 0;
    } else if (studyMode === "review") {
        // Dynamically re-sort with the new confidence, then skip past the
        // card we just rated so the user sees the next-lowest instead of the
        // same card again.
        buildReviewQueue();
        if (studyQueue.length > 0 && studyQueue[0] === justRatedId) {
            studyIndex = Math.min(1, studyQueue.length - 1);
        } else {
            studyIndex = 0;
        }
    } else if (studyMode === "catalogue") {
        // Advance in canonical order, wrap at the end.
        studyIndex = (studyIndex + 1) % studyQueue.length;
        // Catalogue never drains, so handleQueueComplete won't auto-mark first
        // pass — refresh state so the server-side recompute updates the flag.
        await loadState();
    } else {
        // Fallback — should not happen; behave like the old code.
        studyIndex++;
    }

    showCardFront();
}

// ── PDF Opening ─────────────────────────────────────────────────
function openSolutionPdf() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;
    if (problem.solutionFile) {
        // Per-card override: open the user-specified file directly.
        fetch("/api/open-path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: problem.solutionFile })
        });
    } else if (problem._solutionPdf) {
        // Existing flow: assignment-level PDF, resolved via subcourse pdfDir.
        fetch(`/open-pdf/${problem._courseId}/${encodeURIComponent(problem._solutionPdf)}`);
    } else {
        // No solution configured — fall back to opening the Course Materials folder.
        fetch("/api/open-path", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: "Course Materials" })
        });
    }
}

// ── Ask Claude ──────────────────────────────────────────────────
function askClaude() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;
    const text = `You are helping me study for a graduate-level mathematics preliminary exam. The problem is from ${problem._course} ${problem._assignment}.

Always reason thoroughly and deeply, but answer concisely and directly. Treat every request as complex unless I explicitly say otherwise.

Extra High Efforts: my questions are HARD. It is CRITICAL for you to use MAXIMAL THINKING to reason for an answer. NEVER give answers that are NOT fully thought out. Figure out everything required before writing down your final response. Spend extra high efforts to make sure your reasoning is correct at every single step. Do NOT skip ANY logical step or calculation detail in your reasoning, but only output concise answer consistent with the style guidelines below.

Formats: Write clean rendered markdown math. All math notations must be rendered in markdown latex, either in-text or in multi-line equation blocks. NEVER write plain text math symbols or greek letters. Avoid using \`\\,\` or \`\\;\` or "!" as spacing commands in writing the KaTeX math equations, with NO exceptions. Avoid paired phrases that say the same thing, with NO exceptions.

No Repetition: Do not repeat the same idea in different words. Avoid: "It is not missing, it is just hidden." Write: "It is hidden." Avoid: "In order to compute the result, we first begin by doing this." Write: "First, do this". Avoid: "This is true due to the fact that…" Write: "This is because…". Use short sentences. State each idea once, clearly.

No figurative words: NEVER use metaphors. NEVER use imagery or expressive verbs or adjectives to describe simple, scientific ideas. Avoid: "These quantities annihilate." Write: "The two terms cancel." Avoid: "The sequence settles down." Write: "The sequence converges." Avoid: "The function dies off." Write: "The function converges to 0." Use only simple, common words. Avoid filler words and extra phrases. Always use direct statements instead of figurative language. Focus on the concrete, detailed math, rather than painting a picture with intuition. Remove all non-essential, descriptive words.

Directness: NEVER acknowledge or summarize my question before answering: avoid starting your response with sentences like "This is a sharp question." or "Great observation!" Instead, go straight to the point. On the other hand, NEVER summarize or recap your answer after writing it out. When you are finished, just STOP. NEVER write something like "To sum up, ..." or "In a nutshell, this is ...". Neither a beginning / acknowledge nor a summary / recap should be written in your response, with NO exceptions.

Attached images: I may attach images with this message. They are either (a) the official solution — if so, consult it carefully and ground your reasoning in it; or (b) my own work on the problem — if so, critique and analyze it carefully, identify mistakes or gaps, and give targeted hints and teachings rather than just handing me the full solution. Determine which case applies from the image content.

Problem:
${problem.statement}`;
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.getElementById("btn-ask-claude");
        btn.textContent = "Copied!";
        setTimeout(() => { btn.textContent = "Copy for Claude"; }, 1500);
    });
}

// ── Image Carousel ──────────────────────────────────────────────
let carouselIndex = 0;
let carouselCardId = null;

// Apply a rotation to an <img>. When rotated 90/270 the visual width and
// height swap, so for the lightbox (which sizes to viewport) we also swap
// max-width/max-height so the rotated image still fits on screen.
function applyRotation(imgEl, deg, swapMaxes) {
    const r = ((deg % 360) + 360) % 360;
    imgEl.style.transform = r ? `rotate(${r}deg)` : "";
    if (swapMaxes) {
        if (r === 90 || r === 270) {
            imgEl.style.maxWidth = "94vh";
            imgEl.style.maxHeight = "96vw";
        } else {
            imgEl.style.maxWidth = "";
            imgEl.style.maxHeight = "";
        }
    }
}

async function rotateImage(cardId, filename) {
    const resp = await fetch("/api/rotate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, filename })
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const imgs = (progressState.images || {})[cardId] || [];
    const target = imgs.find(i => i.filename === filename);
    if (target) target.rotation = data.rotation;

    // Update any visible carousel slide(s) for this filename in place,
    // so we don't reset the carousel index.
    document.querySelectorAll(".carousel-slide").forEach((slide, idx) => {
        if (imgs[idx] && imgs[idx].filename === filename) {
            const slideImg = slide.querySelector("img");
            if (slideImg) applyRotation(slideImg, data.rotation, false);
        }
    });

    // If the lightbox is showing this card, re-apply transform (preserving zoom).
    const lightbox = document.getElementById("lightbox");
    if (lightbox && lightbox.classList.contains("active") && lightboxCardId === cardId) {
        applyLightboxTransform();
    }
}

function renderImageGallery(cardId) {
    carouselCardId = cardId;
    carouselIndex = 0;

    const carousel = document.getElementById("image-carousel");
    const track = document.getElementById("carousel-track");
    track.innerHTML = "";

    const images = (progressState.images || {})[cardId] || [];

    if (images.length === 0) {
        carousel.classList.remove("has-images");
        return;
    }

    carousel.classList.add("has-images");

    images.forEach((img, idx) => {
        const slide = document.createElement("div");
        slide.className = "carousel-slide" + (idx === 0 ? " active" : "");

        const imgEl = document.createElement("img");
        imgEl.src = `/uploads/${cardId}/${img.filename}`;
        imgEl.onclick = () => openLightbox(cardId, idx);
        applyRotation(imgEl, img.rotation || 0, false);

        const rotateBtn = document.createElement("button");
        rotateBtn.className = "slide-rotate";
        rotateBtn.title = "Rotate 90\u00b0";
        rotateBtn.textContent = "\u21bb";
        rotateBtn.onclick = (e) => {
            e.stopPropagation();
            rotateImage(cardId, img.filename);
        };

        const deleteBtn = document.createElement("button");
        deleteBtn.className = "slide-delete";
        deleteBtn.textContent = "\u00d7";
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!confirm("Delete this image?")) return;
            await fetch("/api/delete-image", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cardId, filename: img.filename })
            });
            progressState.images[cardId] = progressState.images[cardId].filter(
                i => i.filename !== img.filename
            );
            renderImageGallery(cardId);
        };

        slide.appendChild(imgEl);
        slide.appendChild(rotateBtn);
        slide.appendChild(deleteBtn);
        track.appendChild(slide);
    });

    updateCarouselCounter();
}

function carouselPrev() {
    const slides = document.querySelectorAll(".carousel-slide");
    if (slides.length === 0) return;
    slides[carouselIndex].classList.remove("active");
    carouselIndex = (carouselIndex - 1 + slides.length) % slides.length;
    slides[carouselIndex].classList.add("active");
    updateCarouselCounter();
}

function carouselNext() {
    const slides = document.querySelectorAll(".carousel-slide");
    if (slides.length === 0) return;
    slides[carouselIndex].classList.remove("active");
    carouselIndex = (carouselIndex + 1) % slides.length;
    slides[carouselIndex].classList.add("active");
    updateCarouselCounter();
}

function updateCarouselCounter() {
    const slides = document.querySelectorAll(".carousel-slide");
    const counter = document.getElementById("carousel-counter");
    if (slides.length === 0) {
        counter.textContent = "";
    } else {
        counter.textContent = `${carouselIndex + 1} / ${slides.length}`;
    }
}

async function uploadImage(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const problem = getProblemById(studyQueue[studyIndex]);
    if (!progressState.images) progressState.images = {};
    if (!progressState.images[problem.id]) progressState.images[problem.id] = [];

    for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`/api/upload/${problem.id}`, {
            method: "POST",
            body: formData
        });
        const result = await res.json();
        progressState.images[problem.id].push({
            filename: result.filename,
            uploadedAt: new Date().toISOString()
        });
        renderImageGallery(problem.id);
    }

    event.target.value = "";
}

// ── Camera Capture ──────────────────────────────────────────────
// Last-used base constraints (without dimensions) so we can rebuild on rotation.
let _cameraBaseConstraints = null;

function _buildOrientedConstraints(baseConstraints) {
    const isPortrait = window.matchMedia("(orientation: portrait)").matches;
    const videoBase = (baseConstraints && typeof baseConstraints.video === "object") ? baseConstraints.video : {};
    const dims = isPortrait
        ? { width: { ideal: 1440 }, height: { ideal: 1920 }, aspectRatio: { ideal: 3 / 4 } }
        : { width: { ideal: 1920 }, height: { ideal: 1440 }, aspectRatio: { ideal: 4 / 3 } };
    return { ...(baseConstraints || {}), video: { ...videoBase, ...dims } };
}

async function startCameraStream(constraints) {
    const video = document.getElementById("camera-video");
    if (!video) return;
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    _cameraBaseConstraints = constraints;
    const stream = await navigator.mediaDevices.getUserMedia(_buildOrientedConstraints(constraints));
    video.srcObject = stream;
}

function _onCameraOrientationChange() {
    if (!document.getElementById("camera-overlay") || !_cameraBaseConstraints) return;
    startCameraStream(_cameraBaseConstraints).catch(() => {});
}

async function populateCameraDevices() {
    const select = document.getElementById("camera-device-select");
    if (!select) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter(d => d.kind === "videoinput");
    const currentId = (() => {
        const video = document.getElementById("camera-video");
        const track = video && video.srcObject && video.srcObject.getVideoTracks()[0];
        return track && track.getSettings ? track.getSettings().deviceId : null;
    })();
    select.innerHTML = "";
    cams.forEach((d, i) => {
        const opt = document.createElement("option");
        opt.value = d.deviceId;
        opt.textContent = d.label || `Camera ${i + 1}`;
        if (d.deviceId && d.deviceId === currentId) opt.selected = true;
        select.appendChild(opt);
    });
}

function takePhoto() {
    const problem = getProblemById(studyQueue[studyIndex]);
    if (!problem) return;

    // Create camera overlay
    const overlay = document.createElement("div");
    overlay.id = "camera-overlay";
    overlay.innerHTML = `
        <div class="camera-top">
            <span class="camera-label"><span class="camera-dot"></span>CAPTURE</span>
            <button class="camera-close" onclick="closeCamera()" aria-label="Close">×</button>
        </div>
        <div class="camera-frame">
            <video id="camera-video" autoplay playsinline></video>
            <span class="camera-corner camera-corner-tl" aria-hidden="true"></span>
            <span class="camera-corner camera-corner-tr" aria-hidden="true"></span>
            <span class="camera-corner camera-corner-bl" aria-hidden="true"></span>
            <span class="camera-corner camera-corner-br" aria-hidden="true"></span>
        </div>
        <div class="camera-bottom">
            <div class="camera-devices">
                <select id="camera-device-select" aria-label="Camera"></select>
            </div>
            <button class="camera-shutter" onclick="capturePhoto()" aria-label="Capture"><span></span></button>
            <div class="camera-spacer"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const select = document.getElementById("camera-device-select");
    select.addEventListener("change", async (e) => {
        try {
            await startCameraStream({ video: { deviceId: { exact: e.target.value } } });
        } catch {
            alert("Could not switch to that camera.");
        }
    });

    startCameraStream({ video: { facingMode: "environment" } })
        .then(populateCameraDevices)
        .catch(() => {
            closeCamera();
            alert("Could not access camera. Check System Settings > Privacy > Camera.");
        });

    window.addEventListener("orientationchange", _onCameraOrientationChange);
    window.matchMedia("(orientation: portrait)").addEventListener?.("change", _onCameraOrientationChange);
}

function capturePhoto() {
    const video = document.getElementById("camera-video");
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const wantsPortrait = window.matchMedia("(orientation: portrait)").matches;

    // Step 1: draw the frame into an upright canvas (rotating if the stream
    // came back in the wrong orientation, e.g. a landscape stream on a
    // portrait device because the browser ignored the constraint hint).
    const oriented = document.createElement("canvas");
    const octx = oriented.getContext("2d");
    if (wantsPortrait && vw > vh) {
        oriented.width = vh;
        oriented.height = vw;
        octx.translate(0, vw);
        octx.rotate(-Math.PI / 2);
        octx.drawImage(video, 0, 0);
    } else if (!wantsPortrait && vh > vw) {
        oriented.width = vh;
        oriented.height = vw;
        octx.translate(vh, 0);
        octx.rotate(Math.PI / 2);
        octx.drawImage(video, 0, 0);
    } else {
        oriented.width = vw;
        oriented.height = vh;
        octx.drawImage(video, 0, 0);
    }

    // Step 2: center-crop to 4:3 (or 3:4 in portrait). Many cameras (e.g. iPhone
    // Continuity Camera) return 16:9 regardless of the aspectRatio hint, so we
    // crop here to make the output ratio deterministic.
    const ow = oriented.width;
    const oh = oriented.height;
    const targetRatio = ow >= oh ? 4 / 3 : 3 / 4;
    const currentRatio = ow / oh;
    let cropW = ow;
    let cropH = oh;
    if (currentRatio > targetRatio) {
        cropW = Math.round(oh * targetRatio);
    } else if (currentRatio < targetRatio) {
        cropH = Math.round(ow / targetRatio);
    }
    const sx = Math.round((ow - cropW) / 2);
    const sy = Math.round((oh - cropH) / 2);

    const canvas = document.createElement("canvas");
    canvas.width = cropW;
    canvas.height = cropH;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(oriented, sx, sy, cropW, cropH, 0, 0, cropW, cropH);

    canvas.toBlob(async (blob) => {
        const problem = getProblemById(studyQueue[studyIndex]);
        const formData = new FormData();
        formData.append("file", blob, "photo.jpg");

        const res = await fetch(`/api/upload/${problem.id}`, {
            method: "POST",
            body: formData
        });
        const result = await res.json();

        if (!progressState.images) progressState.images = {};
        if (!progressState.images[problem.id]) progressState.images[problem.id] = [];
        progressState.images[problem.id].push({
            filename: result.filename,
            uploadedAt: new Date().toISOString()
        });

        closeCamera();
        renderImageGallery(problem.id);
    }, "image/jpeg", 0.9);
}

function closeCamera() {
    const overlay = document.getElementById("camera-overlay");
    if (!overlay) return;
    const video = document.getElementById("camera-video");
    if (video && video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
    }
    window.removeEventListener("orientationchange", _onCameraOrientationChange);
    window.matchMedia("(orientation: portrait)").removeEventListener?.("change", _onCameraOrientationChange);
    _cameraBaseConstraints = null;
    overlay.remove();
}

// ── Lightbox ────────────────────────────────────────────────────
let lightboxImages = [];
let lightboxMeta = [];        // shares object refs with progressState.images[cardId]
let lightboxCardId = null;
let lightboxIndex = 0;
let lightboxZoom = 1;
const LIGHTBOX_ZOOM_MIN = 0.25;
const LIGHTBOX_ZOOM_MAX = 5;
const LIGHTBOX_ZOOM_STEP = 0.25;

function applyLightboxTransform() {
    const imgEl = document.getElementById("lightbox-img");
    if (!imgEl) return;
    const rawRot = (lightboxMeta[lightboxIndex] && lightboxMeta[lightboxIndex].rotation) || 0;
    const r = ((rawRot % 360) + 360) % 360;
    imgEl.style.transform = `rotate(${r}deg) scale(${lightboxZoom})`;
    if (r === 90 || r === 270) {
        imgEl.style.maxWidth = "94vh";
        imgEl.style.maxHeight = "96vw";
    } else {
        imgEl.style.maxWidth = "";
        imgEl.style.maxHeight = "";
    }
}

function openLightbox(cardId, index) {
    const imgs = (progressState.images || {})[cardId] || [];
    if (imgs.length === 0) return;
    lightboxCardId = cardId;
    lightboxMeta = imgs;
    lightboxImages = imgs.map(i => `/uploads/${cardId}/${i.filename}`);
    lightboxIndex = Math.max(0, Math.min(index || 0, lightboxImages.length - 1));
    showLightboxImage();
    document.getElementById("lightbox").classList.add("active");
}

function showLightboxImage() {
    if (!lightboxImages.length) return;
    const imgEl = document.getElementById("lightbox-img");
    imgEl.src = lightboxImages[lightboxIndex];
    lightboxZoom = 1;
    applyLightboxTransform();
    const counter = document.getElementById("lightbox-counter");
    if (counter) {
        counter.textContent = lightboxImages.length > 1
            ? `${lightboxIndex + 1} / ${lightboxImages.length}`
            : "";
    }
    const multi = lightboxImages.length > 1;
    document.querySelector(".lightbox-prev").style.display = multi ? "" : "none";
    document.querySelector(".lightbox-next").style.display = multi ? "" : "none";
}

function lightboxRotate() {
    if (!lightboxImages.length || !lightboxCardId) return;
    const meta = lightboxMeta[lightboxIndex];
    if (meta) rotateImage(lightboxCardId, meta.filename);
}

function lightboxZoomIn() {
    if (!lightboxImages.length) return;
    lightboxZoom = Math.min(LIGHTBOX_ZOOM_MAX, +(lightboxZoom + LIGHTBOX_ZOOM_STEP).toFixed(2));
    applyLightboxTransform();
}

function lightboxZoomOut() {
    if (!lightboxImages.length) return;
    lightboxZoom = Math.max(LIGHTBOX_ZOOM_MIN, +(lightboxZoom - LIGHTBOX_ZOOM_STEP).toFixed(2));
    applyLightboxTransform();
}

function lightboxPrev() {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
    showLightboxImage();
}

function lightboxNext() {
    if (!lightboxImages.length) return;
    lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
    showLightboxImage();
}

function closeLightbox() {
    document.getElementById("lightbox").classList.remove("active");
}

// ── Catalogue ───────────────────────────────────────────────────
async function showCatalogue() {
    await loadState();

    // Populate subcourse filter (hide if only one subcourse)
    const filterEl = document.getElementById("catalogue-filter-subcourse");
    filterEl.innerHTML = '<option value="all">All Subcourses</option>';
    currentCourse.subcourses.forEach(sc => {
        const opt = document.createElement("option");
        opt.value = sc.id;
        opt.textContent = sc.name;
        filterEl.appendChild(opt);
    });
    filterEl.style.display = currentCourse.subcourses.length <= 1 ? "none" : "";

    filterEl.onchange = renderCatalogueTable;
    document.getElementById("catalogue-sort").onchange = renderCatalogueTable;

    renderCatalogueTable();
    showView("catalogue");
}

// ── Add Card ────────────────────────────────────────────────────
// ── Add Course (landing) ────────────────────────────────────────
function openAddCourseForm() {
    const nameEl = document.getElementById("add-course-name");
    const slugEl = document.getElementById("add-course-slug");
    const errEl = document.getElementById("add-course-error");
    nameEl.value = "";
    slugEl.textContent = "—";
    errEl.textContent = "";
    nameEl.oninput = () => {
        const s = slugifyAssignment(nameEl.value);
        slugEl.textContent = s || "—";
    };
    document.getElementById("add-course-modal").style.display = "flex";
    nameEl.focus();
}
function closeAddCourseForm() {
    document.getElementById("add-course-modal").style.display = "none";
}
async function submitAddCourse() {
    const errEl = document.getElementById("add-course-error");
    errEl.textContent = "";
    const name = document.getElementById("add-course-name").value.trim();
    const id = slugifyAssignment(name);
    if (!name || !id) {
        errEl.textContent = "Enter a course name.";
        return;
    }
    const res = await fetch("/api/add-course", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, id })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errEl.textContent = data.error || `Failed (${res.status})`;
        return;
    }
    // Refresh course registry and re-render landing
    const coursesRes = await fetch("/api/courses", { cache: "no-store" });
    const coursesData = await coursesRes.json();
    courses = coursesData.courses || [];
    renderCourseList();
    closeAddCourseForm();
}

function slugifyAssignment(name) {
    return (name || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

function getAddCardSubcourse() {
    // All courses currently have exactly one subcourse. If that ever changes,
    // fall back to the first one.
    return currentCourse.subcourses[0];
}

function populateAddAssignmentDropdown() {
    const sc = getAddCardSubcourse();
    const aSel = document.getElementById("add-assignment");
    aSel.innerHTML = "";
    (sc.assignments || []).forEach(a => {
        const opt = document.createElement("option");
        opt.value = a;
        opt.textContent = a;
        aSel.appendChild(opt);
    });
    const newOpt = document.createElement("option");
    newOpt.value = "__new__";
    newOpt.textContent = "— New assignment —";
    aSel.appendChild(newOpt);
    onAddAssignmentChange();
}

function onAddAssignmentChange() {
    const aSel = document.getElementById("add-assignment");
    const row = document.getElementById("add-new-assignment-row");
    row.style.display = aSel.value === "__new__" ? "" : "none";
    updateAssignmentSlugPreview();
}

function updateAssignmentSlugPreview() {
    const name = document.getElementById("add-new-assignment-name").value;
    const slug = slugifyAssignment(name);
    document.getElementById("add-new-assignment-slug").textContent = slug || "—";
}

function openAddCardForm() {
    populateAddAssignmentDropdown();

    // Reset inputs
    document.getElementById("add-new-assignment-name").value = "";
    document.getElementById("add-new-assignment-name").oninput = updateAssignmentSlugPreview;
    document.getElementById("add-statement").value = "";
    document.getElementById("add-hint").value = "";
    document.getElementById("add-solution-file").value = "";
    document.getElementById("add-card-error").textContent = "";

    document.getElementById("add-card-modal").style.display = "flex";
    document.getElementById("add-statement").focus();
}

function closeAddCardForm() {
    document.getElementById("add-card-modal").style.display = "none";
}

async function pickSolutionFile() {
    try {
        const res = await fetch("/api/pick-file", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.path) {
            document.getElementById("add-solution-file").value = data.path;
        }
    } catch (e) {
        // User likely cancelled; ignore.
    }
}

function clearSolutionFile() {
    document.getElementById("add-solution-file").value = "";
}

async function submitAddCard() {
    const errEl = document.getElementById("add-card-error");
    errEl.textContent = "";

    const subcourseId = getAddCardSubcourse().id;
    const aSel = document.getElementById("add-assignment");
    const isNew = aSel.value === "__new__";
    let assignmentKey;
    let newAssignmentName = null;
    if (isNew) {
        newAssignmentName = document.getElementById("add-new-assignment-name").value.trim();
        assignmentKey = slugifyAssignment(newAssignmentName);
        if (!assignmentKey) {
            errEl.textContent = "Enter a name for the new assignment.";
            return;
        }
    } else {
        assignmentKey = aSel.value;
    }

    const statement = document.getElementById("add-statement").value.trim();
    if (!statement) {
        errEl.textContent = "Statement is required.";
        return;
    }
    const hint = document.getElementById("add-hint").value.trim();
    const solutionFile = document.getElementById("add-solution-file").value.trim();

    const res = await fetch("/api/add-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            subcourseId,
            assignment: assignmentKey,
            isNewAssignment: isNew,
            newAssignmentName,
            statement,
            hint,
            solutionFile: solutionFile || null,
        })
    });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        errEl.textContent = data.error || `Failed (${res.status})`;
        return;
    }

    // Reload problems + courses metadata so the new card appears in the catalogue.
    await reloadCourseData();
    renderCatalogueTable();
    closeAddCardForm();
}

async function reloadCourseData() {
    // Re-fetch courses.json in case a new assignment was appended.
    const coursesRes = await fetch("/api/courses", { cache: "no-store" });
    const coursesData = await coursesRes.json();
    const refreshed = (coursesData.courses || []).find(c => c.id === currentCourse.id);
    if (refreshed) currentCourse = refreshed;

    allProblems = [];
    for (const sc of currentCourse.subcourses) {
        const res = await fetch(`/api/problems/${currentCourse.id}/${sc.id}`, { cache: "no-store" });
        const data = await res.json();
        allProblems = allProblems.concat(data.problems);
    }
}

function renderCatalogueTable() {
    const filter = document.getElementById("catalogue-filter-subcourse").value;
    const sort = document.getElementById("catalogue-sort").value;

    let problems = allProblems;
    if (filter !== "all") {
        problems = problems.filter(p => p._courseId === filter);
    }

    // Sort
    problems = [...problems]; // clone
    problems.sort((a, b) => {
        const ha = (progressState.confidenceHistory || {})[a.id] || [];
        const hb = (progressState.confidenceHistory || {})[b.id] || [];
        const la = ha.length > 0 ? ha[ha.length - 1].rating : -1;
        const lb = hb.length > 0 ? hb[hb.length - 1].rating : -1;

        switch (sort) {
            case "confidence-asc":
                return la - lb;
            case "confidence-desc":
                return lb - la;
            case "unrated":
                if (la === -1 && lb !== -1) return -1;
                if (lb === -1 && la !== -1) return 1;
                return 0;
            default: // source
                return 0; // keep original order
        }
    });

    const container = document.getElementById("catalogue-table");
    const table = document.createElement("table");
    table.className = "cat-table";

    // Header
    const thead = document.createElement("thead");
    thead.innerHTML = `<tr>
        <th>Source</th>
        <th>#</th>
        <th>Problem</th>
        <th>Confidence</th>
        <th>History</th>
        <th></th>
    </tr>`;
    table.appendChild(thead);

    // Body
    const tbody = document.createElement("tbody");
    problems.forEach(p => {
        const tr = document.createElement("tr");
        const history = (progressState.confidenceHistory || {})[p.id] || [];
        const latest = history.length > 0 ? history[history.length - 1].rating : null;

        // Badge color
        let badgeClass = "gray";
        let badgeText = "—";
        if (latest !== null) {
            badgeText = latest;
            if (latest <= 3) badgeClass = "red";
            else if (latest <= 6) badgeClass = "yellow";
            else badgeClass = "green";
        }

        const historyStr = history.map(h => h.rating).join(", ");

        // Truncated statement (plain text, strip LaTeX commands for display)
        const plainStatement = p.statement
            .replace(/\$\$[^$]*\$\$/g, "[equation]")
            .replace(/\$[^$]*\$/g, "[math]")
            .replace(/\\[a-zA-Z]+/g, "")
            .replace(/[{}]/g, "")
            .replace(/\*\*/g, "")
            .substring(0, 100);

        tr.innerHTML = `
            <td>${p._course} ${p._assignment}</td>
            <td>${p.number}</td>
            <td class="cat-statement">${plainStatement}</td>
            <td><span class="badge ${badgeClass}">${badgeText}</span></td>
            <td class="confidence-history">${historyStr || "—"}</td>
            <td class="cat-delete-cell"><button class="cat-delete-btn" title="Delete card" aria-label="Delete card">&times;</button></td>
        `;

        // Click enters catalogue mode: the queue is the full canonical-order
        // list of cards in this course, so left/right arrows flip through the
        // whole catalogue regardless of how the user has sorted the display.
        tr.onclick = () => {
            studyMode = "catalogue";
            studyQueue = allProblems.map(prob => prob.id);
            studyIndex = studyQueue.indexOf(p.id);
            if (studyIndex < 0) studyIndex = 0;
            timerCardIndex = -1;
            showCardFront();
        };

        const delBtn = tr.querySelector(".cat-delete-btn");
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteCard(p);
        };

        tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.innerHTML = "";
    container.appendChild(table);
}

// ── LaTeX Rendering ─────────────────────────────────────────────
function appendWithBold(parent, line) {
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0, m;
    while ((m = re.exec(line)) !== null) {
        if (m.index > last) {
            const s = document.createElement("span");
            s.textContent = line.substring(last, m.index);
            parent.appendChild(s);
        }
        const strong = document.createElement("strong");
        strong.textContent = m[1];
        parent.appendChild(strong);
        last = m.index + m[0].length;
    }
    if (last < line.length) {
        const s = document.createElement("span");
        s.textContent = line.substring(last);
        parent.appendChild(s);
    }
}

function renderLatex(element, text) {
    element.innerHTML = "";

    // First pass: peel off markdown table blocks (lines starting/ending with |
    // around a |---| separator row). Non-table chunks go through the math/bold
    // pipeline below; table cells render recursively via the same pipeline.
    const lines = (text || "").split("\n");
    let buf = [];
    const flushBuf = () => {
        if (buf.length === 0) return;
        renderMathAndBold(element, buf.join("\n"));
        buf = [];
    };

    let i = 0;
    while (i < lines.length) {
        if (isMdTableRow(lines[i]) && i + 1 < lines.length && isMdTableSeparator(lines[i + 1])) {
            while (buf.length && buf[buf.length - 1] === "") buf.pop();
            flushBuf();
            let end = i + 2;
            while (end < lines.length && isMdTableRow(lines[end])) end++;
            element.appendChild(buildMdTable(lines.slice(i, end)));
            i = end;
            if (i < lines.length && lines[i] === "") i++;
            continue;
        }
        buf.push(lines[i]);
        i++;
    }
    flushBuf();
}

function renderMathAndBold(element, text) {
    const parts = splitLatex(text);
    parts.forEach(part => {
        if (part.type === "display") {
            const span = document.createElement("div");
            try {
                katex.render(part.content, span, { displayMode: true, throwOnError: false });
            } catch (e) {
                span.textContent = "$$" + part.content + "$$";
            }
            element.appendChild(span);
        } else if (part.type === "inline") {
            const span = document.createElement("span");
            try {
                katex.render(part.content, span, { displayMode: false, throwOnError: false });
            } catch (e) {
                span.textContent = "$" + part.content + "$";
            }
            element.appendChild(span);
        } else {
            const ls = part.content.split("\n");
            ls.forEach((line, idx) => {
                appendWithBold(element, line);
                if (idx < ls.length - 1) element.appendChild(document.createElement("br"));
            });
        }
    });
}

function isMdTableRow(line) {
    const t = (line || "").trim();
    return t.length >= 2 && t.startsWith("|") && t.endsWith("|") && t.indexOf("|", 1) !== t.length - 1;
}
function isMdTableSeparator(line) {
    if (!isMdTableRow(line)) return false;
    return parseMdRow(line).every(c => /^:?-{1,}:?$/.test(c));
}
function parseMdRow(line) {
    const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
    return t.split("|").map(c => c.trim());
}
function buildMdTable(rows) {
    const sepIdx = rows.findIndex(isMdTableSeparator);
    const headerCells = parseMdRow(rows[0]);
    const bodyRows = rows.slice(sepIdx + 1).map(parseMdRow);

    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const trh = document.createElement("tr");
    headerCells.forEach(c => {
        const th = document.createElement("th");
        renderMathAndBold(th, c);
        trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    bodyRows.forEach(row => {
        const tr = document.createElement("tr");
        row.forEach(c => {
            const td = document.createElement("td");
            renderMathAndBold(td, c);
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
}

function splitLatex(text) {
    const parts = [];
    let i = 0;

    while (i < text.length) {
        // Check for display math $$...$$
        if (text[i] === "$" && text[i + 1] === "$") {
            const end = text.indexOf("$$", i + 2);
            if (end !== -1) {
                parts.push({ type: "display", content: text.substring(i + 2, end) });
                i = end + 2;
                continue;
            }
        }

        // Check for inline math $...$
        if (text[i] === "$") {
            const end = text.indexOf("$", i + 1);
            if (end !== -1) {
                parts.push({ type: "inline", content: text.substring(i + 1, end) });
                i = end + 1;
                continue;
            }
        }

        // Plain text — collect until next $
        const nextDollar = text.indexOf("$", i);
        if (nextDollar === -1) {
            parts.push({ type: "text", content: text.substring(i) });
            break;
        } else {
            parts.push({ type: "text", content: text.substring(i, nextDollar) });
            i = nextDollar;
        }
    }

    return parts;
}

// ── Markdown rendering (for comments) ──────────────────────────
// Protects $...$ and $$...$$ math, parses a small markdown subset
// (headings, lists, bold, italic, inline code), then restores math
// via KaTeX. Stored comment text is never modified.
function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInlineMd(text) {
    // Input: already HTML-escaped text with math placeholders.
    // Output: HTML string with bold/italic/code applied.
    let out = text;
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    out = out.replace(/\*\*([^*]+)\*\*/g, (_, c) => `<strong>${c}</strong>`);
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_, pre, c) => `${pre}<em>${c}</em>`);
    return out;
}

function renderMarkdown(element, text) {
    element.innerHTML = "";
    if (!text) return;

    // 1. Extract math into placeholders so markdown doesn't mangle it.
    // Use Private-Use Area characters as sentinels — they pass through the
    // HTML parser unchanged, unlike U+0000 which gets stripped/replaced.
    const mathStore = [];
    let src = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, c) => {
        const i = mathStore.push({ display: true, content: c }) - 1;
        return `@@MATH${i}@@`;
    });
    src = src.replace(/\$([^\n$]+?)\$/g, (_, c) => {
        const i = mathStore.push({ display: false, content: c }) - 1;
        return `@@MATH${i}@@`;
    });

    // 2. Block-level parse: split on blank lines.
    const blocks = src.split(/\n{2,}/);
    const html = [];
    for (const raw of blocks) {
        const block = raw.replace(/^\n+|\n+$/g, "");
        if (!block) continue;
        const lines = block.split("\n");

        // Heading (single line, starts with #)
        const hMatch = lines.length === 1 && lines[0].match(/^(#{1,6})\s+(.*)$/);
        if (hMatch) {
            const level = hMatch[1].length;
            html.push(`<h${level}>${renderInlineMd(escapeHtml(hMatch[2]))}</h${level}>`);
            continue;
        }

        // Bullet list: every line starts with "- " or "* "
        if (lines.every(l => /^[-*]\s+/.test(l))) {
            const items = lines.map(l => `<li>${renderInlineMd(escapeHtml(l.replace(/^[-*]\s+/, "")))}</li>`);
            html.push(`<ul>${items.join("")}</ul>`);
            continue;
        }

        // Numbered list: every line starts with "N. "
        if (lines.every(l => /^\d+\.\s+/.test(l))) {
            const items = lines.map(l => `<li>${renderInlineMd(escapeHtml(l.replace(/^\d+\.\s+/, "")))}</li>`);
            html.push(`<ol>${items.join("")}</ol>`);
            continue;
        }

        // Paragraph with <br> for single newlines
        const para = lines.map(l => renderInlineMd(escapeHtml(l))).join("<br>");
        html.push(`<p>${para}</p>`);
    }
    element.innerHTML = html.join("");

    // 3. Restore math by walking text nodes and replacing placeholders.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const re = /@@MATH(\d+)@@/g;
    for (const node of textNodes) {
        const txt = node.nodeValue;
        if (!re.test(txt)) continue;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m;
        while ((m = re.exec(txt)) !== null) {
            if (m.index > last) frag.appendChild(document.createTextNode(txt.substring(last, m.index)));
            const entry = mathStore[parseInt(m[1], 10)];
            const span = document.createElement(entry.display ? "div" : "span");
            try {
                katex.render(entry.content, span, { displayMode: entry.display, throwOnError: false });
            } catch (e) {
                span.textContent = (entry.display ? "$$" : "$") + entry.content + (entry.display ? "$$" : "$");
            }
            frag.appendChild(span);
            last = m.index + m[0].length;
        }
        if (last < txt.length) frag.appendChild(document.createTextNode(txt.substring(last)));
        node.parentNode.replaceChild(frag, node);
    }
}

// ── Helpers ─────────────────────────────────────────────────────
function getProblemById(id) {
    return allProblems.find(p => p.id === id);
}

// ── Keyboard Shortcuts ──────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    // Lightbox takes top priority for arrow/escape keys.
    const lightbox = document.getElementById("lightbox");
    if (lightbox && lightbox.classList.contains("active")) {
        if (e.code === "Escape") { e.preventDefault(); closeLightbox(); return; }
        if (e.code === "ArrowLeft") { e.preventDefault(); lightboxPrev(); return; }
        if (e.code === "ArrowRight") { e.preventDefault(); lightboxNext(); return; }
        return;
    }

    // When any modal is open, Escape closes it; swallow everything else so
    // view-level shortcuts don't fire underneath.
    const addCardModal = document.getElementById("add-card-modal");
    const addCourseModal = document.getElementById("add-course-modal");
    const modalOpen =
        (addCardModal && addCardModal.style.display === "flex") ||
        (addCourseModal && addCourseModal.style.display === "flex");
    if (modalOpen) {
        if (e.code === "Escape") {
            e.preventDefault();
            if (addCardModal && addCardModal.style.display === "flex") closeAddCardForm();
            if (addCourseModal && addCourseModal.style.display === "flex") closeAddCourseForm();
        }
        return;
    }

    const activeView = document.querySelector(".view.active");
    if (!activeView) return;
    const viewId = activeView.id;

    // When typing in a textarea / input, let all keys through except Escape
    // (so rating numbers, Space, Enter, arrows work as normal text editing).
    const tag = e.target && e.target.tagName;
    if ((tag === "TEXTAREA" || tag === "INPUT") && e.code !== "Escape") {
        return;
    }

    if (viewId === "view-card-front") {
        if (e.code === "Space" || e.code === "Enter") {
            e.preventDefault();
            flipCard();
        } else if (e.code === "ArrowRight") {
            e.preventDefault();
            skipNext();
        } else if (e.code === "ArrowLeft") {
            e.preventDefault();
            skipPrev();
        } else if (e.code === "Escape") {
            stopTimer();
            showView("course");
            renderProgressSummary();
        }
    } else if (viewId === "view-card-back") {
        // Number keys for quick rating
        if (e.key >= "0" && e.key <= "9" && !e.shiftKey) {
            selectConfidence(parseInt(e.key));
        } else if (e.key === "0" && e.shiftKey) {
            selectConfidence(10);
        } else if (e.code === "Enter" && selectedConfidence !== null) {
            e.preventDefault();
            submitRating();
        } else if (e.code === "Space" || e.code === "Backspace" || e.code === "ArrowLeft") {
            e.preventDefault();
            showCardFront();
        } else if (e.code === "Escape") {
            stopTimer();
            showView("course");
            renderProgressSummary();
        }
    } else if (viewId === "view-catalogue" || viewId === "view-course") {
        if (e.code === "Escape") {
            if (viewId === "view-catalogue") {
                showView("course");
            } else {
                showView("landing");
            }
        }
    }
});

// Card front click to flip
document.getElementById("view-card-front").addEventListener("click", (e) => {
    // Don't flip if clicking on nav, progress, hint area, or the edit UI
    if (e.target.closest(".card-progress")) return;
    if (e.target.closest(".card-nav")) return;
    if (e.target.closest(".card-hint-area")) return;
    if (e.target.closest(".edit-card-btn")) return;
    if (e.target.closest(".card-edit")) return;
    // Also don't flip while the edit panel is open.
    if (document.getElementById("card-edit").style.display === "flex") return;
    flipCard();
});
