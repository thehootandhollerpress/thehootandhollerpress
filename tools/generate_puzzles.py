#!/usr/bin/env python3
"""Generate the Hoot & Holler Press weekly Sudoku and crossword.

No third-party packages are required. The current ISO week is used as the
seed, so a given issue is reproducible. Once generated, the issue is archived
and reused on later runs. Hash history prevents accidental puzzle repeats.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import random
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

GRID_SIZE = 19
CROSSWORD_TARGET_WORDS = 13
CROSSWORD_MIN_WORDS = 10


def stable_int(text: str) -> int:
    return int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")


def sha256_json(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def iso_issue(target: date) -> dict[str, str]:
    iso_year, iso_week, _ = target.isocalendar()
    monday = target - timedelta(days=target.weekday())
    sunday = monday + timedelta(days=6)
    return {
        "iso_week": f"{iso_year}-W{iso_week:02d}",
        "week_start": monday.isoformat(),
        "week_end": sunday.isoformat(),
        "seed": f"HHP-{iso_year}-W{iso_week:02d}",
    }


# ------------------------------- Sudoku ----------------------------------

def shuffled(rng: random.Random, seq):
    seq = list(seq)
    rng.shuffle(seq)
    return seq


def sudoku_solution(seed: str) -> list[list[int]]:
    rng = random.Random(stable_int(seed))
    base, side = 3, 9

    def pattern(r: int, c: int) -> int:
        return (base * (r % base) + r // base + c) % side

    row_groups = shuffled(rng, range(base))
    col_groups = shuffled(rng, range(base))
    rows = [g * base + r for g in row_groups for r in shuffled(rng, range(base))]
    cols = [g * base + c for g in col_groups for c in shuffled(rng, range(base))]
    nums = shuffled(rng, range(1, side + 1))
    return [[nums[pattern(r, c)] for c in cols] for r in rows]


def count_sudoku_solutions(board: list[list[int]], limit: int = 2) -> int:
    rows = [set() for _ in range(9)]
    cols = [set() for _ in range(9)]
    boxes = [set() for _ in range(9)]
    empties: set[tuple[int, int]] = set()

    for r in range(9):
        for c in range(9):
            v = board[r][c]
            if v:
                rows[r].add(v)
                cols[c].add(v)
                boxes[(r // 3) * 3 + c // 3].add(v)
            else:
                empties.add((r, c))

    total = 0

    def solve() -> None:
        nonlocal total
        if total >= limit:
            return
        if not empties:
            total += 1
            return

        best = None
        best_choices = None
        for r, c in empties:
            choices = set(range(1, 10)) - rows[r] - cols[c] - boxes[(r // 3) * 3 + c // 3]
            if not choices:
                return
            if best_choices is None or len(choices) < len(best_choices):
                best = (r, c)
                best_choices = choices
                if len(choices) == 1:
                    break

        assert best is not None and best_choices is not None
        r, c = best
        b = (r // 3) * 3 + c // 3
        empties.remove((r, c))
        for v in sorted(best_choices):
            rows[r].add(v); cols[c].add(v); boxes[b].add(v)
            board[r][c] = v
            solve()
            board[r][c] = 0
            rows[r].remove(v); cols[c].remove(v); boxes[b].remove(v)
            if total >= limit:
                break
        empties.add((r, c))

    solve()
    return total


def generate_sudoku(seed: str, difficulty: str = "medium") -> dict[str, Any]:
    rng = random.Random(stable_int(seed + "-remove"))
    solution = sudoku_solution(seed + "-solution")
    puzzle = copy.deepcopy(solution)
    target_clues = {"easy": 42, "medium": 36, "hard": 31}.get(difficulty, 36)
    cells = [(r, c) for r in range(9) for c in range(9)]
    rng.shuffle(cells)
    clues = 81

    for r, c in cells:
        if clues <= target_clues:
            break
        old = puzzle[r][c]
        puzzle[r][c] = 0
        test = copy.deepcopy(puzzle)
        if count_sudoku_solutions(test, 2) == 1:
            clues -= 1
        else:
            puzzle[r][c] = old

    return {
        "difficulty": difficulty,
        "clues": clues,
        "puzzle": puzzle,
        "solution": solution,
    }


# ------------------------------ Crossword --------------------------------

def normalize_word(text: str) -> str:
    return re.sub(r"[^A-Z]", "", str(text).upper())


def load_crossword_bank(path: Path) -> list[dict[str, str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    out = []
    seen = set()
    for item in data:
        answer = normalize_word(item.get("answer", ""))
        clue = str(item.get("clue", "")).strip()
        if 3 <= len(answer) <= 13 and clue and answer not in seen:
            seen.add(answer)
            out.append({"answer": answer, "clue": clue})
    if len(out) < 30:
        raise RuntimeError("Crossword bank is too small.")
    return out


def empty_grid(size: int = GRID_SIZE):
    return [[None for _ in range(size)] for _ in range(size)], [[set() for _ in range(size)] for _ in range(size)]


def can_place(grid, dirs, word: str, row: int, col: int, direction: str, require_cross: bool = True):
    size = len(grid)
    dr, dc = (0, 1) if direction == "across" else (1, 0)
    end_r = row + dr * (len(word) - 1)
    end_c = col + dc * (len(word) - 1)
    if row < 0 or col < 0 or end_r >= size or end_c >= size:
        return None

    before = (row - dr, col - dc)
    after = (end_r + dr, end_c + dc)
    for rr, cc in (before, after):
        if 0 <= rr < size and 0 <= cc < size and grid[rr][cc] is not None:
            return None

    crosses = 0
    for i, ch in enumerate(word):
        r, c = row + dr * i, col + dc * i
        existing = grid[r][c]
        if existing is not None:
            if existing != ch or direction in dirs[r][c]:
                return None
            crosses += 1
        else:
            if direction == "across":
                for rr in (r - 1, r + 1):
                    if 0 <= rr < size and grid[rr][c] is not None:
                        return None
            else:
                for cc in (c - 1, c + 1):
                    if 0 <= cc < size and grid[r][cc] is not None:
                        return None

    if require_cross and crosses == 0:
        return None
    return crosses


def place_word(grid, dirs, item, row, col, direction):
    word = item["answer"]
    dr, dc = (0, 1) if direction == "across" else (1, 0)
    for i, ch in enumerate(word):
        r, c = row + dr * i, col + dc * i
        grid[r][c] = ch
        dirs[r][c].add(direction)
    return {
        "answer": word,
        "clue": item["clue"],
        "row": row,
        "col": col,
        "direction": direction,
    }


def find_crossword_candidates(grid, dirs, item, rng: random.Random):
    word = item["answer"]
    size = len(grid)
    center = (size - 1) / 2
    existing_by_letter: dict[str, list[tuple[int, int]]] = {}
    for r in range(size):
        for c in range(size):
            if grid[r][c] is not None:
                existing_by_letter.setdefault(grid[r][c], []).append((r, c))

    candidates = []
    for i, ch in enumerate(word):
        for xr, xc in existing_by_letter.get(ch, []):
            for direction in ("across", "down"):
                dr, dc = (0, 1) if direction == "across" else (1, 0)
                row, col = xr - dr * i, xc - dc * i
                crosses = can_place(grid, dirs, word, row, col, direction, True)
                if crosses is None:
                    continue
                end_r = row + dr * (len(word) - 1)
                end_c = col + dc * (len(word) - 1)
                mid_r = (row + end_r) / 2
                mid_c = (col + end_c) / 2
                centrality = abs(mid_r - center) + abs(mid_c - center)
                jitter = rng.random() * 2
                score = crosses * 100 - centrality + jitter
                candidates.append((score, row, col, direction))
    candidates.sort(reverse=True)
    return candidates


def build_crossword_once(bank, seed: str):
    rng = random.Random(stable_int(seed))
    grid, dirs = empty_grid()

    sample_count = min(70, len(bank))
    selected = rng.sample(bank, sample_count)
    # Long-ish first answer gives the rest more crossing opportunities.
    selected.sort(key=lambda x: (len(x["answer"]) + rng.random() * 2), reverse=True)
    first = selected.pop(0)
    row = GRID_SIZE // 2
    col = (GRID_SIZE - len(first["answer"])) // 2
    placed = [place_word(grid, dirs, first, row, col, "across")]

    # Multiple passes let later placements create opportunities for words skipped earlier.
    for _pass in range(4):
        progress = False
        rng.shuffle(selected)
        for item in list(selected):
            if len(placed) >= CROSSWORD_TARGET_WORDS:
                break
            candidates = find_crossword_candidates(grid, dirs, item, rng)
            if not candidates:
                continue
            # Choose among the best few to maintain week-to-week variety.
            best_slice = candidates[: min(4, len(candidates))]
            _, r, c, direction = rng.choice(best_slice)
            placed.append(place_word(grid, dirs, item, r, c, direction))
            selected.remove(item)
            progress = True
        if len(placed) >= CROSSWORD_TARGET_WORDS or not progress:
            break

    if len(placed) < CROSSWORD_MIN_WORDS:
        return None

    used = [(r, c) for r in range(GRID_SIZE) for c in range(GRID_SIZE) if grid[r][c] is not None]
    min_r = min(r for r, _ in used)
    max_r = max(r for r, _ in used)
    min_c = min(c for _, c in used)
    max_c = max(c for _, c in used)

    trimmed = []
    for r in range(min_r, max_r + 1):
        trimmed.append([grid[r][c] if grid[r][c] is not None else "#" for c in range(min_c, max_c + 1)])

    # Normalize placed coordinates into the trimmed grid.
    for p in placed:
        p["row"] -= min_r
        p["col"] -= min_c

    starts = sorted({(p["row"], p["col"]) for p in placed})
    number_map = {pos: i + 1 for i, pos in enumerate(starts)}
    across, down = [], []
    for p in placed:
        clue = {
            "number": number_map[(p["row"], p["col"])],
            "clue": p["clue"],
            "answer": p["answer"],
            "row": p["row"],
            "col": p["col"],
            "length": len(p["answer"]),
        }
        (across if p["direction"] == "across" else down).append(clue)
    across.sort(key=lambda x: x["number"])
    down.sort(key=lambda x: x["number"])

    numbers = [
        {"row": r, "col": c, "number": number_map[(r, c)]}
        for r, c in starts
    ]
    return {
        "rows": len(trimmed),
        "cols": len(trimmed[0]),
        "grid": ["".join(row) for row in trimmed],
        "numbers": numbers,
        "across": across,
        "down": down,
        "word_count": len(placed),
    }


def generate_crossword(bank, seed: str):
    for attempt in range(100):
        result = build_crossword_once(bank, f"{seed}-{attempt}")
        if result is not None:
            return result
    raise RuntimeError("Could not build a crossword with enough connected answers.")


# ------------------------------- SVG -------------------------------------

def sudoku_svg(sudoku: dict[str, Any], solved: bool = False) -> str:
    board = sudoku["solution"] if solved else sudoku["puzzle"]
    solution = sudoku["solution"]
    cell = 60
    size = cell * 9
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img">', '<rect width="100%" height="100%" fill="white"/>']
    for i in range(10):
        w = 4 if i % 3 == 0 else 1.4
        p = i * cell
        parts.append(f'<line x1="{p}" y1="0" x2="{p}" y2="{size}" stroke="#111" stroke-width="{w}"/>')
        parts.append(f'<line x1="0" y1="{p}" x2="{size}" y2="{p}" stroke="#111" stroke-width="{w}"/>')
    for r in range(9):
        for c in range(9):
            v = board[r][c]
            if not v:
                continue
            weight = 700 if sudoku["puzzle"][r][c] else 400
            parts.append(
                f'<text x="{c*cell+cell/2}" y="{r*cell+cell*0.68}" text-anchor="middle" '
                f'font-family="Arial,sans-serif" font-size="32" font-weight="{weight}" fill="#111">{solution[r][c] if solved else v}</text>'
            )
    parts.append('</svg>')
    return "".join(parts)


def crossword_svg(crossword: dict[str, Any], solved: bool = False) -> str:
    cell = 34
    rows, cols = crossword["rows"], crossword["cols"]
    width, height = cols * cell, rows * cell
    num_map = {(n["row"], n["col"]): n["number"] for n in crossword["numbers"]}
    solution = [list(row) for row in crossword["grid"]]
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img">', '<rect width="100%" height="100%" fill="white"/>']
    for r in range(rows):
        for c in range(cols):
            x, y = c * cell, r * cell
            ch = solution[r][c]
            if ch == "#":
                parts.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="#111"/>')
                continue
            parts.append(f'<rect x="{x}" y="{y}" width="{cell}" height="{cell}" fill="white" stroke="#111" stroke-width="1"/>')
            if (r, c) in num_map:
                parts.append(f'<text x="{x+3}" y="{y+9}" font-family="Arial,sans-serif" font-size="8" fill="#111">{num_map[(r,c)]}</text>')
            if solved:
                parts.append(f'<text x="{x+cell/2}" y="{y+cell*0.72}" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="600" fill="#111">{ch}</text>')
    parts.append('</svg>')
    return "".join(parts)


# ------------------------------- Output ----------------------------------

def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1], help="Website repository root")
    parser.add_argument("--date", help="Generate the ISO week containing YYYY-MM-DD")
    parser.add_argument("--difficulty", choices=["easy", "medium", "hard"], default="medium")
    args = parser.parse_args()

    root = args.root.resolve()
    puzzles_dir = root / "puzzles"
    archive_dir = puzzles_dir / "archive"
    archive_dir.mkdir(parents=True, exist_ok=True)
    target = date.fromisoformat(args.date) if args.date else datetime.now(timezone.utc).date()
    issue = iso_issue(target)
    archive_path = archive_dir / f'{issue["iso_week"]}.json'
    current_path = puzzles_dir / "current.json"
    history_path = puzzles_dir / "history.json"

    # Once an issue exists, never silently regenerate it. This keeps the website
    # and desktop newspaper builder pinned to exactly the same weekly puzzle.
    if archive_path.exists():
        payload = json.loads(archive_path.read_text(encoding="utf-8"))
        write_json(current_path, payload)
        print(f'Reused archived issue {issue["iso_week"]}.')
        return 0

    history = {"weeks": {}, "sudoku_hashes": [], "crossword_hashes": []}
    if history_path.exists():
        try:
            history.update(json.loads(history_path.read_text(encoding="utf-8")))
        except Exception:
            pass
    history.setdefault("weeks", {})
    history.setdefault("sudoku_hashes", [])
    history.setdefault("crossword_hashes", [])

    bank = load_crossword_bank(puzzles_dir / "crossword_bank.json")
    chosen = None
    for attempt in range(80):
        suffix = "" if attempt == 0 else f"-R{attempt}"
        weekly_seed = issue["seed"] + suffix
        sudoku = generate_sudoku(weekly_seed + "-SUDOKU", args.difficulty)
        crossword = generate_crossword(bank, weekly_seed + "-CROSSWORD")
        sudoku_hash = sha256_json(sudoku["puzzle"])
        crossword_hash = sha256_json({"grid": crossword["grid"], "across": [x["answer"] for x in crossword["across"]], "down": [x["answer"] for x in crossword["down"]]})
        if sudoku_hash in history["sudoku_hashes"] or crossword_hash in history["crossword_hashes"]:
            continue
        chosen = (weekly_seed, sudoku, crossword, sudoku_hash, crossword_hash)
        break
    if chosen is None:
        raise RuntimeError("Unable to find a non-duplicate weekly puzzle set.")

    weekly_seed, sudoku, crossword, sudoku_hash, crossword_hash = chosen
    payload = {
        "schema_version": 1,
        "issue": issue,
        "generator_seed": weekly_seed,
        "sudoku": sudoku,
        "crossword": crossword,
    }

    write_json(archive_path, payload)
    write_json(current_path, payload)

    history["weeks"][issue["iso_week"]] = {
        "week_start": issue["week_start"],
        "archive": f'archive/{issue["iso_week"]}.json',
        "sudoku_hash": sudoku_hash,
        "crossword_hash": crossword_hash,
    }
    history["sudoku_hashes"].append(sudoku_hash)
    history["crossword_hashes"].append(crossword_hash)
    write_json(history_path, history)

    (puzzles_dir / "sudoku.svg").write_text(sudoku_svg(sudoku, False), encoding="utf-8")
    (puzzles_dir / "sudoku-solution.svg").write_text(sudoku_svg(sudoku, True), encoding="utf-8")
    (puzzles_dir / "crossword.svg").write_text(crossword_svg(crossword, False), encoding="utf-8")
    (puzzles_dir / "crossword-solution.svg").write_text(crossword_svg(crossword, True), encoding="utf-8")

    print(f'Generated {issue["iso_week"]}: Sudoku {sudoku["clues"]} clues; crossword {crossword["word_count"]} words.')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
