import { useState, useRef } from 'react';
import type { RefObject } from 'react';
import type { PanzoomObject } from '@panzoom/panzoom';
import type { Box, PopoverKind, FitMode, SnapCandidate } from '../types';
import { BoxComponent } from './BoxComponent';
import { SelectionOverlay } from './SelectionOverlay';
import { GhostBox } from './GhostBox';

interface Props {
  boxes: Box[];
  selectedId: string | null;
  popover: { boxId: string; kind: PopoverKind } | null;
  panzoomRef: RefObject<PanzoomObject | null>;
  onSelect: (id: string) => void;
  onUpdateBox: (id: string, updater: (b: Box) => Box) => void;
  onTogglePopover: (boxId: string, kind: PopoverKind) => void;
  onClosePopover: () => void;
  onRunResize: (boxId: string, newArea: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; anchor: import('../types').AnchorCorner }) => void;
  onMerge: (dragged: Box, candidate: SnapCandidate) => void;
  onScissor: (boxId: string) => void;
  onStitch: (boxId: string) => void;
  onRunDensity: (boxId: string) => void;
  onAcceptRewrite: (boxId: string) => void;
  onRejectRewrite: (boxId: string) => void;
  onToggleRewriteTop: (boxId: string) => void;
  fitMode: FitMode;
  toast: (msg: string, kind?: string) => void;
}

export function Canvas({ boxes, selectedId, popover, panzoomRef, onSelect, onUpdateBox,
                         onTogglePopover, onClosePopover, onRunResize, onMerge, onScissor, onStitch, onRunDensity, onAcceptRewrite, onRejectRewrite, onToggleRewriteTop, fitMode }: Props) {
  const [snapCandidate, setSnapCandidate] = useState<SnapCandidate | null>(null);
  const fitFns = useRef<Map<string, () => void>>(new Map());
  const getScale = () => panzoomRef.current?.getScale() ?? 1;
  const worldDelta = (dxScreen: number, dyScreen: number) => ({ dx: dxScreen / getScale(), dy: dyScreen / getScale() });

  const selectedBox = boxes.find(b => b.id === selectedId) ?? null;

  return (
    <>
      {boxes.map(b => {
        return (
          <BoxComponent
            key={b.id}
            box={b}
            onScissor={() => onScissor(b.id)}
            onStitch={() => onStitch(b.id)}
            isSelected={b.id === selectedId}
            allBoxes={boxes}
            panzoomRef={panzoomRef}
            onSelect={() => { onSelect(b.id); onClosePopover(); }}
            onUpdate={updater => onUpdateBox(b.id, updater)}
            onRunResize={area => onRunResize(b.id, area)}
            fitMode={fitMode}
            worldDelta={worldDelta}
            onSnapCandidate={setSnapCandidate}
            onSnap={(dragged, candidate) => onMerge({ ...dragged }, candidate)}
            registerFit={fn => fitFns.current.set(b.id, fn)}
          />
        );
      })}

      {/* pending rewrite ghost boxes */}
      {boxes.filter(b => b.pendingRewrite).map(b => (
        <GhostBox
          key={`ghost-${b.id}`}
          pending={b.pendingRewrite!}
          fontSize={b.fontSize}
          onAccept={() => onAcceptRewrite(b.id)}
          onReject={() => onRejectRewrite(b.id)}
          onToggle={() => onToggleRewriteTop(b.id)}
        />
      ))}

      {/* snap ghost overlay */}
      {snapCandidate && (
        <>
          {/* ghost merged box outline */}
          <div style={{
            position: 'absolute', pointerEvents: 'none', zIndex: 25,
            left: snapCandidate.ghostX, top: snapCandidate.ghostY,
            width: snapCandidate.ghostW, height: snapCandidate.ghostH,
            border: '1.5px dashed var(--accent)', borderRadius: 6,
            background: 'rgba(45,127,249,0.04)',
          }} />
          {/* anchor dot on target box */}
          {(() => {
            const target = boxes.find(b => b.id === snapCandidate.targetId);
            if (!target) return null;
            const edges = {
              T: [target.x + target.w / 2, target.y],
              B: [target.x + target.w / 2, target.y + target.h],
              L: [target.x, target.y + target.h / 2],
              R: [target.x + target.w, target.y + target.h / 2],
            } as Record<string, [number, number]>;
            const [ex, ey] = edges[snapCandidate.targetEdge];
            return (
              <div style={{
                position: 'absolute', pointerEvents: 'none', zIndex: 26,
                left: ex - 6, top: ey - 6, width: 12, height: 12,
                borderRadius: '50%', background: 'var(--accent)',
                boxShadow: '0 0 0 3px rgba(45,127,249,0.3)',
              }} />
            );
          })()}
        </>
      )}

      {selectedBox && (
        <SelectionOverlay
          onRetry={() => onRunResize(selectedBox.id, selectedBox.w * selectedBox.h, { nx: selectedBox.x, ny: selectedBox.y, nw: selectedBox.w, nh: selectedBox.h, anchor: 'tl' })}
          box={selectedBox}
          popover={popover?.boxId === selectedBox.id ? popover.kind : null}
          onTogglePopover={kind => onTogglePopover(selectedBox.id, kind)}
          onClosePopover={onClosePopover}
          onUpdate={updater => onUpdateBox(selectedBox.id, updater)}
          onStartResize={(dir, e) => startResize(e, selectedBox, dir, onUpdateBox, onRunResize, worldDelta, (id) => fitFns.current.get(id)?.())}
          onRunDensity={() => onRunDensity(selectedBox.id)}
        />
      )}
    </>
  );
}

function startResize(
  e: React.PointerEvent,
  box: Box,
  dir: string,
  onUpdateBox: (id: string, updater: (b: Box) => Box) => void,
  onRunResize: (boxId: string, area: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; anchor: import('../types').AnchorCorner }) => void,
  worldDelta: (dx: number, dy: number) => { dx: number; dy: number },
  onEdgeResizeDone: (boxId: string) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const startArea = box.w * box.h;
  const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y, bw: box.w, bh: box.h };
  const minW = 120, minH = 80;

  // anchor = opposite corner to dragged corner
  const anchorMap: Record<string, import('../types').AnchorCorner> = {
    br: 'tl', tl: 'br', tr: 'bl', bl: 'tr',
  };

  const move = (ev: PointerEvent) => {
    const { dx, dy } = worldDelta(ev.clientX - start.x, ev.clientY - start.y);
    let nx = start.bx, ny = start.by, nw = start.bw, nh = start.bh;
    if (dir.includes('l')) { nx = start.bx + dx; nw = start.bw - dx; }
    if (dir.includes('r')) { nw = start.bw + dx; }
    if (dir.includes('t')) { ny = start.by + dy; nh = start.bh - dy; }
    if (dir.includes('b')) { nh = start.bh + dy; }
    if (nw < minW) { if (dir.includes('l')) nx -= (minW - nw); nw = minW; }
    if (nh < minH) { if (dir.includes('t')) ny -= (minH - nh); nh = minH; }
    onUpdateBox(box.id, b => ({ ...b, x: nx, y: ny, w: nw, h: nh }));
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const dx = worldDelta(ev.clientX - start.x, 0).dx;
    const dy = worldDelta(0, ev.clientY - start.y).dy;
    let nx = start.bx, ny = start.by, nw = start.bw, nh = start.bh;
    if (dir.includes('l')) { nx = start.bx + dx; nw = start.bw - dx; }
    if (dir.includes('r')) { nw = start.bw + dx; }
    if (dir.includes('t')) { ny = start.by + dy; nh = start.bh - dy; }
    if (dir.includes('b')) { nh = start.bh + dy; }
    nw = Math.max(minW, nw); nh = Math.max(minH, nh);
    const endArea = nw * nh;
    const isCorner = dir.length === 2;
    if (isCorner && Math.abs(endArea - startArea) / startArea >= 0.05) {
      const anchor = anchorMap[dir] ?? 'tl';
      onRunResize(box.id, endArea, { nx, ny, nw, nh, anchor });
    } else if (!isCorner) {
      // edge resize: no LLM call, but trigger fit to prevent overflow
      onEdgeResizeDone(box.id);
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
