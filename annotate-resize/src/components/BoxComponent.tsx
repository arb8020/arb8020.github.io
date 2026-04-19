import { useRef, useEffect, useCallback } from 'react';
import type { RefObject } from 'react';
import type { PanzoomObject } from '@panzoom/panzoom';
import type { Box, FitMode } from '../types';

interface Props {
  box: Box;
  isSelected: boolean;
  panzoomRef?: RefObject<PanzoomObject | null>;
  onSelect: () => void;
  onUpdate: (updater: (b: Box) => Box) => void;
  onRunResize: (area: number) => void;
  fitMode: FitMode;
  worldDelta: (dx: number, dy: number) => { dx: number; dy: number };
}

export function BoxComponent({ box, isSelected: _, onSelect, onUpdate, fitMode, worldDelta }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // fit helpers
  const fitGrow = useCallback(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.fontSize = '14px';
    ta.style.height = 'auto';
    const needed = ta.scrollHeight;
    ta.style.height = '';
    const newH = Math.max(80, needed + 22 + 2);
    onUpdate(b => ({ ...b, h: newH, fontSize: 14 }));
  }, [onUpdate]);

  const fitShrink = useCallback(() => {
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

  const autoFit = useCallback(() => {
    if (fitMode === 'shrink') requestAnimationFrame(fitShrink);
    else fitGrow();
  }, [fitMode, fitGrow, fitShrink]);

  // sync textarea value when currentVid changes
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const v = box.versions.find(x => x.id === box.currentVid);
    const text = v ? v.text : '';
    if (ta.value !== text) { ta.value = text; ta.style.fontSize = box.fontSize + 'px'; }
  }, [box.currentVid, box.versions, box.fontSize]);

  const handleDragHeader = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const start = { x: e.clientX, y: e.clientY, bx: box.x, by: box.y };
    const move = (ev: PointerEvent) => {
      const { dx, dy } = worldDelta(ev.clientX - start.x, ev.clientY - start.y);
      onUpdate(b => ({ ...b, x: start.bx + dx, y: start.by + dy }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const handleInput = () => {
    const ta = taRef.current;
    if (!ta) return;
    const text = ta.value;
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

  const handlePaste = () => {
    requestAnimationFrame(() => {
      handleInput();
      autoFit();
    });
  };

  // pan with panzoom on middle-mouse / space+drag on the viewport — nothing needed here

  return (
    <div
      className="box"
      style={{
        position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h,
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}
      onPointerDown={e => { if (e.button !== 0) return; onSelect(); e.stopPropagation(); }}
    >
      <div
        className="header"
        style={{
          height: 22, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--panel-2)', borderBottom: '1px solid var(--border)',
          cursor: 'grab', userSelect: 'none', fontSize: 11, color: 'var(--muted)',
        }}
        onPointerDown={handleDragHeader}
      >
        <span>{box.id}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)' }}>
          {(box as any)._status || ''}
        </span>
      </div>
      <textarea
        ref={taRef}
        className="main"
        placeholder="paste or type text…"
        style={{
          flex: 1, width: '100%', border: 'none', outline: 'none', resize: 'none',
          padding: '10px 12px', background: 'transparent', color: 'var(--text)',
          font: `${box.fontSize}px/1.5 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`,
        }}
        onInput={handleInput}
        onPaste={handlePaste}
      />
    </div>
  );
}
