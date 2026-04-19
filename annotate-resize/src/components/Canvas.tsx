import { useState, useRef } from 'react';
import type { RefObject } from 'react';
import type { PanzoomObject } from '@panzoom/panzoom';
import type { Box, PopoverKind, FitMode, SnapCandidate } from '../types';
import { BoxComponent } from './BoxComponent';
import { SelectionOverlay } from './SelectionOverlay';
import { GhostBox } from './GhostBox';
import { computeResize, anchorForCorner, assertAnchorShared } from '../geometry';

interface Props {
  boxes: Box[];
  selectedId: string | null;
  popover: { boxId: string; kind: PopoverKind } | null;
  panzoomRef: RefObject<PanzoomObject | null>;
  onSelect: (id: string) => void;
  onUpdateBox: (id: string, updater: (b: Box) => Box) => void;
  onTogglePopover: (boxId: string, kind: PopoverKind) => void;
  onClosePopover: () => void;
  onRunResize: (boxId: string, newArea: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; origX: number; origY: number; origW: number; origH: number; anchor: import('../types').AnchorCorner }) => void;
  onMerge: (dragged: Box, candidate: SnapCandidate) => void;
  onScissor: (boxId: string) => void;
  onStitch: (boxId: string) => void;
  onAcceptRewrite: (boxId: string) => void;
  onRejectRewrite: (boxId: string) => void;
  onToggleRewriteTop: (boxId: string) => void;
  onSpanSelected: (boxId: string, start: number, end: number, screenX: number, screenY: number) => void;
  activeSpan: { boxId: string; start: number; end: number; shakeActive?: boolean } | null;
  onShakeDetected: (boxId: string) => void;
  onAcceptSpanDiff: (boxId: string) => void;
  onRejectSpanDiff: (boxId: string) => void;
  onHeaderShake: (boxId: string, anchor: { x: number; y: number }) => void;
  fitMode: FitMode;
  toast: (msg: string, kind?: string) => void;
}

export function Canvas({ boxes, selectedId, popover, panzoomRef, onSelect, onUpdateBox,
                         onTogglePopover, onClosePopover, onRunResize, onMerge, onScissor, onStitch, onAcceptRewrite, onRejectRewrite, onToggleRewriteTop, onSpanSelected, activeSpan, onShakeDetected, onAcceptSpanDiff, onRejectSpanDiff, onHeaderShake, fitMode }: Props) {
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
            onSpanSelected={(s, e, sx, sy) => onSpanSelected(b.id, s, e, sx, sy)}
            activeSpan={activeSpan?.boxId === b.id ? { start: activeSpan.start, end: activeSpan.end, shakeActive: activeSpan.shakeActive } : undefined}
            onShakeDetected={() => onShakeDetected(b.id)}
            onAcceptSpanDiff={() => onAcceptSpanDiff(b.id)}
            onRejectSpanDiff={() => onRejectSpanDiff(b.id)}
            onHeaderShake={anchor => onHeaderShake(b.id, anchor)}
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
          onRetry={() => onRunResize(selectedBox.id, selectedBox.w * selectedBox.h, { nx: selectedBox.x, ny: selectedBox.y, nw: selectedBox.w, nh: selectedBox.h, origX: selectedBox.x, origY: selectedBox.y, origW: selectedBox.w, origH: selectedBox.h, anchor: 'tl' })}
          box={selectedBox}
          popover={popover?.boxId === selectedBox.id ? popover.kind : null}
          onTogglePopover={kind => onTogglePopover(selectedBox.id, kind)}
          onClosePopover={onClosePopover}
          onUpdate={updater => onUpdateBox(selectedBox.id, updater)}
          onStartResize={(dir, e) => startResize(e, selectedBox, dir, onUpdateBox, onRunResize, worldDelta, (id) => fitFns.current.get(id)?.())}
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
  onRunResize: (boxId: string, area: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; origX: number; origY: number; origW: number; origH: number; anchor: import('../types').AnchorCorner }) => void,
  worldDelta: (dx: number, dy: number) => { dx: number; dy: number },
  onEdgeResizeDone: (boxId: string) => void,
) {
  e.preventDefault();
  e.stopPropagation();
  const startRect = { x: box.x, y: box.y, w: box.w, h: box.h };
  const startArea = box.w * box.h;
  const startPointer = { x: e.clientX, y: e.clientY };

  const move = (ev: PointerEvent) => {
    const { dx, dy } = worldDelta(ev.clientX - startPointer.x, ev.clientY - startPointer.y);
    const next = computeResize(dir, startRect, dx, dy);
    onUpdateBox(box.id, b => ({ ...b, x: next.x, y: next.y, w: next.w, h: next.h }));
  };

  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const { dx } = worldDelta(ev.clientX - startPointer.x, 0);
    const { dy } = worldDelta(0, ev.clientY - startPointer.y);
    const next = computeResize(dir, startRect, dx, dy);
    const endArea = next.w * next.h;
    const isCorner = dir.length === 2;
    if (isCorner && Math.abs(endArea - startArea) / startArea >= 0.05) {
      const anchor = anchorForCorner(dir);
      // pendingRewrite contract: the anchor corner of (orig) and (target) must be shared
      assertAnchorShared(anchor, startRect, next);
      onRunResize(box.id, endArea, {
        nx: next.x, ny: next.y, nw: next.w, nh: next.h,
        origX: startRect.x, origY: startRect.y, origW: startRect.w, origH: startRect.h,
        anchor,
      });
    } else if (!isCorner) {
      // edge resize: no LLM call, but trigger fit to prevent overflow
      onEdgeResizeDone(box.id);
    }
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
