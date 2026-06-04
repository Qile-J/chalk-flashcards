#!/usr/bin/env python3
"""
Chalk — a local-first flashcard server. Runs locally on macOS.
Start: python3 server.py
Open:  http://localhost:8000

To add new courses: edit data/courses.json and add assignment JSON files.
No code changes needed here.
"""

import json
import re
import subprocess
import sys
import time
import urllib.parse
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
STATE_FILE = BASE_DIR / "state" / "progress.json"
UPLOADS_DIR = BASE_DIR / "uploads"

# Hostnames the server will answer to. Binding to localhost already keeps the
# socket off the network; this also rejects DNS-rebinding requests that arrive
# with a forged Host header.
ALLOWED_HOSTNAMES = {"localhost", "127.0.0.1", "::1", "[::1]"}


def is_safe_segment(name):
    """True if `name` is a single, traversal-free path segment.

    Rejects empty values, path separators, NUL bytes, and any '..' so a
    user-supplied cardId/filename can't escape its intended directory.
    """
    return bool(name) and not any(c in name for c in ("/", "\\", "\x00")) and ".." not in name


def read_state():
    """Load progress state, creating an empty skeleton if the file is missing.

    The state file is gitignored (it holds personal progress and references to
    uploaded photos), so a fresh clone won't have it — initialize it on first read.
    """
    if not STATE_FILE.exists():
        STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
        write_state({
            "confidenceHistory": {},
            "images": {},
            "firstPassComplete": {},
            "seenCards": {},
            "comments": {},
        })
    with open(STATE_FILE, "r") as f:
        return json.load(f)


def write_state(state):
    """Atomic write to prevent corruption."""
    tmp = STATE_FILE.with_suffix(".tmp")
    with open(tmp, "w") as f:
        json.dump(state, f, indent=2)
    tmp.replace(STATE_FILE)


def sync_first_pass_flags(state):
    """Recompute firstPassComplete for every course from current ratings.

    Why: the flag was previously one-way (set true when all cards rated, never
    reset). Adding a new card to a course whose flag was already true left the
    flag stale, so Study would enter review mode and skip the unrated card.
    Recomputing on every state read makes the flag self-healing.

    Returns True if any flag changed (caller should persist).
    """
    try:
        with open(BASE_DIR / "data" / "courses.json") as f:
            courses = json.load(f)
    except Exception:
        return False

    history = state.get("confidenceHistory", {})
    flags = state.setdefault("firstPassComplete", {})
    changed = False

    for course in courses.get("courses", []):
        course_id = course.get("id")
        if not course_id:
            continue
        any_problem = False
        all_rated = True
        for sc in course.get("subcourses", []):
            data_dir = BASE_DIR / sc.get("dataDir", "")
            if not data_dir.exists():
                continue
            assignments = sc.get("assignments", [])
            seen = set()
            files = []
            for name in assignments:
                f = data_dir / f"{name}.json"
                if f.exists():
                    files.append(f)
                    seen.add(f.name)
            for f in sorted(data_dir.glob("*.json")):
                if f.name not in seen:
                    files.append(f)
            for f in files:
                try:
                    with open(f) as fh:
                        data = json.load(fh)
                except Exception:
                    continue
                for prob in data.get("problems", []):
                    any_problem = True
                    pid = prob.get("id")
                    if not pid or not history.get(pid):
                        all_rated = False
        new_flag = bool(any_problem and all_rated)
        old_flag = bool(flags.get(course_id, False))
        if new_flag != old_flag:
            flags[course_id] = new_flag
            changed = True

    return changed


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    # ── CSRF / DNS-rebinding guards ──────────────────────────────
    # The server runs on localhost, but any web page the user visits can still
    # send requests to it. These checks make sure requests come from the app
    # itself (same origin) and not from a hostile page or a rebound DNS name.

    def _hostname_ok(self):
        host = self.headers.get("Host", "")
        hostname = host.rsplit(":", 1)[0] if ":" in host else host
        return hostname in ALLOWED_HOSTNAMES

    def _same_origin(self):
        """False only when we can positively tell the request is cross-site.

        Modern browsers send `Sec-Fetch-Site` (and `Origin` on POSTs); a hostile
        page's request carries `cross-site`/a foreign Origin. Requests with
        neither header (e.g. the user typing a URL) are allowed through.
        """
        site = self.headers.get("Sec-Fetch-Site")
        if site is not None and site not in ("same-origin", "same-site", "none"):
            return False
        origin = self.headers.get("Origin")
        if origin:
            host = urllib.parse.urlparse(origin).hostname
            if host not in ALLOWED_HOSTNAMES:
                return False
        return True

    def _guard(self, check_origin):
        """Return True if the request may proceed; else send 403 and return False."""
        if not self._hostname_ok():
            self._error(403, "Forbidden host")
            return False
        if check_origin and not self._same_origin():
            self._error(403, "Cross-site request blocked")
            return False
        return True

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # /open-pdf launches a file via macOS `open`, so it must be same-origin.
        if not self._guard(check_origin=path.startswith("/open-pdf/")):
            return

        if path == "/api/courses":
            self._json_response(BASE_DIR / "data" / "courses.json")

        elif path.startswith("/api/problems/"):
            # /api/problems/{courseId}/{subcourseId}
            parts = path.split("/")
            if len(parts) >= 5:
                course_id = parts[3]
                subcourse_id = parts[4]
                self._serve_problems(course_id, subcourse_id)
            else:
                self._error(400, "Bad request")

        elif path == "/api/state":
            state = read_state()
            if sync_first_pass_flags(state):
                write_state(state)
            self._json_data(state)

        elif path.startswith("/api/images/"):
            card_id = path[len("/api/images/"):]
            card_id = urllib.parse.unquote(card_id)
            self._serve_image_list(card_id)

        elif path.startswith("/open-pdf/"):
            # /open-pdf/{subcourseId}/{filename}
            rest = path[len("/open-pdf/"):]
            self._open_pdf(rest)

        else:
            # Serve static files (index.html, app.js, vendor/, uploads/, etc.)
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Every POST mutates state or touches the filesystem — require same origin.
        if not self._guard(check_origin=True):
            return

        if path == "/api/rate":
            self._handle_rate()

        elif path.startswith("/api/upload/"):
            card_id = path[len("/api/upload/"):]
            card_id = urllib.parse.unquote(card_id)
            self._handle_upload(card_id)

        elif path == "/api/seen":
            self._handle_seen()

        elif path == "/api/first-pass-complete":
            self._handle_first_pass_complete()

        elif path == "/api/reset-progress":
            self._handle_reset_progress()

        elif path == "/api/delete-image":
            self._handle_delete_image()

        elif path == "/api/rotate-image":
            self._handle_rotate_image()

        elif path == "/api/clear-all-history":
            self._handle_clear_all_history()

        elif path == "/api/comment":
            self._handle_comment()

        elif path == "/api/edit-card":
            self._handle_edit_card()

        elif path == "/api/add-card":
            self._handle_add_card()

        elif path == "/api/delete-card":
            self._handle_delete_card()

        elif path == "/api/add-course":
            self._handle_add_course()

        elif path == "/api/reorder-courses":
            self._handle_reorder_courses()

        elif path == "/api/pick-file":
            self._handle_pick_file()

        elif path == "/api/open-path":
            self._handle_open_path()

        else:
            self._error(404, "Not found")

    # ── GET handlers ─────────────────────────────────────────────

    def _serve_problems(self, course_id, subcourse_id):
        """Load and merge all assignment JSON files for a subcourse.

        Problems are returned in canonical source order: assignments in the
        order listed in courses.json, then problem number within each file.
        Files not in the assignments list are appended afterwards (alphabetical)
        so nothing is silently dropped.
        """
        with open(BASE_DIR / "data" / "courses.json") as f:
            courses = json.load(f)
        data_dir = None
        assignments_order = []
        for course in courses.get("courses", []):
            if course["id"] == course_id:
                for sc in course.get("subcourses", []):
                    if sc["id"] == subcourse_id:
                        data_dir = BASE_DIR / sc["dataDir"]
                        assignments_order = sc.get("assignments", [])
                        break
                break
        if not data_dir or not data_dir.exists():
            self._error(404, f"No data for {course_id}/{subcourse_id}")
            return

        # Build the ordered list of JSON files to read.
        seen = set()
        ordered_files = []
        for name in assignments_order:
            f = data_dir / f"{name}.json"
            if f.exists():
                ordered_files.append(f)
                seen.add(f.name)
        # Append any files not mentioned in assignments_order (alphabetical).
        for f in sorted(data_dir.glob("*.json")):
            if f.name not in seen:
                ordered_files.append(f)

        all_problems = []
        for f in ordered_files:
            with open(f) as fh:
                data = json.load(fh)
                problems = data.get("problems", [])
                # Sort problems within a file by their `number` field so that
                # the canonical order is deterministic even if the JSON is
                # written out of order.
                problems = sorted(problems, key=lambda p: p.get("number", 0))
                for p in problems:
                    p["_assignment"] = data.get("assignment", "")
                    p["_course"] = data.get("course", "")
                    p["_courseId"] = data.get("courseId", "")
                    p["_parentCourseId"] = data.get("parentCourseId", "")
                    p["_solutionPdf"] = data.get("solutionPdf", "")
                    all_problems.append(p)
        self._json_data({"problems": all_problems})

    def _serve_image_list(self, card_id):
        state = read_state()
        images = state.get("images", {}).get(card_id, [])
        self._json_data({"images": images})

    def _open_pdf(self, rest):
        """Open a PDF in Preview via macOS 'open' command."""
        # rest = subcourseId/filename  e.g. real-analysis/HW3_Sol.pdf
        # But we need to map subcourseId to the actual PDF directory.
        # Load courses.json to find the pdfDir for this subcourse.
        with open(BASE_DIR / "data" / "courses.json") as f:
            courses = json.load(f)

        parts = rest.split("/", 1)
        if len(parts) < 2:
            self._error(400, "Bad request")
            return
        subcourse_id = parts[0]
        filename = urllib.parse.unquote(parts[1])

        if not is_safe_segment(filename):
            self._error(400, "Invalid filename")
            return

        # Find the pdfDir for this subcourse
        # Search all courses and subcourses for a match
        pdf_dir = None
        for course in courses.get("courses", []):
            for sc in course.get("subcourses", []):
                if sc["id"] == subcourse_id:
                    pdf_dir = sc["pdfDir"]
                    break
            if pdf_dir:
                break

        if not pdf_dir:
            self._error(404, f"Unknown subcourse: {subcourse_id}")
            return

        pdf_path = BASE_DIR / pdf_dir / filename
        if not pdf_path.exists():
            self._error(404, f"PDF not found: {pdf_path}")
            return

        subprocess.Popen(["open", str(pdf_path)])
        self._json_data({"status": "ok", "path": str(pdf_path)})

    # ── POST handlers ────────────────────────────────────────────

    def _handle_rate(self):
        body = self._read_body()
        card_id = body.get("cardId")
        rating = body.get("rating")
        if card_id is None or rating is None:
            self._error(400, "cardId and rating required")
            return

        state = read_state()
        if card_id not in state["confidenceHistory"]:
            state["confidenceHistory"][card_id] = []
        state["confidenceHistory"][card_id].append({
            "rating": int(rating),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_seen(self):
        body = self._read_body()
        course_id = body.get("courseId")
        card_id = body.get("cardId")
        if not course_id or not card_id:
            self._error(400, "courseId and cardId required")
            return

        state = read_state()
        if course_id not in state.get("seenCards", {}):
            state.setdefault("seenCards", {})[course_id] = []
        if card_id not in state["seenCards"][course_id]:
            state["seenCards"][course_id].append(card_id)
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_first_pass_complete(self):
        body = self._read_body()
        course_id = body.get("courseId")
        if not course_id:
            self._error(400, "courseId required")
            return

        state = read_state()
        state.setdefault("firstPassComplete", {})[course_id] = True
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_reset_progress(self):
        body = self._read_body()
        course_id = body.get("courseId")
        if not course_id:
            self._error(400, "courseId required")
            return

        state = read_state()
        state.get("firstPassComplete", {}).pop(course_id, None)
        state.get("seenCards", {}).pop(course_id, None)
        # Keep confidence history and images — only reset progress
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_upload(self, card_id):
        if not is_safe_segment(card_id):
            self._error(400, "Invalid cardId")
            return

        content_type = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in content_type:
            self._error(400, "Expected multipart/form-data")
            return

        # Parse boundary
        boundary = content_type.split("boundary=")[1].strip()
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        # Simple multipart parser
        parts = body.split(("--" + boundary).encode())
        file_data = None
        original_filename = "upload.jpg"

        for part in parts:
            if b"Content-Disposition" in part:
                header_end = part.find(b"\r\n\r\n")
                if header_end == -1:
                    continue
                header = part[:header_end].decode("utf-8", errors="replace")
                file_data = part[header_end + 4:]
                # Remove trailing \r\n
                if file_data.endswith(b"\r\n"):
                    file_data = file_data[:-2]

                # Extract filename
                if 'filename="' in header:
                    fn_start = header.index('filename="') + 10
                    fn_end = header.index('"', fn_start)
                    original_filename = header[fn_start:fn_end]
                break

        if not file_data:
            self._error(400, "No file data found")
            return

        # Save file
        card_dir = UPLOADS_DIR / card_id
        card_dir.mkdir(parents=True, exist_ok=True)

        # Sequential naming — use max existing number + 1 so we never
        # collide with a leftover file when an earlier one was deleted.
        ext = Path(original_filename).suffix or ".jpg"
        nums = []
        for f in card_dir.glob("img_*"):
            m = re.match(r"img_(\d+)", f.stem)
            if m:
                nums.append(int(m.group(1)))
        next_num = (max(nums) + 1) if nums else 1
        filename = f"img_{next_num:03d}{ext}"
        filepath = card_dir / filename

        with open(filepath, "wb") as f:
            f.write(file_data)

        # Update state
        state = read_state()
        state.setdefault("images", {}).setdefault(card_id, []).append({
            "filename": filename,
            "uploadedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        })
        write_state(state)
        self._json_data({"status": "ok", "filename": filename})

    def _handle_clear_all_history(self):
        body = self._read_body()
        card_ids = body.get("cardIds", [])
        course_id = body.get("courseId")
        if not course_id:
            self._error(400, "courseId required")
            return

        state = read_state()
        # Clear confidence history for specified cards
        for cid in card_ids:
            state.get("confidenceHistory", {}).pop(cid, None)
        # Clear seen cards and first pass for this course
        state.get("seenCards", {}).pop(course_id, None)
        state.get("firstPassComplete", {}).pop(course_id, None)
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_comment(self):
        body = self._read_body()
        card_id = body.get("cardId")
        text = body.get("text", "")
        if not card_id:
            self._error(400, "cardId required")
            return
        state = read_state()
        state.setdefault("comments", {})[card_id] = text
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_edit_card(self):
        body = self._read_body()
        card_id = body.get("cardId")
        if not card_id:
            self._error(400, "cardId required")
            return
        new_statement = body.get("statement")
        new_hint = body.get("hint")

        # Find which assignment file contains this cardId by scanning
        # every subcourse's dataDir in courses.json.
        with open(BASE_DIR / "data" / "courses.json") as f:
            courses = json.load(f)

        target_file = None
        target_data = None
        target_problem = None
        for course in courses.get("courses", []):
            for sc in course.get("subcourses", []):
                data_dir = BASE_DIR / sc["dataDir"]
                if not data_dir.exists():
                    continue
                for f in data_dir.glob("*.json"):
                    with open(f) as fh:
                        data = json.load(fh)
                    for p in data.get("problems", []):
                        if p.get("id") == card_id:
                            target_file = f
                            target_data = data
                            target_problem = p
                            break
                    if target_problem:
                        break
                if target_problem:
                    break
            if target_problem:
                break

        if target_problem is None:
            self._error(404, f"Card not found: {card_id}")
            return

        if new_statement is not None:
            target_problem["statement"] = new_statement
        if new_hint is not None:
            target_problem["hint"] = new_hint

        tmp = target_file.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(target_data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(target_file)
        self._json_data({"status": "ok"})

    def _handle_add_card(self):
        body = self._read_body()
        subcourse_id = body.get("subcourseId")
        assignment_key = body.get("assignment")
        is_new_assignment = bool(body.get("isNewAssignment"))
        new_assignment_display = body.get("newAssignmentName")
        statement = body.get("statement", "").strip()
        hint = body.get("hint", "").strip()
        solution_file = (body.get("solutionFile") or "").strip() or None

        if not subcourse_id or not assignment_key or not statement:
            self._error(400, "subcourseId, assignment, and statement required")
            return

        courses_path = BASE_DIR / "data" / "courses.json"
        with open(courses_path, encoding="utf-8") as f:
            courses = json.load(f)

        target_course = None
        target_subcourse = None
        for course in courses.get("courses", []):
            for sc in course.get("subcourses", []):
                if sc["id"] == subcourse_id:
                    target_course = course
                    target_subcourse = sc
                    break
            if target_subcourse:
                break

        if not target_subcourse:
            self._error(404, f"Subcourse not found: {subcourse_id}")
            return

        data_dir = BASE_DIR / target_subcourse["dataDir"]
        data_dir.mkdir(parents=True, exist_ok=True)
        file_path = data_dir / f"{assignment_key}.json"
        assignments_order = target_subcourse.setdefault("assignments", [])

        if is_new_assignment:
            if assignment_key in assignments_order or file_path.exists():
                self._error(400, f"Assignment '{assignment_key}' already exists")
                return
            assignment_data = {
                "assignment": new_assignment_display or assignment_key,
                "course": target_course.get("name", ""),
                "courseId": subcourse_id,
                "parentCourseId": target_course["id"],
                "solutionPdf": "",
                "problems": [],
            }
            assignments_order.append(assignment_key)
            tmp = courses_path.with_suffix(".tmp")
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(courses, fh, indent=2, ensure_ascii=False)
                fh.write("\n")
            tmp.replace(courses_path)
        else:
            if not file_path.exists():
                self._error(404, f"Assignment file not found: {assignment_key}")
                return
            with open(file_path, encoding="utf-8") as f:
                assignment_data = json.load(f)

        existing_nums = [p.get("number", 0) for p in assignment_data.get("problems", [])]
        next_num = (max(existing_nums) + 1) if existing_nums else 1
        card_id = f"{subcourse_id}-{assignment_key}-p{next_num}"

        new_problem = {
            "id": card_id,
            "number": next_num,
            "statement": statement,
            "hint": hint,
            "tags": [],
        }
        if solution_file:
            new_problem["solutionFile"] = solution_file

        assignment_data.setdefault("problems", []).append(new_problem)

        tmp = file_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(assignment_data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(file_path)

        self._json_data({"status": "ok", "cardId": card_id})

    def _handle_delete_card(self):
        body = self._read_body()
        card_id = body.get("cardId")
        if not card_id:
            self._error(400, "cardId required")
            return
        if not is_safe_segment(card_id):
            self._error(400, "Invalid cardId")
            return

        with open(BASE_DIR / "data" / "courses.json") as f:
            courses = json.load(f)

        target_file = None
        target_data = None
        for course in courses.get("courses", []):
            for sc in course.get("subcourses", []):
                data_dir = BASE_DIR / sc["dataDir"]
                if not data_dir.exists():
                    continue
                for fpath in data_dir.glob("*.json"):
                    with open(fpath) as fh:
                        data = json.load(fh)
                    problems = data.get("problems", [])
                    if any(p.get("id") == card_id for p in problems):
                        target_file = fpath
                        target_data = data
                        break
                if target_file:
                    break
            if target_file:
                break

        if target_file is None:
            self._error(404, f"Card not found: {card_id}")
            return

        target_data["problems"] = [
            p for p in target_data.get("problems", []) if p.get("id") != card_id
        ]

        tmp = target_file.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(target_data, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(target_file)

        # Clean up progress state for this card.
        state = read_state()
        state.get("confidenceHistory", {}).pop(card_id, None)
        state.get("comments", {}).pop(card_id, None)
        state.get("images", {}).pop(card_id, None)
        for cid, ids in state.get("seenCards", {}).items():
            state["seenCards"][cid] = [x for x in ids if x != card_id]
        write_state(state)

        # Delete uploaded image directory for this card, if any.
        card_uploads = UPLOADS_DIR / card_id
        if card_uploads.exists() and card_uploads.is_dir():
            for f in card_uploads.iterdir():
                if f.is_file():
                    f.unlink()
            card_uploads.rmdir()

        self._json_data({"status": "ok"})

    def _handle_add_course(self):
        body = self._read_body()
        name = (body.get("name") or "").strip()
        course_id = (body.get("id") or "").strip()
        if not name:
            self._error(400, "name required")
            return
        if not course_id:
            self._error(400, "id required")
            return

        courses_path = BASE_DIR / "data" / "courses.json"
        with open(courses_path, encoding="utf-8") as f:
            courses = json.load(f)

        if any(c.get("id") == course_id for c in courses.get("courses", [])):
            self._error(400, f"Course '{course_id}' already exists")
            return

        data_dir_rel = f"data/{course_id}/{course_id}"
        pdf_dir_rel = f"Course Materials/{name}"
        (BASE_DIR / data_dir_rel).mkdir(parents=True, exist_ok=True)
        (BASE_DIR / pdf_dir_rel).mkdir(parents=True, exist_ok=True)

        new_course = {
            "id": course_id,
            "name": name,
            "subcourses": [{
                "id": course_id,
                "name": name,
                "dataDir": data_dir_rel,
                "pdfDir": pdf_dir_rel,
                "assignments": [],
            }],
        }
        courses.setdefault("courses", []).append(new_course)

        tmp = courses_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(courses, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(courses_path)

        self._json_data({"status": "ok", "id": course_id})

    def _handle_reorder_courses(self):
        body = self._read_body()
        order = body.get("order")
        if not isinstance(order, list) or not all(isinstance(x, str) for x in order):
            self._error(400, "order must be a list of course IDs")
            return

        courses_path = BASE_DIR / "data" / "courses.json"
        with open(courses_path, encoding="utf-8") as f:
            courses = json.load(f)

        existing = courses.get("courses", [])
        existing_ids = [c.get("id") for c in existing]
        if sorted(existing_ids) != sorted(order):
            self._error(400, "order must contain exactly the existing course IDs")
            return

        by_id = {c.get("id"): c for c in existing}
        courses["courses"] = [by_id[cid] for cid in order]

        tmp = courses_path.with_suffix(".tmp")
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(courses, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        tmp.replace(courses_path)

        self._json_data({"status": "ok", "courses": courses["courses"]})

    def _handle_pick_file(self):
        """Show macOS native file picker via osascript. Returns null on cancel."""
        try:
            result = subprocess.run(
                ["osascript", "-e",
                 'POSIX path of (choose file with prompt "Select solution file")'],
                capture_output=True, text=True, timeout=600
            )
        except Exception as e:
            self._error(500, f"File picker failed: {e}")
            return
        path = (result.stdout or "").strip()
        if result.returncode != 0 or not path:
            self._json_data({"path": None})
            return
        self._json_data({"path": path})

    def _handle_open_path(self):
        body = self._read_body()
        raw = body.get("path")
        if not raw:
            self._error(400, "path required")
            return
        p = Path(raw)
        if not p.is_absolute():
            p = BASE_DIR / raw
        if not p.exists():
            self._error(404, f"Path does not exist: {p}")
            return
        subprocess.Popen(["open", str(p)])
        self._json_data({"status": "ok", "path": str(p)})

    def _handle_delete_image(self):
        body = self._read_body()
        card_id = body.get("cardId")
        filename = body.get("filename")
        if not card_id or not filename:
            self._error(400, "cardId and filename required")
            return
        if not is_safe_segment(card_id) or not is_safe_segment(filename):
            self._error(400, "Invalid cardId or filename")
            return

        # Delete the file
        filepath = UPLOADS_DIR / card_id / filename
        if filepath.exists():
            filepath.unlink()

        # Update state
        state = read_state()
        images = state.get("images", {}).get(card_id, [])
        state["images"][card_id] = [img for img in images if img["filename"] != filename]
        write_state(state)
        self._json_data({"status": "ok"})

    def _handle_rotate_image(self):
        body = self._read_body()
        card_id = body.get("cardId")
        filename = body.get("filename")
        if not card_id or not filename:
            self._error(400, "cardId and filename required")
            return

        state = read_state()
        images = state.get("images", {}).get(card_id, [])
        rotation = None
        for img in images:
            if img.get("filename") == filename:
                rotation = ((img.get("rotation") or 0) + 90) % 360
                img["rotation"] = rotation
                break
        if rotation is None:
            self._error(404, f"image not found: {filename}")
            return
        write_state(state)
        self._json_data({"status": "ok", "rotation": rotation})

    # ── Helpers ──────────────────────────────────────────────────

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        return json.loads(body)

    def _json_response(self, filepath):
        """Serve a JSON file directly."""
        self._json_file_response(filepath)

    def _json_file_response(self, filepath):
        with open(filepath, "r") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Length", len(data.encode()))
        self.end_headers()
        self.wfile.write(data.encode())

    def _json_data(self, data):
        body = json.dumps(data)
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Length", len(body.encode()))
        self.end_headers()
        self.wfile.write(body.encode())

    def _error(self, code, msg):
        body = json.dumps({"error": msg})
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(body.encode()))
        self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, format, *args):
        # Quieter logging — only show errors and POST requests
        if args and (str(args[1]).startswith("4") or str(args[1]).startswith("5") or "POST" in str(args[0])):
            super().log_message(format, *args)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = HTTPServer(("localhost", port), Handler)
    print(f"Chalk server running at http://localhost:{port}")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.server_close()
