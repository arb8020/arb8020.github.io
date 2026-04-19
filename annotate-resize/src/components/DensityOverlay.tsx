// TODO(density-settings): expose concept word + visual mode toggles in Sidebar.
// loadDensityConcept/saveDensityConcept (default: 'importance') — free text, user can type 'density', 'complexity', 'emotional charge', etc.
// loadDensityVisual/saveDensityVisual — 'heatmap' | 'opacity' radio.
// loadDensityTmpl/saveDensityTmpl — editable prompt template with {{concept}} and {{text}} placeholders.
// Also add "clear density" button to dismiss the overlay without running again.
import { useEffect, useRef } from 'react';
import { walkRichInlineLineRanges, prepareRichInline } from '@chenglou/pretext/rich-inline';
import type { DensitySpan, DensityVisual } from '../types';

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

    const font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`;
    const lineHeightPx = fontSize * lineHeight;
    const maxWidth = width - paddingLeft * 2;

    // Build pretext items: one item per character so we can map char offsets to positions.
    // For performance, group into word-level items instead.
    const words = splitIntoWordItems(text, font);
    const prepared = prepareRichInline(words.items);

    // Walk lines, building a charOffset → {x, y, w} map per line
    const charRects: { x: number; y: number; w: number; h: number }[] = new Array(text.length);
    let lineY = paddingTop;

    walkRichInlineLineRanges(prepared, maxWidth, (line: any) => {
      for (const frag of line.fragments) {
        const item = words.items[frag.itemIndex];
        const startChar = words.offsets[frag.itemIndex];
        // frag.start.x is relative to line start (left edge of content)
        const x = paddingLeft + frag.start.x;
        const fragText = item.text;
        for (let i = 0; i < fragText.length; i++) {
          const charIdx = startChar + i;
          if (charIdx < text.length) {
            charRects[charIdx] = { x, y: lineY, w: frag.occupiedWidth / fragText.length, h: lineHeightPx };
          }
        }
      }
      lineY += lineHeightPx;
    });

    // Paint spans
    for (const span of spans) {
      const color = scoreToColor(span.score, visual);
      ctx.fillStyle = color;
      // group contiguous chars on same line into rects
      let i = span.start;
      while (i < span.end && i < charRects.length) {
        const r = charRects[i];
        if (!r) { i++; continue; }
        // extend right while same line
        let j = i + 1;
        let right = r.x + r.w;
        while (j < span.end && j < charRects.length && charRects[j] && charRects[j].y === r.y) {
          right = charRects[j].x + charRects[j].w;
          j++;
        }
        ctx.fillRect(r.x - 1, r.y + 1, right - r.x + 2, r.h - 2);
        i = j;
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

function splitIntoWordItems(text: string, font: string): { items: { text: string; font: string }[]; offsets: number[] } {
  const items: { text: string; font: string }[] = [];
  const offsets: number[] = [];
  const re = /(\S+|\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    items.push({ text: m[0], font });
    offsets.push(m.index);
  }
  return { items, offsets };
}
