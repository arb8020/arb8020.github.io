import { useEffect, useRef, useCallback } from 'react';
import { buildCharRects, spanLineRects } from './pretext-utils';
import type { PendingSpanDiff } from '../types';

interface Props {
  text: string;
  fontSize: number;
  width: number;
  height: number;
  // active selection highlight
  selectionStart?: number;
  selectionEnd?: number;
  // shake mode: draggable highlight, gesture detection
  shakeActive?: boolean;
  onShakeDetected?: () => void;
  // span resize: drag handles on selection edges
  resizeActive?: boolean;
  // TODO(span-resize): wire onResizeStart/Move/End when implementing drag handles
  // onResizeStart?: (edge: 'left' | 'right') => void;
  // onResizeMove?: (charOffset: number) => void;
  // onResizeEnd?: () => void;
  // span diff
  pendingDiff?: PendingSpanDiff;
  onAcceptDiff?: () => void;
  onRejectDiff?: () => void;
  paddingTop?: number;
  paddingLeft?: number;
  lineHeight?: number;
}

const HEADER_H = 22;

export function SpanOverlay({
  text, fontSize, width, height,
  selectionStart, selectionEnd,
  shakeActive, onShakeDetected,
  resizeActive,
  pendingDiff, onAcceptDiff, onRejectDiff,
  paddingTop = 10, paddingLeft = 12, lineHeight = 1.5,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maxWidth = width - paddingLeft * 2;

  // Shake detection state
  const shakeRef = useRef<{ samples: { t: number; x: number }[]; dragging: boolean; startX: number; offsetX: number }>({
    samples: [], dragging: false, startX: 0, offsetX: 0,
  });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = (height - HEADER_H) * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height - HEADER_H);

    if (!text) return;
    const charRects = buildCharRects(text, fontSize, maxWidth, paddingTop, paddingLeft, lineHeight);

    // selection highlight
    if (selectionStart !== undefined && selectionEnd !== undefined && selectionStart < selectionEnd) {
      const isDragging = shakeRef.current.dragging;
      ctx.fillStyle = isDragging
        ? `rgba(251,191,36,0.45)` // amber while shaking
        : `rgba(45,127,249,0.18)`; // blue at rest
      for (const lr of spanLineRects(charRects, selectionStart, selectionEnd)) {
        const shakeX = isDragging ? shakeRef.current.offsetX : 0;
        ctx.fillRect(lr.x + shakeX - 1, lr.y + 1, lr.w + 2, lr.h - 2);
      }

      // resize handles
      if (resizeActive) {
        const lines = spanLineRects(charRects, selectionStart, selectionEnd);
        if (lines.length > 0) {
          const first = lines[0], last = lines[lines.length - 1];
          drawHandle(ctx, first.x, first.y + first.h / 2);
          drawHandle(ctx, last.x + last.w, last.y + last.h / 2);
        }
      }
    }

    // span diff — red strikethrough over original, green highlight over new text
    if (pendingDiff && (pendingDiff.mode === 'google-docs' || pendingDiff.mode === 'code-diff')) {
      const { strikeStart, strikeEnd, insertEnd } = pendingDiff;
      // red strikethrough
      for (const lr of spanLineRects(charRects, strikeStart, strikeEnd)) {
        ctx.fillStyle = 'rgba(220,68,68,0.12)';
        ctx.fillRect(lr.x - 1, lr.y + 1, lr.w + 2, lr.h - 2);
        ctx.strokeStyle = 'rgba(220,68,68,0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(lr.x - 1, lr.y + lr.h / 2);
        ctx.lineTo(lr.x + lr.w + 1, lr.y + lr.h / 2);
        ctx.stroke();
      }
      // green highlight over new text
      for (const lr of spanLineRects(charRects, strikeEnd, insertEnd)) {
        ctx.fillStyle = 'rgba(47,143,78,0.2)';
        ctx.fillRect(lr.x - 1, lr.y + 1, lr.w + 2, lr.h - 2);
      }
    }

    // code-diff: same canvas highlight as google-docs, diff label handled in JSX

  }, [text, fontSize, width, height, maxWidth, paddingTop, paddingLeft, lineHeight,
      selectionStart, selectionEnd, resizeActive, pendingDiff]);

  useEffect(() => { draw(); }, [draw]);

  // Shake pointer events — always active when selection exists, no button needed
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (selectionStart === undefined || selectionEnd === undefined) return;
    e.stopPropagation();
    shakeRef.current.dragging = true;
    shakeRef.current.startX = e.clientX;
    shakeRef.current.offsetX = 0;
    shakeRef.current.samples = [{ t: Date.now(), x: e.clientX }];
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [shakeActive]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!shakeRef.current.dragging) return;
    shakeRef.current.offsetX = e.clientX - shakeRef.current.startX;
    shakeRef.current.samples.push({ t: Date.now(), x: e.clientX });
    // keep last 600ms
    const cutoff = Date.now() - 600;
    shakeRef.current.samples = shakeRef.current.samples.filter(s => s.t > cutoff);
    draw();

    // detect shake: count velocity direction changes
    const samples = shakeRef.current.samples;
    if (samples.length >= 4) {
      let crossings = 0;
      let prevVel = 0;
      for (let i = 1; i < samples.length; i++) {
        const vel = samples[i].x - samples[i - 1].x;
        if (prevVel !== 0 && Math.sign(vel) !== Math.sign(prevVel)) crossings++;
        if (vel !== 0) prevVel = vel;
      }
      if (crossings >= 3) {
        shakeRef.current.dragging = false;
        shakeRef.current.offsetX = 0;
        onShakeDetected?.();
      }
    }
  }, [draw, onShakeDetected]);

  const onPointerUp = useCallback(() => {
    if (!shakeRef.current.dragging) return;
    shakeRef.current.dragging = false;
    shakeRef.current.offsetX = 0;
    draw();
  }, [draw]);

  const showCanvas = (selectionStart !== undefined && selectionEnd !== undefined && selectionStart < selectionEnd)
    || pendingDiff != null;

  if (!showCanvas) return null;

  // compute span position for accept/reject buttons
  const diffCharRects = pendingDiff && text
    ? buildCharRects(text, fontSize, maxWidth, paddingTop, paddingLeft, lineHeight)
    : null;
  const diffSpanLines = diffCharRects && pendingDiff
    ? spanLineRects(diffCharRects, pendingDiff.strikeStart, pendingDiff.strikeEnd)
    : null;

  return (
    <>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', left: 0, top: HEADER_H,
          width, height: height - HEADER_H,
          pointerEvents: showCanvas ? 'auto' : 'none',
          zIndex: 1, cursor: 'grab',
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      />

      {/* accept/reject buttons */}
      {pendingDiff && (pendingDiff.mode === 'google-docs' || pendingDiff.mode === 'code-diff') && diffSpanLines && diffSpanLines.length > 0 && (
        <div style={{
          position: 'absolute', zIndex: 5,
          left: paddingLeft,
          top: HEADER_H + diffSpanLines[0].y - 28,
          display: 'flex', gap: 4,
        }}>
          <DiffBtn color="var(--ok)" onClick={onAcceptDiff}>✓ accept</DiffBtn>
          <DiffBtn color="var(--warn)" onClick={onRejectDiff}>✕ reject</DiffBtn>
        </div>
      )}
    </>
  );
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = 'var(--accent)';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function DiffBtn({ color, onClick, children }: { color: string; onClick?: () => void; children: React.ReactNode }) {
  return (
    <button
      onPointerDown={e => { e.stopPropagation(); onClick?.(); }}
      style={{
        background: 'var(--panel)', border: `1px solid ${color}`, borderRadius: 4,
        padding: '2px 8px', fontSize: 11, color, cursor: 'pointer', fontWeight: 600,
      }}
    >{children}</button>
  );
}
