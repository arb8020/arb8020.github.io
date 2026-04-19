import { useState } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  boxId: string;
  start: number;
  end: number;
  screenX: number;
  screenY: number;
  onTranslate: (boxId: string, start: number, end: number, register: string) => void;
  onShake: (boxId: string, start: number, end: number) => void;
  onDismiss: () => void;
}

export function SpanToolbar({ boxId, start, end, screenX, screenY, onTranslate, onShake, onDismiss }: Props) {
  const [translateInput, setTranslateInput] = useState('');
  const [showTranslate, setShowTranslate] = useState(false);

  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onPointerDown={onDismiss} />
      <div style={{
        position: 'fixed', zIndex: 400,
        left: screenX, top: screenY - 40,
        transform: 'translateX(-50%)',
        background: 'var(--text)', borderRadius: 8,
        padding: '4px 6px',
        display: 'flex', alignItems: 'center', gap: 2,
        boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
        userSelect: 'none',
      }}
        onPointerDown={e => e.stopPropagation()}
      >
        {!showTranslate ? (
          <>
            <Btn title="translate span" onClick={() => setShowTranslate(true)}>🌐</Btn>
            <Btn title="shake — get alternatives" onClick={() => { onShake(boxId, start, end); onDismiss(); }}>〜</Btn>
            {/* TODO(span-lock): add 🔒 lock button */}
            {/* TODO(span-strikethrough): add S̶ strikethrough button */}
            {/* TODO(annotate): add 💬 annotate button */}

            {/* TODO(shake): 〜 button triggers shake gesture UX.
                "Shake" means the user physically shakes the highlighted span to get alternatives.
                Implementation:
                1. When 〜 is clicked, render a pretext-positioned highlight rect over the span
                   (same canvas overlay as DensityOverlay, but a single colored rect for [start,end]).
                2. The highlight rect is draggable left/right. Track pointermove on it.
                3. Detect shake gesture: velocity direction changes >= 3 times within 400ms.
                   Use a ring buffer of (timestamp, x) samples; count zero-crossings of velocity.
                4. On shake detected: fire runShakeSpan(boxId, start, end), highlight rect pulses
                   briefly (scale animation), then alternatives popover appears.
                5. If user just drags without shaking, cancel and dismiss.
                The highlight rect is positioned via pretext charRects (same as DensityOverlay).
                It should be a semi-transparent colored underline/background, not a full overlay. */}

            {/* TODO(span-resize): drag left/right handles on highlighted span to resize it.
                Implementation:
                1. Same pretext highlight rect as shake — render the span boundary.
                2. Add two small drag handles at the left and right edges of the selection rect.
                3. Dragging left handle moves start offset; dragging right moves end offset.
                   Update selectionStart/End on the textarea as handles move.
                4. On handle release: fire runSpanResize(boxId, newStart, newEnd, targetPct)
                   where targetPct = newSpanWidth / origSpanWidth (proportional to drag distance).
                5. Result uses span diff rendering (see below). */}

            {/* TODO(span-diff): span-level rewrites (translate span, span resize) should render
                result inline rather than in a separate ghost box. Three modes (settings toggle):
                - google-docs: red strikethrough over original span + green insertion after,
                  rendered via pretext canvas overlay. Accept/reject per span via floating buttons.
                - code-diff: original in red block, new in green block, shown below the span.
                - ghost: small floating box near the span (reuses GhostBox but anchored to span pos).
                Default: google-docs mode. All modes use same accept/reject flow: accept splices
                new text at [start, end], push new version; reject clears pending span diff. */}
          </>
        ) : (
          <>
            <input
              autoFocus
              value={translateInput}
              onChange={e => setTranslateInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && translateInput.trim()) {
                  onTranslate(boxId, start, end, translateInput.trim());
                  onDismiss();
                }
                if (e.key === 'Escape') { setShowTranslate(false); setTranslateInput(''); }
              }}
              placeholder="portuguese, pirate speak…"
              style={{
                background: 'transparent', border: 'none', outline: 'none',
                color: '#fff', fontSize: 12, width: 160, padding: '2px 4px',
              }}
            />
            <Btn title="cancel" onClick={() => { setShowTranslate(false); setTranslateInput(''); }}>✕</Btn>
          </>
        )}
      </div>
    </>,
    document.body
  );
}

// shake results popover
interface ShakeProps {
  boxId: string;
  result: { start: number; end: number; originalText: string; alternatives: string[] };
  onAccept: (boxId: string, alternative: string) => void;
  onDismiss: (boxId: string) => void;
  // position near the span — approximate screen coords from box position
  screenX: number;
  screenY: number;
}

export function ShakePopover({ boxId, result, onAccept, onDismiss, screenX, screenY }: ShakeProps) {
  return createPortal(
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onPointerDown={() => onDismiss(boxId)} />
      <div style={{
        position: 'fixed', zIndex: 400,
        left: screenX, top: screenY + 8,
        transform: 'translateX(-50%)',
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 8, minWidth: 220, maxWidth: 360,
        boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      }}
        onPointerDown={e => e.stopPropagation()}
      >
        <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
          alternatives for "{result.originalText.slice(0, 40)}{result.originalText.length > 40 ? '…' : ''}"
        </div>
        {result.alternatives.map((alt, i) => (
          <div
            key={i}
            onClick={() => onAccept(boxId, alt)}
            style={{
              padding: '6px 8px', borderRadius: 5, cursor: 'pointer', fontSize: 13,
              marginBottom: 3, border: '1px solid var(--border)',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--panel-2)')}
            onMouseLeave={e => (e.currentTarget.style.background = '')}
          >
            {alt}
          </div>
        ))}
      </div>
    </>,
    document.body
  );
}

function Btn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onPointerDown={e => { e.stopPropagation(); onClick(); }}
      style={{
        background: 'transparent', border: 'none', cursor: 'pointer',
        color: '#fff', fontSize: 14, padding: '2px 5px', borderRadius: 4,
        lineHeight: 1,
      }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >{children}</button>
  );
}
