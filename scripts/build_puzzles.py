"""Отбор задач из базы Lichess (lichess_db_puzzle.csv.zst) в три файла public/puzzles/c1..c3.json.

Запуск: python scripts/build_puzzles.py [входной.csv.zst] [выходная_папка]
"""
import csv
import io
import json
import os
import re
import sys
from collections import defaultdict

import zstandard

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANDS = {1: (400, 900), 2: (900, 1300), 3: (1300, 1700)}  # [low, high), в круге 3 high включается
CAPS = {1: 4000, 2: 2300, 3: 1800}
BIN = 50
MIN_POPULARITY, MIN_PLAYS, MAX_DEVIATION = 85, 500, 90


def load_themes():
    src = open(os.path.join(ROOT, 'src', 'content', 'themes.ts'), encoding='utf-8').read()
    found = re.findall(r"id: '(\w+)', title: '[^']*', firstCircle: ([123])", src)
    return [(i, int(c)) for i, c in found]


def circle_of(rating):
    if 400 <= rating < 900:
        return 1
    if 900 <= rating < 1300:
        return 2
    if 1300 <= rating <= 1700:
        return 3
    return None


def read_candidates(path, allowed):
    """Возвращает {id: (fen, moves, rating, [темы из THEMES], popularity, plays)} и счётчик меток."""
    puzzles = {}
    seen_tags = defaultdict(int)
    with open(path, 'rb') as f:
        stream = zstandard.ZstdDecompressor().stream_reader(f)
        reader = csv.DictReader(io.TextIOWrapper(stream, encoding='utf-8', newline=''))
        for row in reader:
            for t in row['Themes'].split():
                seen_tags[t] += 1
            if (int(row['Popularity']) < MIN_POPULARITY or int(row['NbPlays']) < MIN_PLAYS
                    or int(row['RatingDeviation']) > MAX_DEVIATION):
                continue
            rating = int(row['Rating'])
            if circle_of(rating) is None:
                continue
            themes = [t for t in row['Themes'].split() if t in allowed]
            if not themes:
                continue
            puzzles[row['PuzzleId']] = (row['FEN'], row['Moves'], rating, themes,
                                        int(row['Popularity']), int(row['NbPlays']))
    return puzzles, seen_tags


def pick_for_theme(cands, lo, hi, cap, chosen):
    """cands: [(id, rating, pop, plays)] темы в коридоре. Выбор равномерно по корзинам по 50 пунктов.
    Уже выбранные для круга задачи (chosen) считаются в лимит темы."""
    already = [c for c in cands if c[0] in chosen]
    budget = cap - len(already)
    if budget <= 0:
        return
    bins = defaultdict(list)
    for c in cands:
        if c[0] not in chosen:
            bins[(c[1] - lo) // BIN].append(c)
    for b in bins.values():
        b.sort(key=lambda c: (-c[2], -c[3], c[0]))
    keys = sorted(bins)
    taken = {k: 0 for k in keys}
    while budget > 0:
        open_keys = [k for k in keys if taken[k] < len(bins[k])]
        if not open_keys:
            break
        share = max(budget // len(open_keys), 1)
        for k in open_keys:
            n = min(share, len(bins[k]) - taken[k], budget)
            taken[k] += n
            budget -= n
            if budget == 0:
                break
    for k in keys:
        for c in bins[k][:taken[k]]:
            chosen.add(c[0])


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    inp = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'data', 'lichess_db_puzzle.csv.zst')
    out = sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, 'public', 'puzzles')
    themes = load_themes()
    allowed = {t for t, _ in themes}
    puzzles, seen = read_candidates(inp, allowed)
    missing = sorted(t for t in allowed if t not in seen)
    if missing:
        print('ВНИМАНИЕ: меток нет в базе:', ', '.join(missing))
    os.makedirs(out, exist_ok=True)
    table, sizes = [], {}
    for circle, (lo, hi) in BANDS.items():
        by_theme = defaultdict(list)
        for pid, (_, _, rating, ths, pop, plays) in puzzles.items():
            if circle_of(rating) != circle:
                continue
            for t in ths:
                by_theme[t].append((pid, rating, pop, plays))
        chosen = set()
        circle_themes = [t for t, fc in themes if fc <= circle]
        for t in circle_themes:
            pick_for_theme(by_theme[t], lo, hi, CAPS[circle], chosen)
        rows = sorted(chosen, key=lambda p: (puzzles[p][2], p))
        data = []
        for pid in rows:
            fen, moves, rating, ths, _, _ = puzzles[pid]
            data.append([pid, fen, moves, rating, ' '.join(ths)])
        for t in circle_themes:
            table.append((circle, t, sum(1 for r in data if t in r[4].split())))
        path = os.path.join(out, f'c{circle}.json')
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        sizes[path] = (os.path.getsize(path), len(data))
    print('круг\tтема\tзадач')
    for circle, t, n in table:
        print(f'{circle}\t{t}\t{n}' + ('\t<300!' if n < 300 else ''))
    total = 0
    for path, (size, n) in sizes.items():
        total += size
        print(f'{os.path.basename(path)}: {n} задач, {size / 1e6:.2f} МБ')
    print(f'всего задач: {sum(n for _, n in sizes.values())}, {total / 1e6:.2f} МБ')


if __name__ == '__main__':
    main()
