import { useEffect, useRef, useState } from 'react';
import type { PendingRewrite } from '../types';

interface Props {
  pending: PendingRewrite;
  onAccept: () => void;
  onReject: () => void;
  onToggle: () => void;
  fontSize: number;
}

// Anchor corner → which corner coords to compute for control placement
function anchorPoint(p: PendingRewrite, useTarget: boolean) {
  const x = useTarget ? p.targetX : p.origX;
  const y = useTarget ? p.targetY : p.origY;
  const w = useTarget ? p.targetW : p.origW;
  const h = useTarget ? p.targetH : p.origH;
  switch (p.anchor) {
    case 'tl': return { cx: x, cy: y };
    case 'tr': return { cx: x + w, cy: y };
    case 'bl': return { cx: x, cy: y + h };
    case 'br': return { cx: x + w, cy: y + h };
  }
}

export function GhostBox({ pending, onAccept, onReject, onToggle, fontSize }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [animating, setAnimating] = useState(true);
  const [dims, setDims] = useState({ x: pending.origX, y: pending.origY, w: pending.origW, h: pending.origH });

  // animate from orig → target on mount
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      setDims({ x: pending.targetX, y: pending.targetY, w: pending.targetW, h: pending.targetH });
      const t = setTimeout(() => setAnimating(false), 220);
      return () => clearTimeout(t);
    });
    return () => cancelAnimationFrame(raf);
  }, [pending.targetX, pending.targetY, pending.targetW, pending.targetH]);

  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.value = pending.text;
    ta.scrollTop = 0;

    // fit ghost box to content — same logic as fitWiden in BoxComponent
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
      setDims(d => ({ ...d, w: maxW, h: Math.max(80, needed + 22 + 2) }));
    } else {
      setDims(d => ({ ...d, w: newW }));
    }
  }, [pending.text, pending.targetH]);

  const isGhostOnTop = pending.topBox === 'ghost';
  const ctrlPt = anchorPoint(pending, false); // controls at anchor on original

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
          <span>proposed rewrite</span>
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
