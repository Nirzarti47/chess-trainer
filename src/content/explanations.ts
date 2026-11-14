import type { ExplainStep, LessonTask, ThemeId } from '../domain/types';
import { BASICS_LESSON } from './basics';
import { OPENING_LESSONS } from './openings';

// Объяснения тем на доске. full — первое знакомство с темой: 2–3 шага, в последнем человек
// сам находит удар. reminder — один шаг перед уроками той же темы.
// Каждый ход проверен движком (scripts/verify_content.mjs): он лучший и единственный в позиции.

interface ThemeExplain { full: ExplainStep[]; reminder: ExplainStep }

const THEME_EXPLAINS: Partial<Record<ThemeId, ThemeExplain>> = {
  mateIn1: {
    full: [
      {
        fen: 'r4rk1/ppq2p1p/2n3pQ/8/8/8/1B3PPP/3R2K1 w - - 0 1',
        text: 'Мат — это шах, от которого нет спасения. Сыграй ферзём на g7: его защищает слон b2, а королю некуда уйти.',
        move: 'h6g7',
      },
      {
        fen: 'r2q1rk1/ppp2pp1/2n5/7Q/8/3B4/PPP2PPP/R5K1 w - - 0 1',
        text: 'Теперь найди мат в один ход сам. Ферзю нужна поддержка другой фигуры.',
        move: 'h5h7',
      },
    ],
    reminder: {
      fen: 'r4rk1/pp1q1p1p/2n2PpQ/8/8/8/5PPP/3R2K1 w - - 0 1',
      text: 'Мат — это шах, от которого не уйти, не закрыться и который нельзя снять взятием. Найди мат в один ход.',
      move: 'h6g7',
    },
  },
  hangingPiece: {
    full: [
      {
        fen: 'r1bq1rk1/ppp2ppp/8/4n3/2B1P3/5N2/PPP2PPP/R2Q1RK1 w - - 0 1',
        text: 'Незащищённая фигура — та, которую никто не охраняет: её можно забрать даром. Конь e5 без защиты — побей его конём f3.',
        move: 'f3e5',
      },
      {
        fen: 'r4rk1/pp3ppp/2nb4/8/8/2N2N2/PPP2PPP/3R1RK1 w - - 0 1',
        text: 'Перед каждым ходом смотри, что у соперника осталось без защиты. Найди фигуру, которую можно взять даром.',
        move: 'd1d6',
      },
    ],
    reminder: {
      fen: 'r2q1rk1/ppp2ppp/2nb4/3p4/3P2b1/2NB4/PPP2PPP/R1BQ1RK1 w - - 0 1',
      text: 'Фигура без защиты — добыча: её берут даром. Найди такую фигуру у чёрных.',
      move: 'd1g4',
    },
  },
  fork: {
    full: [
      {
        fen: 'r1b1kb1r/pp3ppp/2n1pq2/1N6/8/8/PPP2PPP/R1BQKB1R w KQkq - 0 1',
        text: 'Вилка — это когда одна фигура нападает сразу на две. Сыграй конём на c7: шах королю и удар по ладье a8.',
        move: 'b5c7',
      },
      {
        fen: 'r1bqkb1r/pppp1ppp/2n5/4p3/2B1N3/5N2/PPPP1PPP/R1BQK2R b KQkq - 0 5',
        text: 'Белые взяли твоего коня на e4. Верни фигуру: найди вилку пешкой.',
        move: 'd7d5',
      },
    ],
    reminder: {
      fen: 'r1b2rk1/pppq1p1p/6p1/3N4/8/8/PPP2PPP/RQ3RK1 w - - 0 1',
      text: 'Вилка — одна фигура бьёт сразу две. Найди вилку конём.',
      move: 'd5f6',
    },
  },
  pin: {
    full: [
      {
        fen: 'r4rk1/ppp3pp/2nbq3/8/8/1PN5/2P1BPPP/R2Q1RK1 w - - 0 1',
        text: 'Связка — это когда фигура не может уйти с линии, потому что за ней стоит король или более ценная фигура. Поставь слона на c4: ферзь e6 связан и пропадёт.',
        move: 'e2c4',
      },
      {
        fen: 'r3k2r/pbp1nppp/1pn3q1/1B6/3P4/2N5/PPP2PP1/R1BQ1RK1 w kq - 0 1',
        text: 'Конь c6 связан: уйти он не может, за ним король e8. Нападай на связанную фигуру — найди, чем.',
        move: 'd4d5',
      },
    ],
    reminder: {
      fen: 'r1b1kb1r/pp1q1ppp/3p1n2/2p5/P2PP3/5N2/1PP2PP1/R1BQKB1R w KQkq - 0 1',
      text: 'Связанная фигура не может уйти: за ней король. Найди связку, которая выиграет ферзя.',
      move: 'f1b5',
    },
  },
  skewer: {
    full: [
      {
        fen: 'r7/5pp1/7p/3k4/8/6P1/4BPKP/8 w - - 0 1',
        text: 'Сквозной удар — нападение на ценную фигуру, за которой на той же линии стоит другая. Сыграй слоном на f3 с шахом: король уйдёт, и ладья a8 твоя.',
        move: 'e2f3',
      },
      {
        fen: '8/r4k2/6p1/8/8/6P1/5PK1/7R w - - 0 1',
        text: 'Король и ладья чёрных стоят на одной линии. Найди сквозной удар.',
        move: 'h1h7',
      },
    ],
    reminder: {
      fen: '3q4/5pp1/7p/3k4/8/6P1/5PKP/1R6 w - - 0 1',
      text: 'Сквозной удар: шах королю, а за ним на линии стоит фигура, которую ты заберёшь. Найди его.',
      move: 'b1d1',
    },
  },
  discoveredAttack: {
    full: [
      {
        fen: 'r4rk1/ppp2ppp/2n5/3q4/8/3B1N2/PPP1QPPP/3R2K1 w - - 0 1',
        text: 'Открытое нападение: фигура уходит с линии и открывает удар той, что стоит за ней. Побей слоном h7 с шахом — и ладья d1 заберёт ферзя.',
        move: 'd3h7',
      },
      {
        fen: 'rnbqkb1r/pppp1ppp/5n2/4N3/8/8/PPPPQPPP/RNB1KB1R w KQkq - 2 5',
        text: 'Между твоим ферзём e2 и королём e8 стоит только твой конь. Найди ход конём, который выиграет ферзя.',
        move: 'e5c6',
      },
    ],
    reminder: {
      fen: '1rb1kb1r/p2p1ppp/5n2/1p6/q3B3/2P2N2/PP1Q1PPP/R1B1R1K1 w k - 0 1',
      text: 'Уведи слона с линии e так, чтобы он напал на ферзя, а ладья открыла шах королю. Найди этот ход.',
      move: 'e4c2',
    },
  },
  mateIn2: {
    full: [
      {
        fen: '8/4k3/1R6/8/8/8/8/R5K1 w - - 0 1',
        text: 'Мат в два хода начинается с хода, который загоняет короля в ловушку. Дай шах ладьёй на a7, и королю останется только край доски, ведь шестой ряд держит ладья b6.',
        move: 'a1a7',
      },
      {
        fen: '5k2/R7/1R6/8/8/8/8/6K1 w - - 0 1',
        text: 'Король отступил на f8. Поставь мат второй ладьёй.',
        move: 'b6b8',
      },
    ],
    reminder: {
      fen: 'R6K/8/8/8/8/1R6/4k3/8 w - - 0 1',
      text: 'Мат в два: сначала шах, который загоняет короля на край доски. Найди первый ход.',
      move: 'a8a2',
    },
  },
  backRankMate: {
    full: [
      {
        fen: '6k1/pp3ppp/1qn5/8/8/8/PP1Q1PPP/4R1K1 w - - 0 1',
        text: 'Король за тремя своими пешками заперт на последнем ряду, или последней горизонтали: отступить ему некуда. Сыграй ладьёй на e8 — это мат.',
        move: 'e1e8',
      },
      {
        fen: '7k/p4ppp/8/4n3/8/1q6/P4PPP/2R3K1 w - - 0 1',
        text: 'Ферзь b3 стоит под ударом, но есть ход сильнее. Найди его.',
        move: 'c1c8',
      },
    ],
    reminder: {
      fen: '6k1/pb3ppp/1p6/8/8/8/qP3PPP/2RQ2K1 w - - 0 1',
      text: 'Король заперт своими пешками на последнем ряду. Найди мат.',
      move: 'd1d8',
    },
  },
};

const AUTHORED: Record<string, LessonTask[][]> = {
  'basics:basics': [BASICS_LESSON],
  'c1:openings': OPENING_LESSONS,
};

export function getAuthoredLesson(nodeId: string, lessonIndex: number): LessonTask[] {
  return (Object.hasOwn(AUTHORED, nodeId) && AUTHORED[nodeId][lessonIndex]) || [];
}

/** Для тем без написанного объяснения (круги 2 и 3 добавит следующая задача) — пустой список. */
export function getExplain(themeId: ThemeId, mode: 'full' | 'reminder'): ExplainStep[] {
  const e = Object.hasOwn(THEME_EXPLAINS, themeId) ? THEME_EXPLAINS[themeId] : undefined;
  if (!e) return [];
  return mode === 'full' ? e.full : [e.reminder];
}
