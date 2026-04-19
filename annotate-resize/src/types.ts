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

  // TODO(span-ops): add to Box:
  //   lockedSpans?: LockedSpan[]   — spans excluded from LLM rewrites
  //   strikethroughSpans?: StrikethroughSpan[]  — user-marked deletions
  //   shakeResults?: ShakeResult   — alternative phrasings for a highlighted span
  //
  // LockedSpan: { start, end, text }
  //   - When present, resize/rewrite prompts append:
  //     "Do not modify the following spans: [list of locked text]"
  //   - Rendered as a subtle underline (e.g. dotted green) via DensityOverlay-style canvas layer
  //   - UI: select text → floating mini-toolbar appears (see SelectionOverlay TODO) → click lock icon
  //
  // StrikethroughSpan: { start, end }
  //   - Rendered as red strikethrough via canvas overlay (same layer as density)
  //   - Optional LLM annotation: "what would this piece lose without this span?"
  //     Prompt: "The following text has been struck through by the author: '{{span_text}}'
  //              Full context: '{{box_text}}'
  //              In 1-2 sentences, what does this piece lose without it? Be specific."
  //     Result shown as a tooltip/margin note on hover
  //
  // ShakeResult: { start, end, originalText, alternatives: string[] }
  //   - Alternatives shown as a popover with accept-per-item buttons
  //   - Prompt: "Give 3-5 alternative phrasings for the following span.
  //              Full context: '{{box_text}}'
  //              Span to rephrase: '{{span_text}}'
  //              Reply as a JSON array of strings. No explanation."
  //   - Accepting replaces span in current version text (new version pushed)
}

// anchor corner is the corner opposite the dragged corner — stays fixed during resize
export type AnchorCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface PendingRewrite {
  text: string;
  originalChars: number; // char count of current version before rewrite
  targetChars: number;   // char count the user asked for (area ratio)
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
export type PopoverKind = 'annotation' | 'versions' | 'translate' | null;
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
