interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onAddBox: () => void;
  onPasteBox: () => void;
}

export function Toolbar({ zoom, onZoomIn, onZoomOut, onZoomReset, onAddBox, onPasteBox }: Props) {
  const btn: React.CSSProperties = {
    background: 'transparent', border: 'none', padding: '6px 10px',
    borderRadius: 6, cursor: 'pointer', color: 'var(--text)', fontSize: 13,
  };
  return (
    <div className="toolbar" style={{
      position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 10,
      boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
      padding: 6, display: 'flex', gap: 4, alignItems: 'center', zIndex: 30,
    }}>
      <button style={btn} onClick={onAddBox}>+ box</button>
      <button style={btn} onClick={onPasteBox}>paste</button>
      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', margin: '4px 2px' }} />
      <span style={{ color: 'var(--muted)', fontSize: 11, padding: '0 4px' }} title="hold space + drag, or middle-mouse drag">✋ space+drag</span>
      <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch', margin: '4px 2px' }} />
      <button style={btn} onClick={onZoomOut}>−</button>
      <span style={{ color: 'var(--muted)', padding: '0 8px', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
        {Math.round(zoom * 100)}%
      </span>
      <button style={btn} onClick={onZoomIn}>+</button>
      <button style={btn} onClick={onZoomReset}>reset</button>
    </div>
  );
}
