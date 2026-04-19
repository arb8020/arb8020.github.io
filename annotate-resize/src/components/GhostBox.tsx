import { useEffect, useRef, useState } from 'react';
import type { PendingRewrite } from '../types';
import { anchoredPos as computeAnchoredPos, assertAnchorShared } from '../geometry';

interface Props {
  pending: PendingRewrite;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
  fontSize: number;
}

// Dragged corner = opposite of anchor, computed on the ghost's final dims
function draggedCornerPoint(p: PendingRewrite, ghostX: number, ghostY: number, ghostW: number, ghostH: number) {
  switch (p.anchor) {
    case 'tl': return { cx: ghostX + ghostW, cy: ghostY + ghostH }; // br
    case 'tr': return { cx: ghostX,          cy: ghostY + ghostH }; // bl
    case 'bl': return { cx: ghostX + ghostW, cy: ghostY };          // tr
    case 'br': return { cx: ghostX,          cy: ghostY };          // tl
  }
}

export function GhostBox({ pending, onAccept, onReject, onToggle, fontSize }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [animating, setAnimating] = useState(true);
  const [dims, setDims] = useState({ x: pending.origX, y: pending.origY, w: pending.origW, h: pending.origH }); // starts at orig dims, anchored position computed on mount

  // compute ghost position so anchor corner is shared with original box.
  // curries the orig rect + anchor from `pending`; asserts anchor is shared.
  const anchoredPos = (w: number, h: number) => {
    const orig = { x: pending.origX, y: pending.origY, w: pending.origW, h: pending.origH };
    const pos = computeAnchoredPos(pending.anchor, orig, w, h);
    assertAnchorShared(pending.anchor, orig, { x: pos.x, y: pos.y, w, h });
    return pos;
  };

  // animate from orig → target on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const pos = anchoredPos(pending.targetW, pending.targetH);
      setDims({ x: pos.x, y: pos.y, w: pending.targetW, h: pending.targetH });
      const t = setTimeout(() => setAnimating(false), 220);
      return () => clearTimeout(t);
    });
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending.targetW, pending.targetH]);

  // set text immediately
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = pending.text;
    ta.scrollTop = 0;
  }, [pending.text]);

  // fit after animation settles — 230ms to ensure transition is done
  useEffect(() => {
    const timer = setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      const minW = 120, maxW = 1200;
      const availH = pending.targetH - 22;
      let lo = minW, hi = maxW;
      while (hi - lo > 4) {
        const mid = Math.round((lo + hi) / 2);
        ta.style.width = mid + 'px';
        if (ta.scrollHeight <= availH) { hi = mid; } else { lo = mid; }
      }
      ta.style.width = '';
      const newW = Math.min(maxW, hi + 2);
      if (newW >= maxW) {
        ta.style.width = maxW + 'px';
        ta.style.height = '1px';
        const needed = ta.scrollHeight;
        ta.style.height = '';
        ta.style.width = '';
        const fittedH = Math.max(80, needed + 22 + 2);
        // width/height changed — recompute anchored position so the anchor
        // corner stays glued to the original box's anchor corner.
        const pos = anchoredPos(maxW, fittedH);
        setDims({ x: pos.x, y: pos.y, w: maxW, h: fittedH });
      } else if (newW !== pending.targetW) {
        // width changed — recompute anchored x; height unchanged.
        setDims(d => {
          const pos = anchoredPos(newW, d.h);
          return { ...d, x: pos.x, w: newW };
        });
      }
      ta.scrollTop = 0;
    }, 230);
    return () => clearTimeout(timer);
  }, [pending.targetW, pending.targetH]); // only re-fit if target dims change, not on every text change

  const isGhostOnTop = pending.topBox === 'ghost';
  const ctrlPt = draggedCornerPoint(pending, dims.x, dims.y, dims.w, dims.h);

  return (
    <>
      {/* ghost box */}
      <div style={{
        position: 'absolute',
        left: dims.x, top: dims.y, width: dims.w, height: dims.h,
        background: 'var(--panel)',
        border: '1.5px dashed var(--accent)',
        borderRadius: 6,
        boxShadow: '0 1px 6px rgba(45,127,249,0.15)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        zIndex: isGhostOnTop ? 12 : 8,
        opacity: isGhostOnTop ? 1 : 0.35,
        transition: animating
          ? 'left 0.22s cubic-bezier(0.34,1.56,0.64,1), top 0.22s cubic-bezier(0.34,1.56,0.64,1), width 0.22s cubic-bezier(0.34,1.56,0.64,1), height 0.22s cubic-bezier(0.34,1.56,0.64,1)'
          : 'opacity 0.15s',
        pointerEvents: isGhostOnTop ? 'auto' : 'none',
      }}>
        <div style={{
          height: 22, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(45,127,249,0.08)', borderBottom: '1px solid rgba(45,127,249,0.2)',
          flexShrink: 0, fontSize: 11, color: 'var(--accent)', userSelect: 'none',
        }}>
          <span>proposed</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, fontSize: 10, color: 'rgba(45,127,249,0.7)', fontVariantNumeric: 'tabular-nums' }}>
            <span title="original">{pending.originalChars}c</span>
            <span>→</span>
            <span title="intended">{pending.targetChars}c</span>
            <span>→</span>
            <span title="proposed" style={{ color: 'var(--accent)', fontWeight: 600 }}>{pending.text.length}c</span>
          </span>
        </div>
        <textarea
          ref={taRef}
          readOnly
          style={{
            flex: 1, width: '100%', border: 'none', outline: 'none', resize: 'none',
            padding: '10px 12px', background: 'transparent', color: 'var(--text)',
            font: `${fontSize}px/1.5 -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`,
            cursor: 'default',
          }}
        />
      </div>

      {/* controls float at the anchor corner */}
      <div style={{
        position: 'absolute',
        left: ctrlPt.cx - 52,
        top: ctrlPt.cy - 14,
        display: 'flex', gap: 4, alignItems: 'center',
        zIndex: 30,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '3px 6px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        userSelect: 'none',
      }}>
        <CtrlBtn color="var(--ok)" title="accept rewrite" onClick={onAccept}>✓</CtrlBtn>
        <CtrlBtn color="var(--warn)" title="reject rewrite" onClick={onReject}>✕</CtrlBtn>
        <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', margin: '1px 2px' }} />
        <CtrlBtn color="var(--accent)" title="toggle original / rewrite" onClick={onToggle}>
          {isGhostOnTop ? '⊙' : '○'}
        </CtrlBtn>
        {/* TODO(ghost-retry): add ↺ retry button here.
            Clicking ↺ expands a small input field inline in the controls bar:
              [ ↺  extra instructions (optional)... ] [→ retry]
            User can type or leave blank, then hit Enter or click →.
            On submit: fires onRetry(instruction: string) up to App.
            App.runResize is called again with the extra instruction appended to the prompt:
              if (instruction) vars['extra_instruction'] = instruction;
              and DEFAULT_TMPL gains an optional {{extra_instruction}} placeholder.
            The new ghost replaces the old one (same ghost geometry, new text).
            This replaces the old box-level annotation pill entirely — intent lives at point of action. */}
      </div>
    </>
  );
}

function CtrlBtn({ color, title, onClick, children }: { color: string; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onPointerDown={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: 600, color, padding: '0 2px', lineHeight: 1,
      }}
    >{children}</button>
  );
}
