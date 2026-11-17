import { describe, expect, it } from 'vitest';
import type { AltMove, Score, Side } from '../domain/gameTypes';
import { Chess } from 'chess.js';
import { classifyMistake } from './kinds';
import { KIND_ADVICE, KIND_TITLE, THEMES_OF_KIND } from './phrases';
import { THEMES } from '../content/themes';

describe('phrases', () => {
  it('темы видов ошибок', () => {
    expect(THEMES_OF_KIND).toEqual({
      missedMate: ['mateIn1', 'mateIn2'], allowedMate: ['mateIn1', 'mateIn2'],
      pieceEnPrise: ['hangingPiece'], pieceUndefended: ['hangingPiece'], missedCapture: ['hangingPiece'],
      missedFork: ['fork'], badTrade: [], missedCheck: ['skewer', 'doubleCheck'], other: [],
    });
    const ids = THEMES.map((t) => t.id);
    for (const list of Object.values(THEMES_OF_KIND)) for (const id of list) expect(ids).toContain(id);
  });
  it('у каждого вида есть название и совет', () => {
    expect(KIND_TITLE.pieceEnPrise).toBe('Фигура под боем');
    expect(KIND_TITLE.missedCheck).toBe('Пропущен сильный шах');
    expect(KIND_ADVICE.missedCheck).toBe('Перед ходом проверь все шахи — свои и соперника. '
      + 'Шах часто выигрывает фигуру, которая стоит за королём или без защиты.');
    // порядок объявления задаёт порядок при равном счёте: новый вид — перед «другим»
    expect(Object.keys(KIND_TITLE).slice(-2)).toEqual(['missedCheck', 'other']);
    for (const kind of Object.keys(THEMES_OF_KIND) as (keyof typeof KIND_TITLE)[]) {
      expect(KIND_TITLE[kind]).not.toBe('');
      expect(KIND_ADVICE[kind]).toMatch(/\.$/);
    }
  });
});

const alt = (move: string, score: Score, pv: string[] = [move]): AltMove => ({ move, score, pv });

function run(fenBefore: string, played: string, best: AltMove, reply: AltMove | null, after: Score,
  mover: Side = 'white') {
  return classifyMistake({ fenBefore, played, best: [best], reply, after, mover });
}

const MATE_FEN = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
const CAPTURE_FEN = '4k3/8/8/3r4/8/8/3R4/4K3 w - - 0 1';
const FORK_FEN = 'r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1';
const QUIET_FEN = '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1';

describe('classifyMistake', () => {
  it('пропущен мат', () => {
    const r = run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 1 }), alt('g8f8', { cp: 500 }), { cp: 500 });
    expect(r).toEqual({ kind: 'missedMate', phrase: 'Здесь был мат в 1 ход' });
  });

  it('пропущен мат в 2 и 3 хода — верная форма слова', () => {
    expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 2 }), null, { cp: 500 }).phrase).toBe('Здесь был мат в 2 хода');
    expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 3 }), null, { cp: 500 }).phrase).toBe('Здесь был мат в 3 хода');
  });

  it('мат дольше 3 ходов или мат и после сыгранного — не пропущен', () => {
    expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 4 }), null, { cp: 500 }).kind).not.toBe('missedMate');
    expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 1 }), null, { mate: 3 }).kind).not.toBe('missedMate');
  });

  it('пропущен мат за чёрных', () => {
    const r = run('3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'h7h6', alt('d8d1', { mate: -1 }), null, { cp: -500 },
      'black');
    expect(r.kind).toBe('missedMate');
  });

  it('допущен мат', () => {
    const r = run('6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', 'g8h8', alt('h7h6', { cp: 450 }),
      alt('d1d8', { mate: 1 }), { mate: 1 }, 'black');
    expect(r).toEqual({ kind: 'allowedMate', phrase: 'После этого хода соперник ставит мат' });
  });

  it('невыгодный размен', () => {
    const r = run('4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1', 'd2d5', alt('e1e2', { cp: 150 }),
      alt('e6d5', { cp: -200 }), { cp: -200 });
    expect(r.kind).toBe('badTrade');
    expect(r.phrase).toContain('ладья за коня');
    expect(r.phrase).toBe('Размен в пользу соперника: ладья за коня');
  });

  it('фигура под боем', () => {
    const r = run('4k3/8/8/4p3/8/8/4N3/4K3 w - - 0 1', 'e2d4', alt('e2c3', { cp: 200 }),
      alt('e5d4', { cp: 100 }), { cp: -100 });
    expect(r.kind).toBe('pieceEnPrise');
    expect(r.phrase).toContain('Конь');
    expect(r.phrase).toContain('e5');
    expect(r.phrase).toBe('Конь поставлен под бой: его заберёт пешка e5');
  });

  it('фигура под боем: женский род', () => {
    const r = run('4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1', 'd1d4', alt('d1d3', { cp: 900 }),
      alt('e5d4', { cp: -100 }), { cp: -100 });
    expect(r).toEqual({ kind: 'pieceEnPrise', phrase: 'Ферзь поставлен под бой: его заберёт пешка e5' });
    const r2 = run('4k3/8/8/4p3/8/8/8/3RK3 w - - 0 1', 'd1d4', alt('d1d3', { cp: 500 }),
      alt('e5d4', { cp: -100 }), { cp: -100 });
    expect(r2).toEqual({ kind: 'pieceEnPrise', phrase: 'Ладья поставлена под бой: её заберёт пешка e5' });
  });

  it('фигура без защиты', () => {
    const r = run('2r1k3/8/8/8/2B5/1P6/8/4K3 w - - 0 1', 'b3b4', alt('e1d2', { cp: -150 }),
      alt('c8c4', { cp: -500 }), { cp: -500 });
    expect(r.kind).toBe('pieceUndefended');
    expect(r.phrase).toContain('Слон на c4');
    expect(r.phrase).toBe('Слон на c4 остался без защиты');
  });

  it('взятие пешки — не «фигура под боем»: фраза не объяснила бы потерю', () => {
    // конь берёт пешку d3 с шахом и потом забирает ладью b2: потеря не из-за пешки
    const r = run('4k3/8/8/2n5/8/8/1R1P4/4K3 w - - 0 1', 'd2d3', alt('b2b4', { cp: 0 }),
      alt('c5d3', { cp: -500 }, ['c5d3', 'e1f1', 'd3b2']), { cp: -500 });
    expect(r.kind).toBe('other');
  });

  it('пропущен захват', () => {
    const r = run(CAPTURE_FEN, 'd2e2', alt('d2d5', { cp: 500 }), alt('e8d7', { cp: 0 }), { cp: 0 });
    expect(r).toEqual({ kind: 'missedCapture', phrase: 'Можно было забрать ладью бесплатно' });
  });

  it('пропущен захват защищённой фигуры — без «бесплатно»', () => {
    // ладья берёт ферзя, пешка забирает ладью: +9 −5
    const r = run('4k3/4p3/3q4/8/8/8/3R4/4K3 w - - 0 1', 'e1f1', alt('d2d6', { cp: 400 }, ['d2d6', 'e7d6']),
      null, { cp: -800 });
    expect(r).toEqual({ kind: 'missedCapture', phrase: 'Можно было забрать ферзя' });
  });

  it('пропущена вилка', () => {
    const r = run(FORK_FEN, 'e1e2', alt('b5c7', { cp: 500 }, ['b5c7', 'e8d7', 'c7a8']),
      alt('a8a2', { cp: -200 }), { cp: -200 });
    expect(r.kind).toBe('missedFork');
    expect(r.phrase).toContain('c7');
    expect(r.phrase).toBe('Конь на c7 нападал сразу на короля и ладью');
  });

  it('вилка на две фигуры без шаха', () => {
    // конь e5 → d7 нападает на ладьи b8 и f8
    const r = run('1r3r1k/8/8/4N3/8/8/8/4K3 w - - 0 1', 'e1e2', alt('e5d7', { cp: 400 }, ['e5d7', 'b8b7', 'd7f8']),
      null, { cp: 0 });
    expect(r).toEqual({ kind: 'missedFork', phrase: 'Конь на d7 нападал сразу на две ладьи' });
  });

  it('пешка нападает на две фигуры дороже себя', () => {
    const r = run('4k3/8/2n1b3/8/3P4/8/8/4K3 w - - 0 1', 'e1e2', alt('d4d5', { cp: 300 }, ['d4d5', 'c6e5', 'd5e6']),
      null, { cp: 0 });
    expect(r).toEqual({ kind: 'missedFork', phrase: 'Пешка на d5 нападала сразу на коня и слона' });
  });

  it('другое', () => {
    const r = run(QUIET_FEN, 'e1d1', alt('e2e4', { cp: 100 }), alt('e8d7', { cp: 0 }), { cp: 0 });
    expect(r).toEqual({ kind: 'other', phrase: 'Лучше было сыграть так' });
  });

  describe('reply: null', () => {
    it('первые два правила работают', () => {
      expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 1 }), null, { cp: 500 }).kind).toBe('missedMate');
      expect(run('6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', 'g8h8', alt('h7h6', { cp: 450 }), null, { mate: 1 },
        'black').kind).toBe('allowedMate');
    });
    it('правила про ответ соперника пропускаются', () => {
      expect(run('4k3/8/4p3/3n4/8/8/3R4/4K3 w - - 0 1', 'd2d5', alt('e1e2', { cp: 150 }), null,
        { cp: -200 }).kind).toBe('other');
      expect(run('4k3/8/8/4p3/8/8/4N3/4K3 w - - 0 1', 'e2d4', alt('e2c3', { cp: 200 }), null,
        { cp: -100 }).kind).toBe('other');
    });
    it('последние три правила работают', () => {
      expect(run(CAPTURE_FEN, 'd2e2', alt('d2d5', { cp: 500 }), null, { cp: 0 }).kind).toBe('missedCapture');
      expect(run(FORK_FEN, 'e1e2', alt('b5c7', { cp: 500 }, ['b5c7', 'e8d7', 'c7a8']), null,
        { cp: -200 }).kind).toBe('missedFork');
      expect(run(QUIET_FEN, 'e1d1', alt('e2e4', { cp: 100 }), null, { cp: 0 }).kind).toBe('other');
    });
  });

  it('пустой список лучших ходов не роняет функцию', () => {
    expect(classifyMistake({ fenBefore: QUIET_FEN, played: 'e1d1', best: [], reply: null, after: { cp: 0 },
      mover: 'white' })).toEqual({ kind: 'other', phrase: 'Лучше было сыграть так' });
  });
  describe('поправки раунда 1', () => {
    it('равный размен (слон берёт коня, пешка берёт слона) — не «фигура под боем»', () => {
      const r = run('4k3/8/4p3/3n4/8/1B6/8/4K3 w - - 0 1', 'b3d5', alt('e1e2', { cp: 0 }), alt('e6d5', { cp: 0 }),
        { cp: 0 });
      expect(r).toEqual({ kind: 'other', phrase: 'Лучше было сыграть так' });
    });

    it('слон отдан за пешку — невыгодный размен', () => {
      const r = run('4k3/8/4p3/3p4/8/1B6/8/4K3 w - - 0 1', 'b3d5', alt('e1e2', { cp: 100 }),
        alt('e6d5', { cp: -200 }), { cp: -200 });
      expect(r.kind).toBe('badTrade');
      expect(r.phrase).toContain('слон за пешку');
    });

    it('лучший ход берёт пешку, а выигрыш позже в линии — не «пропущенный захват»', () => {
      const fen = '6k1/r7/2p5/8/1N6/8/8/4K3 w - - 0 1';
      const line = ['b4c6', 'g8f8', 'c6a7'];
      const chess = new Chess(fen);
      for (const u of line) chess.move({ from: u.slice(0, 2), to: u.slice(2, 4) });
      expect(chess.history({ verbose: true }).map((m) => m.captured)).toEqual(['p', undefined, 'r']);
      const r = run(fen, 'e1e2', alt('b4c6', { cp: 500 }, line), null, { cp: 0 });
      expect(r.kind).not.toBe('missedCapture');
    });
  });

  describe('поправки подгонки', () => {
    // 15… c5 16. e:f6 — конь f6 защищён пешкой g7, ферзь d7 стоит против ферзя d1
    const DEFENDED_FEN = 'r4rk1/p1pq1pp1/bp3n1p/n3P3/P1P5/B4P1N/6PP/R2QKB1R b KQ - 0 15';
    // 16… g:f6 17. Ф:d7 — пешка бьёт пешку, а соперник забирает незащищённого ферзя
    const OTHER_SQUARE_FEN = 'r4rk1/p2q1pp1/bp3P1p/n1p5/P1P5/B4P1N/6PP/R2QKB1R b KQ - 0 16';
    // 8… g:f6 9. Ф:d4 — пешка забирает слона, конь d4 остаётся без защиты
    const TAKEN_FEN = 'r1bqkb1r/ppp2pp1/3p1B1p/8/3nP3/2N4P/PPP2PP1/R2QKB1R b KQkq - 0 8';
    // Лd8+ Крe7 Л:h8
    const CHECK_ROOK_FEN = 'r1b2k1r/2p2ppp/p7/4N3/n2R4/5P2/P1P2KPP/R7 w - - 0 23';
    // Фh5+ с решающей атакой
    const CHECK_ATTACK_FEN = 'r1bqkbnr/pppp3p/2n5/5p2/8/2N5/PPP2PPP/R1BQKBNR w KQkq - 0 7';

    it('К1: взятие, а соперник бьёт другую фигуру — не «невыгодный размен»', () => {
      const r = run(OTHER_SQUARE_FEN, 'g7f6', alt('d7d1', { cp: 0 }), alt('d1d7', { cp: 900 }), { cp: 900 },
        'black');
      expect(r).toEqual({ kind: 'pieceUndefended', phrase: 'Ферзь на d7 остался без защиты' });
    });

    it('К2: забранная фигура защищена — «остался под боем», с тем, кто забирает', () => {
      const r = run(DEFENDED_FEN, 'c7c5', alt('f6d5', { cp: 0 }), alt('e5f6', { cp: 300 }, ['e5f6', 'd7d1', 'a1d1']),
        { cp: 300 }, 'black');
      expect(r).toEqual({ kind: 'pieceUndefended', phrase: 'Конь на f6 остался под боем: его заберёт пешка e5' });
    });

    it('К2: женский род; незащищённая фигура — прежняя фраза', () => {
      // слон a7 забирает ладью d4, пешка e3 отбивает: 5 − 3
      const r = run('4k3/b7/8/8/3R4/4P3/8/4K3 w - - 0 1', 'e1e2', alt('d4d1', { cp: 0 }),
        alt('a7d4', { cp: -200 }, ['a7d4', 'e3d4']), { cp: -200 });
      expect(r).toEqual({ kind: 'pieceUndefended', phrase: 'Ладья на d4 осталась под боем: её заберёт слон a7' });
      const r2 = run('4k3/b7/8/8/3R4/8/8/4K3 w - - 0 1', 'e1e2', alt('d4d1', { cp: 0 }), alt('a7d4', { cp: -500 }),
        { cp: -500 });
      expect(r2).toEqual({ kind: 'pieceUndefended', phrase: 'Ладья на d4 осталась без защиты' });
    });

    it('К3: взятое сыгранным ходом не вычитается, если соперник бьёт на другом поле', () => {
      const r = run(TAKEN_FEN, 'g7f6', alt('d8f6', { cp: 0 }), alt('d1d4', { cp: 300 }), { cp: 300 }, 'black');
      expect(r).toEqual({ kind: 'pieceUndefended', phrase: 'Конь на d4 остался без защиты' });
    });

    it('К4: сыгранный ход забрал на том же поле, что и лучший, — не «пропущен захват»', () => {
      const r = run(TAKEN_FEN, 'g7f6', alt('d8f6', { cp: 0 }), null, { cp: 300 }, 'black');
      expect(r).toEqual({ kind: 'other', phrase: 'Лучше было сыграть так' });
    });

    it('К5: пропущен шах, который выигрывал ладью', () => {
      const r = run(CHECK_ROOK_FEN, 'a1b1', alt('d4d8', { cp: 600 }, ['d4d8', 'f8e7', 'd8h8']), null, { cp: 0 });
      expect(r).toEqual({ kind: 'missedCheck', phrase: 'Шах Лd8+ выигрывал ладью' });
    });

    it('К5: пропущен шах с сильной атакой', () => {
      const r = run(CHECK_ATTACK_FEN, 'g1f3', alt('d1h5', { cp: 1000 }, ['d1h5', 'e8e7', 'c3d5']), null, { cp: 0 });
      expect(r).toEqual({ kind: 'missedCheck', phrase: 'Шах Фh5+ давал сильную атаку' });
    });

    it('К5: шах, совпавший с сыгранным ходом, и мат — не «пропущен шах»', () => {
      expect(run(CHECK_ROOK_FEN, 'd4d8', alt('d4d8', { cp: 600 }, ['d4d8', 'f8e7', 'd8h8']), null, { cp: 600 })
        .kind).toBe('other');
      // мат и после сыгранного: правило 1 молчит, а мат шахом не считается
      expect(run(MATE_FEN, 'h2h3', alt('d1d8', { mate: 1 }), null, { mate: 3 }).kind).toBe('other');
    });
  });
});
