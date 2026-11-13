import { CURRICULUM, type PathNode, type Section } from '../content/curriculum';
import type { LessonProgress, ThemeStat } from './types';

export type NodeStatus = 'done' | 'current' | 'locked';
export interface PathItem { node: PathNode; status: NodeStatus; lessonsDone: number; nextLesson: number | null;
  reinforcement: boolean; fastTrackOffer: boolean }
export interface PathView { sections: { section: Section; items: PathItem[] }[];
  weakSpots: { visible: boolean; dueCount: number } }

export const REINFORCE_BELOW = 0.70, FAST_TRACK_FROM = 0.90, EXAM_ADVICE_BELOW = 0.60, WEAK_MIN_SOLVED = 20;

const REINFORCE_SUFFIX = ':reinforce';

function share(rows: LessonProgress[]): number {
  const total = rows.reduce((s, r) => s + r.total, 0);
  return total > 0 ? rows.reduce((s, r) => s + r.clean, 0) / total : 1;
}

/** Доля чистых решений по всем записям узла; без записей или при нулевом итоге — 1. */
export function cleanShare(nodeId: string, progress: LessonProgress[]): number {
  return share(progress.filter((r) => r.nodeId === nodeId));
}

/** Доля чистых решений по урокам 0 и 1 — основание для ускорения. */
function fastTrackShare(rows: LessonProgress[]): number {
  return share(rows.filter((r) => r.lessonIndex <= 1));
}

function isDone(node: PathNode, rows: LessonProgress[], completed: Set<number>): boolean {
  if (completed.size === node.lessons) return true;   // в completed только индексы 0..lessons-1
  return node.kind === 'theme' && completed.has(0) && completed.has(1) && completed.has(node.lessons - 1)
    && fastTrackShare(rows) >= FAST_TRACK_FROM;
}

function canFastTrack(node: PathNode, rows: LessonProgress[], completed: Set<number>, declined: string[]): boolean {
  return node.kind === 'theme' && completed.has(0) && completed.has(1)
    && [...completed].every((i) => i <= 1)
    && fastTrackShare(rows) >= FAST_TRACK_FROM
    && !declined.includes(node.id);
}

function reinforcementItem(node: PathNode): PathItem {
  return {
    node: { id: node.id + REINFORCE_SUFFIX, kind: 'theme', title: `Закрепление: ${node.title}`,
      themeId: node.themeId, circle: node.circle, lessons: 1 },
    status: 'current', lessonsDone: 0, nextLesson: 0, reinforcement: true, fastTrackOffer: false,
  };
}

export function buildPath(progress: LessonProgress[], stats: ThemeStat[], declined: string[], dueCount: number): PathView {
  const byNode = new Map<string, LessonProgress[]>();
  for (const r of progress) byNode.set(r.nodeId, [...(byNode.get(r.nodeId) ?? []), r]);

  // Путь сквозной через все разделы; current — первый непройденный узел, дальше всё закрыто.
  let currentFound = false;
  const sections = CURRICULUM.map((section) => {
    const items: PathItem[] = [];
    for (const node of section.nodes) {
      const rows = byNode.get(node.id) ?? [];
      const completed = new Set(rows.map((r) => r.lessonIndex).filter((i) => i >= 0 && i < node.lessons));
      const done = isDone(node, rows, completed);
      const status: NodeStatus = done ? 'done' : currentFound ? 'locked' : 'current';
      if (status === 'current') currentFound = true;
      let nextLesson: number | null = null;
      if (status === 'current') {
        nextLesson = 0;
        while (completed.has(nextLesson)) nextLesson++;
      }
      items.push({
        node, status, lessonsDone: completed.size, nextLesson, reinforcement: false,
        fastTrackOffer: status === 'current' && canFastTrack(node, rows, completed, declined),
      });
      if (done && node.kind === 'theme' && share(rows) < REINFORCE_BELOW && !byNode.has(node.id + REINFORCE_SUFFIX)) {
        items.push(reinforcementItem(node));
      }
    }
    return { section, items };
  });

  return {
    sections,
    weakSpots: { visible: stats.some((s) => s.solved >= WEAK_MIN_SOLVED), dueCount },
  };
}
