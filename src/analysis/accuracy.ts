import type { Score, Side } from '../domain/gameTypes';
import { CONFIG } from './config';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Вероятность выигрыша белых в процентах для точности, как у Lichess: оценка обрезана до ±ACC_CP_CAP,
 *  мат — как потолок в пользу ставящего мат, конец партии — победа белых +потолок, чёрных −потолок, ничья 0. */
export function winPercent(score: Score): number {
  const cap = CONFIG.ACC_CP_CAP;
  let cp: number;
  if ('cp' in score) cp = clamp(score.cp, -cap, cap);
  else if ('mate' in score) cp = score.mate > 0 ? cap : -cap;
  else cp = score.over === 'white' ? cap : score.over === 'black' ? -cap : 0;
  return 100 / (1 + Math.exp(-0.00368208 * cp));
}

/** Точность хода по изменению вероятности выигрыша ходящего (0..100). */
export function moveAccuracyWin(winBefore: number, winAfter: number, lossScale: number = CONFIG.ACC_LOSS_SCALE): number {
  if (winAfter >= winBefore) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * lossScale * (winBefore - winAfter))
    - 3.166924740191411 + 1;
  return clamp(raw, 0, 100);
}

const stdDev = (xs: number[]): number => {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
};

/** Точность стороны за партию; null, если у стороны нет ходов. scores — как в GameAnalysis (белая точка зрения).
 *  opts.lossScale — поправка потери (по умолчанию CONFIG.ACC_LOSS_SCALE; для тестов). */
export function gameAccuracy(scores: Score[], side: Side, opts?: { lossScale?: number }): number | null {
  const plies = scores.length - 1;
  const win = scores.map(winPercent);
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
    accs.push(moveAccuracyWin(before, after, opts?.lossScale));
    weights.push(clamp(stdDev(windows[Math.min(i, windows.length - 1)]), CONFIG.ACC_WEIGHT_MIN, CONFIG.ACC_WEIGHT_MAX));
  }
  if (accs.length === 0) return null;
  const weighted = accs.reduce((s, a, k) => s + a * weights[k], 0) / weights.reduce((s, x) => s + x, 0);
  // в гармоническом среднем ход не меньше 1: иначе один ноль обнуляет всё
  const harmonic = accs.length / accs.reduce((s, a) => s + 1 / Math.max(a, CONFIG.ACC_HARMONIC_FLOOR), 0);
  return (weighted + harmonic) / 2;
}
