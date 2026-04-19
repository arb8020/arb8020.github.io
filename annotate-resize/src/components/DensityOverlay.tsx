// TODO(density-settings): expose concept word + visual mode toggles in Sidebar.
// loadDensityConcept/saveDensityConcept (default: 'importance') — free text, user can type 'density', 'complexity', 'emotional charge', etc.
// loadDensityVisual/saveDensityVisual — 'heatmap' | 'opacity' radio.
// loadDensityTmpl/saveDensityTmpl — editable prompt template with {{concept}} and {{text}} placeholders.
// Also add "clear density" button to dismiss the overlay without running again.
import { useEffect, useRef } from 'react';
import type { DensitySpan, DensityVisual } from '../types';
import { buildCharRects, spanLineRects } from './pretext-utils';

interface Props {
  text: string;
  spans: DensitySpan[];
  visual: DensityVisual;
  width: number;
  height: number;
  fontSize: number;
  // must match textarea padding exactly
  paddingTop?: number;
  paddingLeft?: number;
  lineHeight?: number;
}

function scoreToColor(score: number, visual: DensityVisual): string {
  if (visual === 'opacity') {
    // low score = faded, high = full opacity
    const alpha = 0.15 + score * 0.85;
    return `rgba(30, 30, 30, ${alpha.toFixed(2)})`;
  }
  // heatmap: low = blue-ish cool, high = warm red/orange
  const r = Math.round(score * 220);
  const g = Math.round(60 + (1 - score) * 120);
  const b = Math.round((1 - score) * 220);
  return `rgba(${r}, ${g}, ${b}, 0.35)`;
}

export function DensityOverlay({ text, spans, visual, width, height, fontSize, paddingTop = 10, paddingLeft = 12, lineHeight = 1.5 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    if (!text || spans.length === 0) return;

    const maxWidth = width - paddingLeft * 2;
    const charRects = buildCharRects(text, fontSize, maxWidth, paddingTop, paddingLeft, lineHeight);

    for (const span of spans) {
      const color = scoreToColor(span.score, visual);
      ctx.fillStyle = color;
      for (const lr of spanLineRects(charRects, span.start, span.end)) {
        ctx.fillRect(lr.x - 1, lr.y + 1, lr.w + 2, lr.h - 2);
      }
    }
  }, [text, spans, visual, width, height, fontSize, paddingTop, paddingLeft, lineHeight]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        left: 0, top: 22, // below header, box has overflow:hidden so this is clipped correctly
        width, height: height - 22,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}

