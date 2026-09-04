#!/usr/bin/env python3
"""Generate the Hoot & Holler weekly Sudoku and word-search files.

The script is deterministic for an ISO week, uses only Python's standard
library, updates puzzles/current.json, archives the week, records hashes to
avoid accidental repeats, and renders print-ready SVG puzzle/solution files.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import random
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

GRID_SIZE = 15
WORD_COUNT = 14
WORD_COOLDOWN_WEEKS = 8
SUDOKU_CLUES = 36
DIRECTIONS = ((0, 1), (1, 0), (1, 1), (1, -1), (0, -1), (-1, 0), (-1, -1), (-1, 1))


def canonical_hash(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def parse_week(value: str | None) -> tuple[int, int]:
    if not value:
        today = datetime.now(timezone.utc).date()
        iso = today.isocalendar()
        return iso.year, iso.week
    match = re.fullmatch(r"(\d{4})-W(\d{2})", value.upper())
    if not match:
        raise SystemExit("--week must look like 2026-W36")
    year, week = map(int, match.groups())
    date.fromisocalendar(year, week, 1)
    return year, week


def sudoku_solution(rng: random.Random) -> list[list[int]]:
    pattern = lambda row, col: (row * 3 + row // 3 + col) % 9
    bands = rng.sample(range(3), 3)
    stacks = rng.sample(range(3), 3)
    rows = [band * 3 + row for band in bands for row in rng.sample(range(3), 3)]
    cols = [stack * 3 + col for stack in stacks for col in rng.sample(range(3), 3)]
    numbers = rng.sample(range(1, 10), 9)
    return [[numbers[pattern(row, col)] for col in cols] for row in rows]


def sudoku_solution_count(board: list[list[int]], limit: int = 2) -> int:
    count = 0

    def candidates(row: int, col: int) -> set[int]:
        used = set(board[row])
        used.update(board[r][col] for r in range(9))
        br, bc = row - row % 3, col - col % 3
        used.update(board[r][c] for r in range(br, br + 3) for c in range(bc, bc + 3))
        return set(range(1, 10)) - used

    def solve() -> None:
        nonlocal count
        if count >= limit:
            return
        best = None
        best_values: set[int] | None = None
        for row in range(9):
            for col in range(9):
                if board[row][col] == 0:
                    values = candidates(row, col)
                    if not values:
                        return
                    if best_values is None or len(values) < len(best_values):
                        best, best_values = (row, col), values
        if best is None:
            count += 1
            return
        row, col = best
        for value in sorted(best_values or ()):
            board[row][col] = value
            solve()
            board[row][col] = 0

    solve()
    return count


def make_sudoku(rng: random.Random) -> dict[str, object]:
    solution = sudoku_solution(rng)
    puzzle = [row[:] for row in solution]
    cells = list(range(81))
    rng.shuffle(cells)
    for index in cells:
        if sum(value != 0 for row in puzzle for value in row) <= SUDOKU_CLUES:
            break
        row, col = divmod(index, 9)
        saved = puzzle[row][col]
        puzzle[row][col] = 0
        if sudoku_solution_count([line[:] for line in puzzle]) != 1:
            puzzle[row][col] = saved
    clues = sum(value != 0 for row in puzzle for value in row)
    return {"difficulty": "medium", "clues": clues, "puzzle": puzzle, "solution": solution}


def load_words(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    seen: set[str] = set()
    words: list[str] = []
    for item in data:
        raw = item.get("answer", "") if isinstance(item, dict) else str(item)
        word = re.sub(r"[^A-Za-z]", "", raw).upper()
        if 3 <= len(word) <= GRID_SIZE and word not in seen:
            seen.add(word)
            words.append(word)
    if len(words) < WORD_COUNT:
        raise SystemExit(f"Word bank needs at least {WORD_COUNT} usable unique words")
    return words


def place_word(grid: list[list[str]], word: str, rng: random.Random) -> dict[str, object] | None:
    options: list[tuple[int, int, int, int, int]] = []
    for dr, dc in DIRECTIONS:
        for row in range(GRID_SIZE):
            for col in range(GRID_SIZE):
                end_row = row + dr * (len(word) - 1)
                end_col = col + dc * (len(word) - 1)
                if not (0 <= end_row < GRID_SIZE and 0 <= end_col < GRID_SIZE):
                    continue
                overlap = 0
                valid = True
                for i, letter in enumerate(word):
                    current = grid[row + dr * i][col + dc * i]
                    if current and current != letter:
                        valid = False
                        break
                    overlap += current == letter
                if valid:
                    options.append((overlap, row, col, dr, dc))
    if not options:
        return None
    best_overlap = max(option[0] for option in options)
    preferred = [option for option in options if option[0] >= max(0, best_overlap - 1)]
    _, row, col, dr, dc = rng.choice(preferred)
    cells = []
    for i, letter in enumerate(word):
        r, c = row + dr * i, col + dc * i
        grid[r][c] = letter
        cells.append({"row": r, "col": c})
    return {
        "word": word,
        "start_row": row,
        "start_col": col,
        "end_row": cells[-1]["row"],
        "end_col": cells[-1]["col"],
        "direction": [dr, dc],
    }


def make_wordsearch(
    rng: random.Random,
    bank: list[str],
    old_hashes: set[str],
    blocked_words: set[str],
) -> dict[str, object]:
    available_words = [word for word in bank if word not in blocked_words]
    if len(available_words) < WORD_COUNT:
        available_words = bank
    for attempt in range(250):
        selected = rng.sample(available_words, WORD_COUNT)
        selected.sort(key=lambda word: (-len(word), word))
        grid = [["" for _ in range(GRID_SIZE)] for _ in range(GRID_SIZE)]
        placements = []
        for word in selected:
            placed = place_word(grid, word, rng)
            if not placed:
                break
            placements.append(placed)
        if len(placements) != WORD_COUNT:
            continue
        for row in range(GRID_SIZE):
            for col in range(GRID_SIZE):
                if not grid[row][col]:
                    grid[row][col] = rng.choice("ABCDEFGHIJKLMNOPQRSTUVWXYZ")
        result = {
            "rows": GRID_SIZE,
            "cols": GRID_SIZE,
            "grid": ["".join(row) for row in grid],
            "words": sorted(selected),
            "placements": sorted(placements, key=lambda item: str(item["word"])),
        }
        if canonical_hash(result) not in old_hashes:
            return result
    raise SystemExit("Could not create a new word search; enlarge the word bank")


def svg_header(width: int, height: int, title: str) -> list[str]:
    safe = html.escape(title)
    return [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
        f'<title>{safe}</title>',
        '<rect width="100%" height="100%" fill="white"/>',
        '<style>text{font-family:Georgia,serif;fill:#111}.head{font-size:30px;font-weight:700}.sub{font-size:14px}.cell{font:700 18px Arial,sans-serif}.word{font:700 15px Arial,sans-serif}</style>',
        f'<text class="head" x="30" y="42">{safe}</text>',
    ]


def sudoku_svg(sudoku: dict[str, object], issue: str, solution: bool) -> str:
    shown = sudoku["solution"] if solution else sudoku["puzzle"]
    title = f"Sudoku {'Solution' if solution else 'Puzzle'} — {issue}"
    out = svg_header(620, 690, title)
    x0, y0, cell = 40, 90, 60
    out.append(f'<rect x="{x0}" y="{y0}" width="540" height="540" fill="none" stroke="#111" stroke-width="4"/>')
    for i in range(1, 9):
        width = 3 if i % 3 == 0 else 1
        pos = x0 + i * cell
        out.append(f'<line x1="{pos}" y1="{y0}" x2="{pos}" y2="{y0 + 540}" stroke="#111" stroke-width="{width}"/>')
        pos = y0 + i * cell
        out.append(f'<line x1="{x0}" y1="{pos}" x2="{x0 + 540}" y2="{pos}" stroke="#111" stroke-width="{width}"/>')
    for row, line in enumerate(shown):
        for col, value in enumerate(line):
            if value:
                out.append(f'<text class="cell" text-anchor="middle" dominant-baseline="middle" x="{x0 + col * cell + cell / 2}" y="{y0 + row * cell + cell / 2}">{value}</text>')
    out.append('</svg>')
    return "\n".join(out) + "\n"


def wordsearch_svg(wordsearch: dict[str, object], issue: str, solution: bool) -> str:
    title = f"Word Search {'Solution' if solution else 'Puzzle'} — {issue}"
    out = svg_header(820, 910, title)
    x0, y0, cell = 35, 80, 42
    if solution:
        colors = ("#f3d9a3", "#d8e6cb", "#d6e2ed", "#ead2dc")
        for index, item in enumerate(wordsearch["placements"]):
            dr, dc = item["direction"]
            length = len(item["word"])
            start_x = x0 + item["start_col"] * cell + cell / 2
            start_y = y0 + item["start_row"] * cell + cell / 2
            end_x = start_x + dc * (length - 1) * cell
            end_y = start_y + dr * (length - 1) * cell
            out.append(f'<line x1="{start_x}" y1="{start_y}" x2="{end_x}" y2="{end_y}" stroke="{colors[index % len(colors)]}" stroke-width="28" stroke-linecap="round" opacity=".9"/>')
    out.append(f'<rect x="{x0}" y="{y0}" width="{GRID_SIZE * cell}" height="{GRID_SIZE * cell}" fill="none" stroke="#111" stroke-width="3"/>')
    for row, line in enumerate(wordsearch["grid"]):
        for col, letter in enumerate(line):
            out.append(f'<text class="cell" text-anchor="middle" dominant-baseline="middle" x="{x0 + col * cell + cell / 2}" y="{y0 + row * cell + cell / 2}">{letter}</text>')
    words = wordsearch["words"]
    out.append('<text class="sub" x="35" y="740">Find these words (forward, backward, across, down, or diagonal):</text>')
    for index, word in enumerate(words):
        col, row = divmod(index, 5)
        out.append(f'<text class="word" x="{35 + col * 190}" y="{775 + row * 26}">{html.escape(word)}</text>')
    out.append('</svg>')
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--week", help="ISO week such as 2026-W36; defaults to the current UTC week")
    parser.add_argument("--root", type=Path, help="Repository root; defaults to this script's parent repository")
    args = parser.parse_args()

    root = (args.root or Path(__file__).resolve().parents[1]).resolve()
    puzzles = root / "puzzles"
    for legacy_name in ("crossword.svg", "crossword-solution.svg", "crossword_bank.json"):
        legacy_path = puzzles / legacy_name
        if legacy_path.exists():
            legacy_path.unlink()
    year, week = parse_week(args.week)
    iso_week = f"{year}-W{week:02d}"
    monday = date.fromisocalendar(year, week, 1)
    sunday = monday + timedelta(days=6)
    seed = f"HHP-{iso_week}-WORDSEARCH"
    rng = random.Random(seed)

    history_path = puzzles / "history.json"
    if history_path.exists():
        history = json.loads(history_path.read_text(encoding="utf-8"))
    else:
        history = {"weeks": {}, "sudoku_hashes": [], "wordsearch_hashes": []}
    history.setdefault("weeks", {})
    history.setdefault("sudoku_hashes", [])
    history.setdefault("wordsearch_hashes", [])

    current_path = puzzles / "current.json"
    if current_path.exists():
        current_payload = json.loads(current_path.read_text(encoding="utf-8"))
        current_issue = current_payload.get("issue", {}).get("iso_week")
        current_words = current_payload.get("wordsearch", {}).get("words", [])
        if current_issue in history["weeks"] and current_words:
            history["weeks"][current_issue].setdefault("wordsearch_words", current_words)

    existing_week = history["weeks"].get(iso_week, {})
    blocked_wordsearch_hashes = set(history["wordsearch_hashes"])
    blocked_wordsearch_hashes.discard(existing_week.get("wordsearch_hash"))
    previous_weeks = sorted(
        (week_key for week_key in history["weeks"] if week_key < iso_week),
        reverse=True,
    )[:WORD_COOLDOWN_WEEKS]
    blocked_words = {
        str(word)
        for week_key in previous_weeks
        for word in history["weeks"][week_key].get("wordsearch_words", [])
    }

    sudoku = make_sudoku(rng)
    wordsearch = make_wordsearch(
        rng,
        load_words(puzzles / "wordsearch_bank.json"),
        blocked_wordsearch_hashes,
        blocked_words,
    )
    sudoku_hash = canonical_hash(sudoku["puzzle"])
    wordsearch_hash = canonical_hash(wordsearch)

    payload = {
        "schema_version": 2,
        "issue": {
            "iso_week": iso_week,
            "week_start": monday.isoformat(),
            "week_end": sunday.isoformat(),
            "seed": seed,
        },
        "generator_seed": seed,
        "sudoku": sudoku,
        "wordsearch": wordsearch,
    }

    write_json(puzzles / "current.json", payload)
    write_json(puzzles / "archive" / f"{iso_week}.json", payload)
    (puzzles / "sudoku.svg").write_text(sudoku_svg(sudoku, iso_week, False), encoding="utf-8")
    (puzzles / "sudoku-solution.svg").write_text(sudoku_svg(sudoku, iso_week, True), encoding="utf-8")
    (puzzles / "wordsearch.svg").write_text(wordsearch_svg(wordsearch, iso_week, False), encoding="utf-8")
    (puzzles / "wordsearch-solution.svg").write_text(wordsearch_svg(wordsearch, iso_week, True), encoding="utf-8")

    old_week = history["weeks"].get(iso_week, {})
    old_sudoku_hash = old_week.get("sudoku_hash")
    old_wordsearch_hash = old_week.get("wordsearch_hash")
    if old_sudoku_hash in history["sudoku_hashes"]:
        history["sudoku_hashes"].remove(old_sudoku_hash)
    if old_wordsearch_hash in history["wordsearch_hashes"]:
        history["wordsearch_hashes"].remove(old_wordsearch_hash)
    if sudoku_hash not in history["sudoku_hashes"]:
        history["sudoku_hashes"].append(sudoku_hash)
    if wordsearch_hash not in history["wordsearch_hashes"]:
        history["wordsearch_hashes"].append(wordsearch_hash)
    history["weeks"][iso_week] = {
        "week_start": monday.isoformat(),
        "archive": f"archive/{iso_week}.json",
        "sudoku_hash": sudoku_hash,
        "wordsearch_hash": wordsearch_hash,
        "wordsearch_words": wordsearch["words"],
    }
    write_json(history_path, history)
    print(f"Generated {iso_week}: Sudoku + {len(wordsearch['words'])}-word search")


if __name__ == "__main__":
    main()
