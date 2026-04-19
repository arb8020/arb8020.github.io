export interface Version {
  id: string;
  text: string;
  parentId: string | null;
  targetPct: number;
  included: boolean;
  annotation: string;
}

export interface MergedSlot {
  // snapshot of the source box at merge time
  sourceId: string;
  originalX: number;
  originalY: number;
  originalW: number;
  originalH: number;
  versions: Version[];
  currentVid: string | null;
  calibChars: number;
  calibArea: number;
  annotation: string;
  fontSize: number;
  // text at merge time — used to detect edits before split
  textAtMerge: string;
}

export interface MergedState {
  axis: 'v' | 'h'; // vertical (top/bottom) or horizontal (left/right) snap
  stitched: boolean;
  slotA: MergedSlot;
  slotB: MergedSlot;
}

export interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  versions: Version[];
  currentVid: string | null;
  calibChars: number;
  calibArea: number;
  annotation: string;
  fontSize: number;
  merged?: MergedState; // present only on merged boxes
  density?: DensityState; // present after density scoring
  pendingRewrite?: PendingRewrite;
}

// anchor corner is the corner opposite the dragged corner — stays fixed during resize
export type AnchorCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface PendingRewrite {
  text: string;
  // ghost target geometry (what user dragged to)
  targetX: number;
  targetY: number;
  targetW: number;
  targetH: number;
  // original geometry (ghost animates from here)
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  // anchor corner (opposite of dragged corner)
  anchor: AnchorCorner;
  // which box is on top: 'original' | 'ghost'
  topBox: 'original' | 'ghost';
}

export type FitMode = 'widen' | 'shrink'; // widen: box grows width to fit; shrink: font shrinks to fit
export type PopoverKind = 'annotation' | 'versions' | null;
export type DensityVisual = 'heatmap' | 'opacity';

export interface DensitySpan {
  start: number; // char offset
  end: number;
  score: number; // 0–1
}

export interface DensityState {
  spans: DensitySpan[];
  visual: DensityVisual;
}

// Candidate snap while dragging: which box to snap to, which edges, and axis
export interface SnapCandidate {
  targetId: string;
  // which edge of dragged box → which edge of target
  dragEdge: 'T' | 'B' | 'L' | 'R';
  targetEdge: 'T' | 'B' | 'L' | 'R';
  axis: 'v' | 'h';
  // world-coords of snap point on target (for ghost rendering)
  ghostX: number;
  ghostY: number;
  ghostW: number;
  ghostH: number;
}
