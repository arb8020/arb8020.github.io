import { prepareRichInline, walkRichInlineLineRanges } from '@chenglou/pretext/rich-inline';

export interface CharRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

// Build a charOffset → screen-relative rect map for text rendered in a box.
// paddingTop/paddingLeft must match the textarea's CSS padding.
export function buildCharRects(
  text: string,
  fontSize: number,
  maxWidth: number,
  paddingTop = 10,
  paddingLeft = 12,
  lineHeight = 1.5,
): CharRect[] {
  const font = `${fontSize}px -apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif`;
  const lineHeightPx = fontSize * lineHeight;
  const rects: CharRect[] = new Array(text.length);
  let lineY = paddingTop;
  let charOffset = 0;

  for (const line of text.split('\n')) {
    if (line.length === 0) {
      lineY += lineHeightPx;
      charOffset += 1;
      continue;
    }
    const tokens = line.match(/(\S+|\s+)/g) || [];
    if (tokens.length === 0) { charOffset += line.length + 1; lineY += lineHeightPx; continue; }

    const offsets: number[] = [];
    let pos = 0;
    for (const t of tokens) { offsets.push(pos); pos += t.length; }

    const items = tokens.map(t => ({ text: t, font }));
    const prepared = prepareRichInline(items);

    walkRichInlineLineRanges(prepared, maxWidth, (layoutLine: any) => {
      let curX = paddingLeft;
      for (const frag of layoutLine.fragments) {
        curX += frag.gapBefore;
        const fragStart = charOffset + offsets[frag.itemIndex];
        const fragText = tokens[frag.itemIndex];
        const charW = frag.occupiedWidth / Math.max(1, fragText.length);
        for (let i = 0; i < fragText.length; i++) {
          const idx = fragStart + i;
          if (idx < text.length) {
            rects[idx] = { x: curX + i * charW, y: lineY, w: charW, h: lineHeightPx };
          }
        }
        curX += frag.occupiedWidth;
      }
      lineY += lineHeightPx;
    });

    charOffset += line.length + 1;
  }

  return rects;
}

// Get bounding rect for a span [start, end) within charRects.
// Returns null if no rects found.
export function spanBounds(rects: CharRect[], start: number, end: number): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = start; i < end; i++) {
    const r = rects[i];
    if (!r) continue;
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.w > maxX) maxX = r.x + r.w;
    if (r.y + r.h > maxY) maxY = r.y + r.h;
  }
  if (minX === Infinity) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

// Get per-line rects for a span (for multi-line highlights).
export function spanLineRects(rects: CharRect[], start: number, end: number): { x: number; y: number; w: number; h: number }[] {
  const lines = new Map<number, { x: number; maxX: number; h: number }>();
  for (let i = start; i < end; i++) {
    const r = rects[i];
    if (!r) continue;
    const key = r.y;
    const existing = lines.get(key);
    if (existing) {
      existing.x = Math.min(existing.x, r.x);
      existing.maxX = Math.max(existing.maxX, r.x + r.w);
    } else {
      lines.set(key, { x: r.x, maxX: r.x + r.w, h: r.h });
    }
  }
  return Array.from(lines.entries())
    .sort(([a], [b]) => a - b)
    .map(([y, { x, maxX, h }]) => ({ x, y, w: maxX - x, h }));
}
