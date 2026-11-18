import type { Score, Side } from '../domain/gameTypes';
import { CONFIG } from './config';
import { expected } from './score';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Точность хода по изменению вероятности выигрыша ходящего (0..100). */
export function moveAccuracyWin(winBefore: number, winAfter: number): number {
  if (winAfter >= winBefore) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * CONFIG.ACC_LOSS_SCALE * (winBefore - winAfter))
    - 3.166924740191411 + 1;
  return clamp(raw, 0, 100);
}

const stdDev = (xs: number[]): number => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
};

/** Точность стороны за партию; null, если у стороны нет ходов. scores — как в GameAnalysis (белая точка зрения). */
export function gameAccuracy(scores: Score[], side: Side): number | null {
  const plies = scores.length - 1;
  const win = scores.map((s) => 100 * expected(s, 'white'));
  const w = clamp(Math.floor(plies / 10), CONFIG.ACC_WINDOW_MIN, CONFIG.ACC_WINDOW_MAX);
  // окна: w − 2 копии первого окна, затем все скользящие; вес ход i — окно i
  const windows: number[][] = Array.from({ length: w - 2 }, () => win.slice(0, w));
  for (let s = 0; s + w <= win.length; s++) windows.push(win.slice(s, s + w));

  const accs: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < plies; i++) {
    if ((i % 2 === 0 ? 'white' : 'black') !== side) continue;
    const before = side === 'white' ? win[i] : 100 - win[i];
    const after = side === 'white' ? win[i + 1] : 100 - win[i + 1];
    accs.push(moveAccuracyWin(before, after));
    weights.push(clamp(stdDev(windows[Math.min(i, windows.length - 1)]), CONFIG.ACC_WEIGHT_MIN, CONFIG.ACC_WEIGHT_MAX));
  }
  if (accs.length === 0) return null;
  const weighted = accs.reduce((s, a, k) => s + a * weights[k], 0) / weights.reduce((s, x) => s + x, 0);
  // в гармоническом среднем ход не меньше 1: иначе один ноль обнуляет всё
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, 1), 0);
  return (weighted + harmonic) / 2;
}
