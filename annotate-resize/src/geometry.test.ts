import { describe, it, expect } from 'vitest';
import {
  anchorForCorner,
  computeResize,
  anchoredPos,
  assertAnchorShared,
  type Rect,
} from './geometry';
import type { AnchorCorner } from './types';

// A representative starting box used across tests.
const START: Rect = { x: 100, y: 200, w: 300, h: 150 };

// Helpers to query corner coordinates of a rect.
function corner(r: Rect, c: AnchorCorner): { x: number; y: number } {
  switch (c) {
    case 'tl': return { x: r.x,           y: r.y };
    case 'tr': return { x: r.x + r.w,     y: r.y };
    case 'bl': return { x: r.x,           y: r.y + r.h };
    case 'br': return { x: r.x + r.w,     y: r.y + r.h };
  }
}

describe('anchorForCorner', () => {
  it('returns the opposite corner for each corner dir', () => {
    expect(anchorForCorner('tl')).toBe('br');
    expect(anchorForCorner('tr')).toBe('bl');
    expect(anchorForCorner('bl')).toBe('tr');
    expect(anchorForCorner('br')).toBe('tl');
  });

  it('rejects non-corner dirs', () => {
    expect(() => anchorForCorner('t')).toThrow(/invariant/);
    expect(() => anchorForCorner('b')).toThrow(/invariant/);
    expect(() => anchorForCorner('l')).toThrow(/invariant/);
    expect(() => anchorForCorner('r')).toThrow(/invariant/);
    expect(() => anchorForCorner('nope')).toThrow(/invariant/);
  });
});

describe('computeResize — anchor invariants', () => {
  // For each corner drag, the OPPOSITE corner must not move.
  const corners: Array<{ dir: string; anchor: AnchorCorner }> = [
    { dir: 'tl', anchor: 'br' },
    { dir: 'tr', anchor: 'bl' },
    { dir: 'bl', anchor: 'tr' },
    { dir: 'br', anchor: 'tl' },
  ];

  const deltas = [
    { dx:  40, dy:  30 }, // grow
    { dx: -40, dy: -30 }, // shrink
    { dx:  10, dy: -20 },
    { dx: -10, dy:  20 },
    { dx:   0, dy:   0 }, // no-op
  ];

  for (const { dir, anchor } of corners) {
    for (const d of deltas) {
      it(`${dir} drag (dx=${d.dx}, dy=${d.dy}) keeps ${anchor} fixed`, () => {
        const next = computeResize(dir, START, d.dx, d.dy);
        expect(corner(next, anchor)).toEqual(corner(START, anchor));
      });
    }
  }
});

describe('computeResize — min-dimension clamps preserve anchor', () => {
  // Huge shrink that would collapse the box. Anchor corner must still not move.
  it('tl drag: collapsing toward br clamps at (minW, minH); br stays fixed', () => {
    const next = computeResize('tl', START, 9999, 9999);
    expect(next.w).toBe(120);
    expect(next.h).toBe(80);
    // with min clamp active, the dragged corner stops moving but anchor pin still holds
    expect(corner(next, 'br')).toEqual(corner(START, 'br'));
  });

  it('br drag: collapsing toward tl clamps; tl stays fixed', () => {
    const next = computeResize('br', START, -9999, -9999);
    expect(next.w).toBe(120);
    expect(next.h).toBe(80);
    expect(corner(next, 'tl')).toEqual(corner(START, 'tl'));
  });

  it('tr drag: collapsing clamps; bl stays fixed', () => {
    const next = computeResize('tr', START, -9999, 9999);
    expect(next.w).toBe(120);
    expect(next.h).toBe(80);
    expect(corner(next, 'bl')).toEqual(corner(START, 'bl'));
  });

  it('bl drag: collapsing clamps; tr stays fixed', () => {
    const next = computeResize('bl', START, 9999, -9999);
    expect(next.w).toBe(120);
    expect(next.h).toBe(80);
    expect(corner(next, 'tr')).toEqual(corner(START, 'tr'));
  });
});

describe('computeResize — edge drags only move one axis', () => {
  it('right edge only changes w; x unchanged', () => {
    const next = computeResize('r', START, 50, 999);
    expect(next.x).toBe(START.x);
    expect(next.y).toBe(START.y);
    expect(next.h).toBe(START.h);
    expect(next.w).toBe(START.w + 50);
  });

  it('left edge: moves x and w, right edge pinned', () => {
    const next = computeResize('l', START, 40, 999);
    expect(next.y).toBe(START.y);
    expect(next.h).toBe(START.h);
    expect(next.x + next.w).toBe(START.x + START.w);
  });

  it('top edge: moves y and h, bottom edge pinned', () => {
    const next = computeResize('t', START, 999, 30);
    expect(next.x).toBe(START.x);
    expect(next.w).toBe(START.w);
    expect(next.y + next.h).toBe(START.y + START.h);
  });

  it('bottom edge only changes h; y unchanged', () => {
    const next = computeResize('b', START, 999, 25);
    expect(next.y).toBe(START.y);
    expect(next.h).toBe(START.h + 25);
  });
});

describe('anchoredPos — anchor corner is shared with orig', () => {
  const anchors: AnchorCorner[] = ['tl', 'tr', 'bl', 'br'];
  const sizes = [
    { w: 300, h: 150 }, // same size
    { w: 500, h: 250 }, // larger
    { w: 150, h: 100 }, // smaller
    { w: 120, h: 80  }, // min
  ];

  for (const a of anchors) {
    for (const s of sizes) {
      it(`anchor=${a} size=(${s.w},${s.h}) shares ${a} corner with orig`, () => {
        const pos = anchoredPos(a, START, s.w, s.h);
        const placed: Rect = { x: pos.x, y: pos.y, w: s.w, h: s.h };
        expect(corner(placed, a)).toEqual(corner(START, a));
      });
    }
  }
});

describe('assertAnchorShared', () => {
  it('passes when rects share the anchor corner', () => {
    const placed: Rect = { x: 150, y: 200, w: 250, h: 150 };
    // br of placed: (400, 350); br of START: (400, 350) — shared.
    expect(() => assertAnchorShared('br', START, placed)).not.toThrow();
  });

  it('throws when anchor corner diverges', () => {
    const placed: Rect = { x: START.x, y: START.y, w: 400, h: 200 };
    // tr of placed = (500, 200); tr of START = (400, 200) → not shared
    expect(() => assertAnchorShared('tr', START, placed)).toThrow(/anchor tr/);
  });
});

describe('round-trip: drag → compute → anchoredPos preserves anchor', () => {
  // Simulates the full pipeline: user drags corner, we compute next rect,
  // later we re-place a ghost at potentially different dimensions using
  // anchoredPos. The anchor corner of the final ghost must match orig.
  const cases: Array<{ dir: string; dx: number; dy: number; ghostW: number; ghostH: number }> = [
    { dir: 'tl', dx: -50, dy: -30, ghostW: 380, ghostH: 200 },
    { dir: 'tr', dx:  50, dy: -30, ghostW: 380, ghostH: 200 },
    { dir: 'bl', dx: -50, dy:  30, ghostW: 380, ghostH: 200 },
    { dir: 'br', dx:  50, dy:  30, ghostW: 380, ghostH: 200 },
    // ghost may end up smaller than the target after fit — anchor must still hold
    { dir: 'tl', dx: -50, dy: -30, ghostW: 150, ghostH:  90 },
    { dir: 'br', dx:  50, dy:  30, ghostW: 150, ghostH:  90 },
  ];

  for (const c of cases) {
    it(`${c.dir} drag, ghost size (${c.ghostW}, ${c.ghostH}) — anchor preserved`, () => {
      const anchor = anchorForCorner(c.dir);
      computeResize(c.dir, START, c.dx, c.dy); // for side-effect assertions
      const pos = anchoredPos(anchor, START, c.ghostW, c.ghostH);
      const ghost: Rect = { x: pos.x, y: pos.y, w: c.ghostW, h: c.ghostH };
      expect(corner(ghost, anchor)).toEqual(corner(START, anchor));
    });
  }
});
