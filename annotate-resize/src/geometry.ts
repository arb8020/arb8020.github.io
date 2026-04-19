// Pure geometry + invariants for the resize + ghost pipeline.
// All exports are pure functions. Invariants are checked with assertions:
// if one fires, our code is wrong upstream, not the caller's input.

import type { AnchorCorner } from './types';

export interface Rect { x: number; y: number; w: number; h: number }

const RESIZE_DIRS = new Set(['tl', 'tr', 'bl', 'br', 't', 'b', 'l', 'r']);
const CORNER_DIRS = new Set(['tl', 'tr', 'bl', 'br']);

export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`invariant: ${msg}`);
}

function assertRect(r: Rect, name: string) {
  assert(Number.isFinite(r.x), `${name}.x finite`);
  assert(Number.isFinite(r.y), `${name}.y finite`);
  assert(r.w > 0, `${name}.w > 0 (got ${r.w})`);
  assert(r.h > 0, `${name}.h > 0 (got ${r.h})`);
}

// anchor corner is the corner OPPOSITE the dragged corner — the one that stays
// visually fixed during and after the resize.
export function anchorForCorner(dir: string): AnchorCorner {
  assert(CORNER_DIRS.has(dir), `anchorForCorner: not a corner dir (${dir})`);
  switch (dir) {
    case 'tl': return 'br';
    case 'tr': return 'bl';
    case 'bl': return 'tr';
    case 'br': return 'tl';
  }
  throw new Error('unreachable');
}

// Given a starting rect and a pointer delta, compute the new rect for a drag
// along `dir`. Applies min-dimension clamps while preserving the anchor corner.
// The caller is expected to pass a real corner/edge dir.
export function computeResize(
  dir: string,
  start: Rect,
  dx: number,
  dy: number,
  minW = 120,
  minH = 80,
): Rect {
  assert(RESIZE_DIRS.has(dir), `computeResize: unknown dir (${dir})`);
  assertRect(start, 'start');

  let { x: nx, y: ny, w: nw, h: nh } = start;
  if (dir.includes('l')) { nx = start.x + dx; nw = start.w - dx; }
  if (dir.includes('r')) { nw = start.w + dx; }
  if (dir.includes('t')) { ny = start.y + dy; nh = start.h - dy; }
  if (dir.includes('b')) { nh = start.h + dy; }

  // clamp to min while preserving the anchor corner — if we clamped width
  // growing leftward, push x back so the right edge doesn't shift.
  if (nw < minW) { if (dir.includes('l')) nx -= (minW - nw); nw = minW; }
  if (nh < minH) { if (dir.includes('t')) ny -= (minH - nh); nh = minH; }

  const next: Rect = { x: nx, y: ny, w: nw, h: nh };
  assertRect(next, 'next');

  // Anchor invariant: the edge NOT named by dir must not move.
  //   e.g. dragging 'r' means left edge (x) is unchanged;
  //        dragging 'tl' means br corner (x+w, y+h) is unchanged.
  if (!dir.includes('l') && !dir.includes('r')) {
    assert(next.x === start.x, `vertical-only drag must not change x`);
    assert(next.w === start.w, `vertical-only drag must not change w`);
  }
  if (!dir.includes('t') && !dir.includes('b')) {
    assert(next.y === start.y, `horizontal-only drag must not change y`);
    assert(next.h === start.h, `horizontal-only drag must not change h`);
  }
  if (dir.includes('r')) assert(next.x === start.x, `right-drag must pin x`);
  if (dir.includes('l') && nw > minW) {
    assert(next.x + next.w === start.x + start.w, `left-drag must pin right edge`);
  }
  if (dir.includes('b')) assert(next.y === start.y, `bottom-drag must pin y`);
  if (dir.includes('t') && nh > minH) {
    assert(next.y + next.h === start.y + start.h, `top-drag must pin bottom edge`);
  }

  return next;
}

// Given an anchor corner and an orig rect, return the top-left corner of a new
// rect of size (w, h) such that the anchor corner is shared with origRect.
export function anchoredPos(anchor: AnchorCorner, orig: Rect, w: number, h: number): { x: number; y: number } {
  assertRect(orig, 'orig');
  assert(w > 0, 'anchoredPos: w > 0');
  assert(h > 0, 'anchoredPos: h > 0');
  switch (anchor) {
    case 'tl': return { x: orig.x,               y: orig.y };
    case 'tr': return { x: orig.x + orig.w - w,  y: orig.y };
    case 'bl': return { x: orig.x,               y: orig.y + orig.h - h };
    case 'br': return { x: orig.x + orig.w - w,  y: orig.y + orig.h - h };
  }
}

// Verify that two rects share their anchor corner. Used as a post-condition
// check in the resize pipeline — if this fails we built a bad pendingRewrite.
export function assertAnchorShared(anchor: AnchorCorner, a: Rect, b: Rect): void {
  switch (anchor) {
    case 'tl':
      assert(a.x === b.x, `anchor tl: a.x=${a.x} b.x=${b.x}`);
      assert(a.y === b.y, `anchor tl: a.y=${a.y} b.y=${b.y}`);
      return;
    case 'tr':
      assert(a.x + a.w === b.x + b.w, `anchor tr: right edge a=${a.x + a.w} b=${b.x + b.w}`);
      assert(a.y === b.y, `anchor tr: a.y=${a.y} b.y=${b.y}`);
      return;
    case 'bl':
      assert(a.x === b.x, `anchor bl: a.x=${a.x} b.x=${b.x}`);
      assert(a.y + a.h === b.y + b.h, `anchor bl: bottom edge a=${a.y + a.h} b=${b.y + b.h}`);
      return;
    case 'br':
      assert(a.x + a.w === b.x + b.w, `anchor br: right edge a=${a.x + a.w} b=${b.x + b.w}`);
      assert(a.y + a.h === b.y + b.h, `anchor br: bottom edge a=${a.y + a.h} b=${b.y + b.h}`);
      return;
  }
}
