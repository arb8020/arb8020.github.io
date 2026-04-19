import type {} from 'react';
import type { RefObject } from 'react';
import type { PanzoomObject } from '@panzoom/panzoom';
import type { Box, PopoverKind, FitMode } from '../types';
import { BoxComponent } from './BoxComponent';
import { SelectionOverlay } from './SelectionOverlay';

interface Props {
  boxes: Box[];
  selectedId: string | null;
  popover: { boxId: string; kind: PopoverKind } | null;
  panzoomRef: RefObject<PanzoomObject | null>;
  onSelect: (id: string) => void;
  onUpdateBox: (id: string, updater: (b: Box) => Box) => void;
  onTogglePopover: (boxId: string, kind: PopoverKind) => void;
  onClosePopover: () => void;
  onRunResize: (boxId: string, newArea: number) => void;
  fitMode: FitMode;
  toast: (msg: string, kind?: string) => void;
}

export function Canvas({ boxes, selectedId, popover, panzoomRef, onSelect, onUpdateBox,
                         onTogglePopover, onClosePopover, onRunResize, fitMode }: Props) {
  const getScale = () => panzoomRef.current?.getScale() ?? 1;
  const worldDelta = (dxScreen: number, dyScreen: number) => ({ dx: dxScreen / getScale(), dy: dyScreen / getScale() });

  const selectedBox = boxes.find(b => b.id === selectedId) ?? null;

  return (
    <>
      {boxes.map(b => (
        <BoxComponent
          key={b.id}
          box={b}
          isSelected={b.id === selectedId}
          panzoomRef={panzoomRef}
          onSelect={() => { onSelect(b.id); onClosePopover(); }}
          onUpdate={updater => onUpdateBox(b.id, updater)}
          onRunResize={area => onRunResize(b.id, area)}
          fitMode={fitMode}
          worldDelta={worldDelta}
        />
      ))}

      {selectedBox && (
        <SelectionOverlay
          onRetry={() => onRunResize(selectedBox.id, selectedBox.w * selectedBox.h)}
          box={selectedBox}
          popover={popover?.boxId === selectedBox.id ? popover.kind : null}
          onTogglePopover={kind => onTogglePopover(selectedBox.id, kind)}
          onClosePopover={onClosePopover}
          onUpdate={updater => onUpdateBox(selectedBox.id, updater)}
          onStartResize={(dir, e) => startResize(e, selectedBox, dir, onUpdateBox, onRunResize, worldDelta)}
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
  onRunResize: (boxId: string, area: number) => void,
  worldDelta: (dx: number, dy: number) => { dx: number; dy: number },
) {
  e.preventDefault();
  e.stopPropagation();
  const startArea = box.w * box.h;
  const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y, bw: box.w, bh: box.h };
  const minW = 120, minH = 80;

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
    let nw = start.bw, nh = start.bh;
    if (dir.includes('l')) nw = start.bw - dx;
    if (dir.includes('r')) nw = start.bw + dx;
    if (dir.includes('t')) nh = start.bh - dy;
    if (dir.includes('b')) nh = start.bh + dy;
    nw = Math.max(minW, nw); nh = Math.max(minH, nh);
    const endArea = nw * nh;
    if (Math.abs(endArea - startArea) / startArea >= 0.05) onRunResize(box.id, endArea);
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
