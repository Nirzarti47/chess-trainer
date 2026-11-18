/** Все пороги разбора партий. Менять числа — только здесь. */
export const CONFIG = {
  RULES_VERSION: 2,
  FAST_NODES: 60_000, FAST_MULTIPV: 2,
  DEEP_NODES: 300_000, DEEP_MULTIPV: 3, DEEP_TRIGGER_LOSS: 0.08, DEEP_MAX_MOVES: 20,
  EXPLORE_NODES: 300_000,
  EXCELLENT_MAX: 0.02, MISS_SHARE: 0.5, MISS_SLACK: 0.05,  // «Отлично»; «Упущенная возможность»: доля подарка и допуск
  GOOD_MAX: 0.05, INACCURACY_MAX: 0.10, MISTAKE_MAX: 0.20,
  ALT_MAX_LOSS: 0.05,            // варианты «Лучше было»: уступают лучшему меньше этого
  GREAT_GAP: 0.10, BRILLIANT_MAX_LOSS: 0.02, BRILLIANT_MAX_BEFORE: 0.90,
  BRILLIANT_MIN_AFTER: 0.5,      // после блестящего хода позиция не хуже равной
  MATE_KIND_MAX: 3, MATERIAL_WIN: 2,
  LINE_PLIES: 3,                 // сколько полуходов линии смотреть, считая выигрыш материала
  PIECE_MIN_VALUE: 3,            // «фигура», а не пешка: цена от 3
  PUZZLE_MAX: 8, UNIQUE_MARGIN: 0.15, PUZZLE_MIN_BEST: 0.35,
  ACC_WINDOW_MIN: 2, ACC_WINDOW_MAX: 8, ACC_WEIGHT_MIN: 0.5, ACC_WEIGHT_MAX: 12, ACC_LOSS_SCALE: 1, ACC_HARMONIC_FLOOR: 1,  // точность партии, как у Lichess
  AUTO_GAMES: 20, PATTERN_SIZE: 10, PATTERN_OWN_MAX: 6, FEW_GAMES: 3, FEW_MISTAKES: 10,
} as const;
