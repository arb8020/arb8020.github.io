import { useRef, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import type { PanzoomObject } from '@panzoom/panzoom';
import type { Box, FitMode, SnapCandidate } from '../types';
import { DensityOverlay } from './DensityOverlay';
import { SpanOverlay } from './SpanOverlay';
import { prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline';

const SNAP_THRESHOLD = 28; // world coords

interface Props {
  box: Box;
  isSelected: boolean;
  allBoxes: Box[];
  panzoomRef?: RefObject<PanzoomObject | null>;
  onSelect: () => void;
  onUpdate: (updater: (b: Box) => Box) => void;
  onRunResize: (area: number) => void;
  fitMode: FitMode;
  worldDelta: (dx: number, dy: number) => { dx: number; dy: number };
  onSnapCandidate: (c: SnapCandidate | null) => void;
  onSnap: (dragged: Box, candidate: SnapCandidate) => void;
  onScissor: () => void;
  onStitch: () => void;
  registerFit: (fn: () => void) => void;
  onSpanSelected: (start: number, end: number, screenX: number, screenY: number) => void;
  activeSpan?: { start: number; end: number; shakeActive?: boolean };
  onShakeDetected?: () => void;
  onAcceptSpanDiff?: () => void;
  onRejectSpanDiff?: () => void;
}

// Returns the 4 edge midpoints of a box in world coords
function edgeMidpoints(b: Box): Record<'T' | 'B' | 'L' | 'R', [number, number]> {
  return {
    T: [b.x + b.w / 2, b.y],
    B: [b.x + b.w / 2, b.y + b.h],
    L: [b.x, b.y + b.h / 2],
    R: [b.x + b.w, b.y + b.h / 2],
  };
}

const OPPOSITE: Record<'T' | 'B' | 'L' | 'R', 'T' | 'B' | 'L' | 'R'> = { T: 'B', B: 'T', L: 'R', R: 'L' };
const EDGE_AXIS: Record<'T' | 'B' | 'L' | 'R', 'v' | 'h'> = { T: 'v', B: 'v', L: 'h', R: 'h' };

function dist([ax, ay]: [number, number], [bx, by]: [number, number]) {
  return Math.hypot(ax - bx, ay - by);
}

function computeGhost(dragged: Box, target: Box, dragEdge: 'T' | 'B' | 'L' | 'R', axis: 'v' | 'h'): { ghostX: number; ghostY: number; ghostW: number; ghostH: number } {
  if (axis === 'v') {
    const w = Math.max(dragged.w, target.w);
    const h = dragged.h + target.h;
    const x = Math.min(dragged.x, target.x);
    const y = dragEdge === 'B' ? target.y : dragged.y; // dragged below target → target on top
    return { ghostX: x, ghostY: y, ghostW: w, ghostH: h };
  } else {
    const h = Math.max(dragged.h, target.h);
    const w = dragged.w + target.w;
    const x = dragEdge === 'R' ? target.x : dragged.x;
    const y = Math.min(dragged.y, target.y);
    return { ghostX: x, ghostY: y, ghostW: w, ghostH: h };
  }
}

export function BoxComponent({ box, isSelected: _, allBoxes, onSelect, onUpdate, fitMode, worldDelta, onSnapCandidate, onSnap, onScissor, onStitch, registerFit, onSpanSelected, activeSpan, onShakeDetected, onAcceptSpanDiff, onRejectSpanDiff }: Props) {
  const taRefA = useRef<HTMLTextAreaElement>(null);
  const taRefB = useRef<HTMLTextAreaElement>(null);

  // register fit fn with Canvas so edge resize can trigger it explicitly
  useEffect(() => {
    registerFit(() => autoFit(taRefA));
  // registerFit is stable (ref setter), autoFit changes with fitMode — re-register when fitMode changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitMode]);

  const fitWiden = useCallback((taRef: React.RefObject<HTMLTextAreaElement | null>) => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.fontSize = '14px';
    const minW = 120, maxW = 1200;
    const availH = box.h - 22;
    // binary search minimum width where content fits without scrolling
    let lo = minW, hi = maxW;
    while (hi - lo > 4) {
      const mid = Math.round((lo + hi) / 2);
      ta.style.width = mid + 'px';
      if (ta.scrollHeight <= availH) { hi = mid; } else { lo = mid; }
    }
    ta.style.width = '';
    ta.scrollTop = 0;
    const newW = Math.min(maxW, hi + 2);

    if (newW >= maxW) {
      // couldn't fit at max width — grow height at maxW
      ta.style.width = maxW + 'px';
      ta.style.height = '1px';
      const needed = ta.scrollHeight;
      ta.style.height = '';
      ta.style.width = '';
      const newH = Math.max(80, needed + 22 + 2);
      onUpdate(b => ({ ...b, w: maxW, h: newH, fontSize: 14, calibArea: maxW * newH, calibChars: b.versions.find(v=>v.id===b.currentVid)?.text.length ?? b.calibChars }));
    } else if (newW !== box.w) {
      onUpdate(b => ({ ...b, w: newW, fontSize: 14, calibArea: newW * b.h, calibChars: b.versions.find(v=>v.id===b.currentVid)?.text.length ?? b.calibChars }));
    }
  }, [box.w, box.h, onUpdate]);

  const fitShrink = useCallback((taRef: React.RefObject<HTMLTextAreaElement | null>) => {
    const ta = taRef.current;
    if (!ta) return;
    let lo = 6, hi = 20, best = 6;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      ta.style.fontSize = mid + 'px';
      if (ta.scrollHeight <= ta.clientHeight + 1) { best = mid; lo = mid; } else { hi = mid; }
      if (hi - lo < 0.3) break;
    }
    const fs = Math.floor(best * 10) / 10;
    ta.style.fontSize = fs + 'px';
    onUpdate(b => ({ ...b, fontSize: fs }));
  }, [onUpdate]);

  const autoFit = useCallback((taRef: React.RefObject<HTMLTextAreaElement | null>) => {
    if (fitMode === 'shrink') requestAnimationFrame(() => fitShrink(taRef));
    else requestAnimationFrame(() => fitWiden(taRef));
  }, [fitMode, fitWiden, fitShrink]);

  // sync textarea value when the active version text changes (version switch, LLM result landing)
  // autoFit is called explicitly at the callsite that changes text — not reactively here
  useEffect(() => {
    if (box.merged && !box.merged.stitched) {
      const va = box.merged.slotA.versions.find(x => x.id === box.merged!.slotA.currentVid);
      const vb = box.merged.slotB.versions.find(x => x.id === box.merged!.slotB.currentVid);
      if (taRefA.current) taRefA.current.value = va?.text ?? '';
      if (taRefB.current) taRefB.current.value = vb?.text ?? '';
    } else {
      const ta = taRefA.current;
      if (!ta) return;
      const text = box.versions.find(x => x.id === box.currentVid)?.text ?? '';
      if (ta.value !== text) {
        ta.value = text;
        ta.style.fontSize = box.fontSize + 'px';
        ta.scrollTop = 0;
        autoFit(taRefA);
      }
    }
  }, [box.currentVid, box.versions, box.fontSize, box.merged]); // no pendingRewrite — ghost handles that

  const handleDragHeader = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y };
    let lastCandidate: SnapCandidate | null = null;

    const move = (ev: PointerEvent) => {
      const { dx, dy } = worldDelta(ev.clientX - start.x, ev.clientY - start.y);
      const nx = start.bx + dx, ny = start.by + dy;
      onUpdate(b => ({ ...b, x: nx, y: ny }));

      // snap detection — compare edge midpoints of moved box against all other boxes
      const movedBox = { ...box, x: nx, y: ny };
      const myEdges = edgeMidpoints(movedBox);
      let best: SnapCandidate | null = null;
      let bestDist = SNAP_THRESHOLD;

      for (const target of allBoxes) {
        if (target.id === box.id || target.merged) continue; // don't snap to merged boxes
        const theirEdges = edgeMidpoints(target);
        for (const dragEdge of ['T', 'B', 'L', 'R'] as const) {
          const targetEdge = OPPOSITE[dragEdge];
          const d = dist(myEdges[dragEdge], theirEdges[targetEdge]);
          if (d < bestDist) {
            bestDist = d;
            const axis = EDGE_AXIS[dragEdge];
            best = {
              targetId: target.id,
              dragEdge, targetEdge, axis,
              ...computeGhost(movedBox, target, dragEdge, axis),
            };
          }
        }
      }

      if (best?.targetId !== lastCandidate?.targetId || best?.dragEdge !== lastCandidate?.dragEdge) {
        lastCandidate = best;
        onSnapCandidate(best);
      }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (lastCandidate) {
        onSnap(box, lastCandidate);
        onSnapCandidate(null);
      } else {
        onSnapCandidate(null);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handleInput = (slot: 'A' | 'B') => {
    const taRef = slot === 'A' ? taRefA : taRefB;
    const ta = taRef.current;
    if (!ta) return;
    const text = ta.value;
    autoFit(taRef);

    if (box.merged && !box.merged.stitched) {
      onUpdate(b => {
        if (!b.merged) return b;
        const slotKey = slot === 'A' ? 'slotA' : 'slotB';
        const slotData = b.merged[slotKey];
        const versions = slotData.versions.map(v =>
          v.id === slotData.currentVid ? { ...v, text } : v
        );
        return { ...b, merged: { ...b.merged, [slotKey]: { ...slotData, versions } } };
      });
      return;
    }

    onUpdate(b => {
      if (b.versions.length === 0 && text.trim()) {
        return { ...b, versions: [{ id: 'v0', text, parentId: null, targetPct: 1, included: true, annotation: '' }],
                 currentVid: 'v0', calibChars: text.length, calibArea: b.w * b.h };
      }
      if (b.currentVid) {
        const versions = b.versions.map(v => v.id === b.currentVid ? { ...v, text } : v);
        return { ...b, versions, calibChars: b.currentVid === 'v0' ? text.length : b.calibChars };
      }
      return b;
    });
  };

  const handlePaste = (slot: 'A' | 'B') => {
    const taRef = slot === 'A' ? taRefA : taRefB;
    requestAnimationFrame(() => {
      handleInput(slot);
      autoFit(taRef);
    });
  };

  const isVertical = !box.merged || box.merged.axis === 'v';

  return (
    <div
      className="box"
      style={{
        position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        opacity: box.pendingRewrite?.topBox === 'ghost' ? 0.35 : 1,
        transition: 'opacity 0.15s',
        zIndex: box.pendingRewrite?.topBox === 'ghost' ? 8 : 10,
      }}
      onPointerDown={e => { if (e.button !== 0) return; onSelect(); e.stopPropagation(); }}
    >
      <div
        className="header"
        style={{
          height: 22, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--panel-2)', borderBottom: '1px solid var(--border)',
          cursor: 'grab', userSelect: 'none', fontSize: 11, color: 'var(--muted)',
          flexShrink: 0,
        }}
        onPointerDown={handleDragHeader}
      >
        <span>{box.id}</span>
        {(() => {
          const currentChars = box.versions.find(v => v.id === box.currentVid)?.text.length ?? 0;
          return <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 4 }}>{currentChars}c</span>;
        })()}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: box.pendingRewrite ? 'var(--accent)' : 'var(--muted)' }}>
          {box.pendingRewrite ? 'review rewrite' : ((box as any)._status || '')}
        </span>
      </div>

      {box.merged && !box.merged.stitched ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: isVertical ? 'column' : 'row', overflow: 'hidden' }}>
          <textarea
            ref={taRefA}
            className="main"
            style={taStyle(box.fontSize)}
            onInput={() => handleInput('A')}
            onPaste={() => handlePaste('A')}
          />
          <SeamBar axis={box.merged.axis} onScissor={onScissor} onStitch={onStitch} />
          <textarea
            ref={taRefB}
            className="main"
            style={taStyle(box.fontSize)}
            onInput={() => handleInput('B')}
            onPaste={() => handlePaste('B')}
          />
        </div>
      ) : (
        <>
          {box.density && (
            <DensityOverlay
              text={(() => { const v = box.versions.find(x => x.id === box.currentVid); return v?.text ?? ''; })()}
              spans={box.density.spans}
              visual={box.density.visual}
              width={box.w}
              height={box.h}
              fontSize={box.fontSize}
            />
          )}
          {(activeSpan || box.pendingSpanDiff) && (
            <SpanOverlay
              text={(() => { const v = box.versions.find(x => x.id === box.currentVid); return v?.text ?? ''; })()}
              fontSize={box.fontSize}
              width={box.w}
              height={box.h}
              selectionStart={activeSpan?.start}
              selectionEnd={activeSpan?.end}
              shakeActive={activeSpan?.shakeActive}
              onShakeDetected={onShakeDetected}
              pendingDiff={box.pendingSpanDiff}
              onAcceptDiff={onAcceptSpanDiff}
              onRejectDiff={onRejectSpanDiff}
            />
          )}
          <textarea
            ref={taRefA}
            className="main"
            placeholder="paste or type text…"
            style={{ ...taStyle(box.fontSize), position: 'relative', zIndex: 1, background: 'transparent' }}
            onInput={() => handleInput('A')}
            onPaste={() => handlePaste('A')}
            onMouseUp={e => {
              const ta = e.currentTarget;
              const { selectionStart: s, selectionEnd: end } = ta;
              if (s !== null && end !== null && s !== end) {
                const pos = getSelectionScreenPos(ta, s, end, box.fontSize);
                onSpanSelected(s, end, pos.x, pos.y);
              }
            }}
            onKeyUp={e => {
              const ta = e.currentTarget;
              const { selectionStart: s, selectionEnd: end } = ta;
              if (s !== null && end !== null && s !== end) {
                const pos = getSelectionScreenPos(ta, s, end, box.fontSize);
                onSpanSelected(s, end, pos.x, pos.y);
              }
            }}
          />
        </>
      )}
    </div>
  );
}


// Use pretext to find the screen position of a character offset in a textarea.
// Returns {x, y} where y is the TOP of the selection's first line (for placing toolbar above).
function getSelectionScreenPos(ta: HTMLTextAreaElement, start: number, end: number, fontSize: number): { x: number; y: number } {
  const rect = ta.getBoundingClientRect();
  const paddingLeft = 12, paddingTop = 10;
  const lineHeightPx = fontSize * 1.5;
  const maxWidth = rect.width - paddingLeft * 2;
  const text = ta.value;

  try {
    const font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`;
    const lines = text.split('\n');
    let charOffset = 0, lineY = paddingTop;

    for (const line of lines) {
      if (line.length === 0) { charOffset += 1; lineY += lineHeightPx; continue; }
      const tokens = line.match(/(\S+|\s+)/g) || [];
      const offsets: number[] = [];
      let pos = 0;
      for (const t of tokens) { offsets.push(pos); pos += t.length; }
      const items = tokens.map(t => ({ text: t, font }));
      const prepared = prepareRichInline(items);
      let found = false;
      let selStartX = paddingLeft, selEndX = paddingLeft;
      walkRichInlineLineRanges(prepared, maxWidth, (layoutLine: any) => {
        let curX = paddingLeft;
        for (const frag of layoutLine.fragments) {
          curX += frag.gapBefore;
          const fragStart = charOffset + offsets[frag.itemIndex];
          const fragEnd = fragStart + tokens[frag.itemIndex].length;
          const charW = frag.occupiedWidth / Math.max(1, tokens[frag.itemIndex].length);
          if (fragStart <= start && start < fragEnd) {
            selStartX = curX + (start - fragStart) * charW;
            found = true;
          }
          if (fragStart <= end && end <= fragEnd) {
            selEndX = curX + (end - fragStart) * charW;
          }
          curX += frag.occupiedWidth;
        }
        if (!found) lineY += lineHeightPx;
      });
      if (found) {
        const midX = rect.left + (selStartX + selEndX) / 2 - ta.scrollLeft;
        const topY = rect.top + lineY - ta.scrollTop;
        return { x: midX, y: topY };
      }
      charOffset += line.length + 1;
    }
  } catch { /* fall through to approximation */ }

  // fallback: center of textarea top
  return { x: rect.left + rect.width / 2, y: rect.top };
}

function taStyle(fontSize: number): React.CSSProperties {
  return {
    flex: 1, width: '100%', border: 'none', outline: 'none', resize: 'none',
    padding: '10px 12px', background: 'transparent', color: 'var(--text)',
    font: `${fontSize}px/1.5 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`,
    minHeight: 0,
  };
}

function SeamBar({ axis, onScissor, onStitch }: { axis: 'v' | 'h'; onScissor: () => void; onStitch: () => void }) {
  const isV = axis === 'v';
  return (
    <div style={{
      flexShrink: 0,
      position: 'relative',
      display: 'flex',
      flexDirection: isV ? 'row' : 'column',
      alignItems: 'center',
      justifyContent: 'center',
      [isV ? 'height' : 'width']: 1,
      [isV ? 'width' : 'height']: '100%',
      // the dashed line itself
      borderTop: isV ? '1.5px dashed var(--border)' : 'none',
      borderLeft: !isV ? '1.5px dashed var(--border)' : 'none',
      overflow: 'visible',
      zIndex: 2,
      userSelect: 'none',
    }}>
      {/* icons float centered on the line */}
      <div style={{
        position: 'absolute',
        display: 'flex',
        flexDirection: isV ? 'row' : 'column',
        alignItems: 'center',
        gap: 6,
        background: 'var(--panel)',
        padding: isV ? '0 4px' : '4px 0',
      }}>
        <SeamBtn title="split back into two boxes" onClick={onScissor}>✂</SeamBtn>
        <SeamBtn title="stitch into one paragraph" onClick={onStitch}>≋</SeamBtn>
      </div>
    </div>
  );
}

function SeamBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onPointerDown={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 14, color: 'var(--muted)', padding: '0 2px', lineHeight: 1,
        display: 'flex', alignItems: 'center',
      }}
    >{children}</button>
  );
}
