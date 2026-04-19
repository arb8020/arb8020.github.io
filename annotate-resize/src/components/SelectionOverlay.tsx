import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Box, PopoverKind } from '../types';

interface Props {
  box: Box;
  popover: PopoverKind;
  onTogglePopover: (kind: PopoverKind) => void;
  onClosePopover: () => void;
  onUpdate: (updater: (b: Box) => Box) => void;
  onStartResize: (dir: string, e: React.PointerEvent) => void;
  onRetry: () => void;
  onRunDensity: () => void;
}

const PAD = 4;

const HANDLES: [string, (b: Box) => [number, number], string][] = [
  ['tl', b => [b.x - PAD, b.y - PAD], 'corner'],
  ['tr', b => [b.x + b.w + PAD, b.y - PAD], 'corner'],
  ['bl', b => [b.x - PAD, b.y + b.h + PAD], 'corner'],
  ['br', b => [b.x + b.w + PAD, b.y + b.h + PAD], 'corner'],
  ['t', b => [b.x + b.w / 2, b.y - PAD], 'edge-h'],
  ['b', b => [b.x + b.w / 2, b.y + b.h + PAD], 'edge-h'],
  ['l', b => [b.x - PAD, b.y + b.h / 2], 'edge-v'],
  ['r', b => [b.x + b.w + PAD, b.y + b.h / 2], 'edge-v'],
];

const CURSORS: Record<string, string> = {
  tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize',
  t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize',
};

export function SelectionOverlay({ box, popover, onTogglePopover, onClosePopover, onUpdate, onStartResize, onRetry, onRunDensity }: Props) {
  const b = box;
  // screen-space rect of the active pill, used to position the portal popover
  const [pillRect, setPillRect] = useState<DOMRect | null>(null);

  const handlePillClick = (kind: PopoverKind, el: HTMLElement) => {
    if (popover === kind) {
      onTogglePopover(kind); // closes
      setPillRect(null);
    } else {
      setPillRect(el.getBoundingClientRect());
      onTogglePopover(kind);
    }
  };

  return (
    <>
      {/* selection rectangle — pointerEvents none so it doesn't block box */}
      <div style={{
        position: 'absolute', pointerEvents: 'none',
        left: b.x - PAD, top: b.y - PAD,
        width: b.w + PAD * 2, height: b.h + PAD * 2,
        border: '1.5px solid var(--accent)', borderRadius: 6, zIndex: 20,
      }} />

      {/* handles */}
      {HANDLES.map(([dir, pos, kind]) => {
        const [hx, hy] = pos(b);
        const sw = kind === 'corner' ? 10 : kind === 'edge-h' ? 14 : 6;
        const sh = kind === 'corner' ? 10 : kind === 'edge-h' ? 6 : 14;
        return (
          <div key={dir} title={kind === 'corner' ? 'drag to resize + rewrite' : 'drag to resize'} style={{
            position: 'absolute', zIndex: 21,
            left: hx - sw / 2, top: hy - sh / 2,
            width: sw, height: sh,
            background: kind === 'corner' ? 'var(--accent)' : '#fff',
            border: '1.5px solid var(--accent)',
            borderRadius: kind === 'corner' ? '50%' : 3,
            cursor: CURSORS[dir], pointerEvents: 'auto',
          }}
            onPointerDown={e => onStartResize(dir, e)}
          />
        );
      })}

      {/* pills — in world space */}
      <SidePill x={b.x - 44} y={b.y + 8}   label="✎" title="annotation" onClick={el => handlePillClick('annotation', el)} />
      <SidePill x={b.x - 44} y={b.y + 44}  label="↺" title="retry" onClick={() => { onRetry(); }} />
      <SidePill x={b.x - 44} y={b.y + 80}  label="≡" title="versions" onClick={el => handlePillClick('versions', el)} />
      <SidePill x={b.x - 44} y={b.y + 116} label="◉" title="density" onClick={() => onRunDensity()} />
      {/* TODO(tree-fold): add 🌲 pill at y+152. Calls runTreeFold(boxId).
          LLM reformats text verbatim as Markdown outline tree (no summarization).
          Prompt: "Copy the following content verbatim, format as a tree using outline (- <text>) notation.
          Output Markdown. Do not summarize, modify, or editorialize.\n\n{{text}}"
          Result is a new version. Box detects if currentVid text is Markdown and renders accordingly.
          Future: click to collapse/expand individual tree nodes inline. */}
      {/* TODO(translate): add 🌐 pill at y+224. Opens popover with single text input "translate to / rewrite as".
          User types anything: "portuguese", "pirate speak", "linkedin", "ELI5".
          Prompt: "Rewrite the following text as {{register}}. Preserve meaning. Reply with rewritten text only.\n\ntext: {{text}}"
          On submit: callLLM, push new version. No new infrastructure needed — same version model as resize. */}
      {/* TODO(annotate): add 💬 pill at y+260. Opens annotation input bar.
          Triggers LLM annotation+diff mode (see TODO in App.tsx runAnnotation).
          Pill should highlight blue when annotation session is active on this box. */}

      {/* popovers — portaled to body so position:fixed works correctly outside the transform */}
      {popover === 'annotation' && pillRect && createPortal(
        <Popover anchorRect={pillRect} onClose={onClosePopover}>
          <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Annotation</div>
          <textarea
            autoFocus
            defaultValue={b.annotation}
            placeholder="e.g. make it more formal; keep technical terms"
            style={{ width: '100%', minHeight: 90, border: '1px solid var(--border)', borderRadius: 6, padding: 8, font: '13px/1.45 inherit', resize: 'vertical', background: 'var(--panel-2)' }}
            onChange={e => onUpdate(b => ({ ...b, annotation: e.target.value }))}
          />
        </Popover>,
        document.body
      )}

      {popover === 'versions' && pillRect && createPortal(
        <Popover anchorRect={pillRect} onClose={onClosePopover}>
          <VersionsList box={b} onUpdate={onUpdate} onClose={onClosePopover} />
        </Popover>,
        document.body
      )}
    </>
  );
}

function SidePill({ x, y, label, title, onClick }: {
  x: number; y: number; label: string; title: string;
  onClick: (el: HTMLElement) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      title={title}
      style={{
        position: 'absolute', zIndex: 22,
        left: x, top: y, width: 28, height: 28, borderRadius: 14,
        background: 'var(--yellow)', border: '1px solid rgba(0,0,0,0.08)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', fontSize: 14, pointerEvents: 'auto', userSelect: 'none',
      }}
      onPointerDown={e => { e.stopPropagation(); onClick(ref.current!); }}
    >{label}</div>
  );
}

function Popover({ anchorRect, onClose, children }: { anchorRect: DOMRect; onClose: () => void; children: React.ReactNode }) {
  // rendered inside a portal already — just return the elements
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onPointerDown={onClose} />
      <div style={{
        position: 'fixed', zIndex: 300,
        left: anchorRect.right + 8,
        top: anchorRect.top,
        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 10, minWidth: 260,
      }}
        onPointerDown={e => e.stopPropagation()}
      >
        {children}
      </div>
    </>
  );
}

function VersionsList({ box, onUpdate, onClose }: { box: Box; onUpdate: (u: (b: Box) => Box) => void; onClose: () => void }) {
  const [, forceRender] = useState(0);
  if (box.versions.length === 0) return <div style={{ color: 'var(--muted)', fontSize: 12 }}>no versions yet — paste text then resize.</div>;
  return (
    <div style={{ maxHeight: '60vh', overflow: 'auto', minWidth: 300 }}>
      <div style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Versions (✓ = include in prompt)</div>
      {box.versions.map(v => {
        const pct = Math.round(v.targetPct * 100);
        const meta = v.parentId ? ` (${pct}% of ${v.parentId})` : ' (original)';
        return (
          <div key={v.id} style={{
            display: 'flex', gap: 6, alignItems: 'flex-start', padding: 6,
            border: `1px solid ${v.id === box.currentVid ? 'var(--accent)' : 'var(--border)'}`,
            borderRadius: 6, marginBottom: 6, cursor: 'pointer',
          }}
            onClick={() => { onUpdate(b => ({ ...b, currentVid: v.id })); onClose(); }}
          >
            <input type="checkbox" checked={v.included} onClick={e => e.stopPropagation()}
              onChange={e => { onUpdate(b => ({ ...b, versions: b.versions.map(x => x.id === v.id ? { ...x, included: e.target.checked } : x) })); forceRender(n => n + 1); }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><span style={{ fontWeight: 600 }}>{v.id}</span><span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 4 }}>{meta} · {v.text.length} chars</span></div>
              <div style={{ color: 'var(--muted)', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{v.text.slice(0, 100)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
