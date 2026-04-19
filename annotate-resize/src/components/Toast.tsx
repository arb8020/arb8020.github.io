interface ToastItem { id: number; msg: string; kind: string; }

export function Toast({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 72, left: '50%', transform: 'translateX(-50%)',
                  display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', zIndex: 400 }}>
      {toasts.map(t => (
        <div key={t.id} onClick={() => onDismiss(t.id)} style={{
          background: t.kind === 'err' ? '#7f1d1d' : '#78350f',
          border: `1px solid ${t.kind === 'err' ? '#dc2626' : '#d97706'}`,
          color: '#fff', padding: '10px 16px', borderRadius: 8,
          fontSize: 13, maxWidth: 480, boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
          cursor: 'pointer',
        }}>{t.msg}</div>
      ))}
    </div>
  );
}
