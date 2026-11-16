// Подставной движок разбора — только для тестов.
import { Chess } from 'chess.js';
import type { AnalysisEngine, EngineLine } from '../engine/analysisEngine';

/** Отвечает по таблице fen → линии; на неизвестный fen — одна линия { cp: 0 } с первым допустимым ходом. */
export function tableEngine(table: Record<string, EngineLine[]>):
  Pick<AnalysisEngine, 'analyse'> & { calls: { fen: string; nodes: number; multipv: number }[] } {
  const calls: { fen: string; nodes: number; multipv: number }[] = [];
  return {
    calls,
    async analyse(fen, opts) {
      calls.push({ fen, nodes: opts.nodes, multipv: opts.multipv });
      if (opts.signal?.aborted) return null;
      const lines = table[fen];
      if (lines) return lines.slice(0, opts.multipv);
      const first = new Chess(fen).moves({ verbose: true })[0];
      if (!first) return [];
      const move = first.from + first.to + (first.promotion ?? '');
      return [{ move, score: { cp: 0 }, pv: [move] }];
    },
  };
}
