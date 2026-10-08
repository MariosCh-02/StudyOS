import { absMinutes, type DateKey, type LocalDateTime } from "@/domain/time";

export interface Positioned<T> {
  item: T;
  /** Minutes from midnight of the column's day, clipped to [0, 1440]. */
  startMin: number;
  endMin: number;
  /** Column index within its overlap group, and the group's column count. */
  col: number;
  cols: number;
  /** The item continues from the previous day / into the next day. */
  clippedStart: boolean;
  clippedEnd: boolean;
}

const MIN_VISUAL_MINUTES = 20;

/**
 * Lays out timed items for one day column. Overlapping items share the width
 * in side-by-side columns; each group of mutually overlapping items is sized
 * independently, as in common calendar apps.
 */
export function layoutDay<T extends { start: LocalDateTime; end: LocalDateTime; allDay: boolean }>(items: T[], date: DateKey): Positioned<T>[] {
  const dayStart = absMinutes(`${date}T00:00`);
  const blocks = items
    .filter((i) => !i.allDay && absMinutes(i.end) > dayStart && absMinutes(i.start) < dayStart + 1440)
    .map((item) => {
      const s = absMinutes(item.start) - dayStart;
      const e = absMinutes(item.end) - dayStart;
      const startMin = Math.max(0, s);
      return {
        item,
        startMin,
        endMin: Math.min(1440, Math.max(e, startMin + MIN_VISUAL_MINUTES)),
        col: 0,
        cols: 1,
        clippedStart: s < 0,
        clippedEnd: e > 1440,
      };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let group: typeof blocks = [];
  let columnEnds: number[] = [];
  let groupEnd = -1;
  const close = () => {
    for (const b of group) b.cols = columnEnds.length;
    group = [];
    columnEnds = [];
  };

  for (const b of blocks) {
    if (b.startMin >= groupEnd) {
      close();
      groupEnd = -1;
    }
    let col = columnEnds.findIndex((end) => end <= b.startMin);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(b.endMin);
    } else {
      columnEnds[col] = b.endMin;
    }
    b.col = col;
    group.push(b);
    groupEnd = Math.max(groupEnd, b.endMin);
  }
  close();
  return blocks;
}
