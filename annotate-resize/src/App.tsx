import { useEffect, useRef, useCallback, useState } from 'react';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Toast } from './components/Toast';
import type { Box, PopoverKind } from './types';
import { loadFitMode } from './storage';
import { callLLM } from './llm';
import { loadTmpl, loadUserKeys } from './storage';
import { validateTmpl, renderTmpl, includedVersionsBlock } from './template';

let nextBoxId = 0;

function makeEmptyBox(x: number, y: number): Box {
  return {
    id: `box${nextBoxId++}`,
    x, y, w: 420, h: 220,
    versions: [], currentVid: null,
    calibChars: 0, calibArea: 420 * 220,
    annotation: '', fontSize: 14,
  };
}

export default function App() {
  const worldRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const spaceDown = useRef(false);
  const panState = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const [boxes, setBoxes] = useState<Box[]>(() => [makeEmptyBox(120, 120)]);
  const [selectedId, setSelectedId] = useState<string | null>(boxes[0].id);
  const [popover, setPopover] = useState<{ boxId: string; kind: PopoverKind } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((msg: string, kind = 'err') => {
    const id = toastId.current++;
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  }, []);

  // init panzoom + space-to-pan key listeners
  useEffect(() => {
    if (!worldRef.current) return;
    const pz = Panzoom(worldRef.current, {
      maxScale: 4, minScale: 0.2, startScale: 1, cursor: 'default',
      overflow: 'visible',
      // Panzoom's default handleStartEvent calls stopPropagation, which kills
      // React's synthetic event system. We handle pan ourselves on the viewport.
      handleStartEvent: () => {},
    });
    panzoomRef.current = pz;
    pz.setOptions({ disablePan: true });

    const vp = worldRef.current.parentElement!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.sidebar,.toolbar,.sidebarToggle,.popover')) return;
      pz.zoomWithWheel(e);
      setZoom(pz.getScale());
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === 'Space' && !e.repeat && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
        spaceDown.current = true;
        vp.style.cursor = 'grab';
        e.preventDefault();
      }
      if (e.code === 'Escape') { setSelectedId(null); setPopover(null); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') { spaceDown.current = false; vp.style.cursor = ''; }
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      vp.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      pz.destroy();
    };
  }, []);

  const handleViewportPointerDown = useCallback((e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('.box,.handle,.sidePill,.popover,.sidebar,.toolbar,.sidebarToggle')) return;
    if (e.button === 1 || (spaceDown.current && e.button === 0)) {
      const pan = panzoomRef.current?.getPan() ?? { x: 0, y: 0 };
      panState.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    if (e.button === 0) { setSelectedId(null); setPopover(null); }
  }, []);

  const handleViewportPointerMove = useCallback((e: React.PointerEvent) => {
    if (!panState.current || !panzoomRef.current) return;
    const scale = panzoomRef.current.getScale();
    panzoomRef.current.pan(
      panState.current.px + (e.clientX - panState.current.sx) / scale,
      panState.current.py + (e.clientY - panState.current.sy) / scale,
      { force: true },
    );
  }, []);

  const handleViewportPointerUp = useCallback(() => {
    panState.current = null;
  }, []);

  const getPanzoom = () => panzoomRef.current;

  const addBox = useCallback((text = '') => {
    const pz = getPanzoom();
    const scale = pz ? pz.getScale() : 1;
    const pan = pz ? pz.getPan() : { x: 0, y: 0 };
    const wx = (window.innerWidth / 2) / scale - pan.x - 210;
    const wy = (window.innerHeight / 2) / scale - pan.y - 110;
    const box: Box = { ...makeEmptyBox(wx, wy) };
    if (text) {
      box.versions = [{ id: 'v0', text, parentId: null, targetPct: 1, included: true, annotation: '' }];
      box.currentVid = 'v0';
      box.calibChars = text.length;
    }
    setBoxes(bs => [...bs, box]);
    setSelectedId(box.id);
  }, []);

  const updateBox = useCallback((id: string, updater: (b: Box) => Box) => {
    setBoxes(bs => bs.map(b => b.id === id ? updater({ ...b }) : b));
  }, []);

  const runResize = useCallback(async (boxId: string, newArea: number) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box || box.versions.length === 0) return;

    const tmpl = loadTmpl();
    const userKeys = loadUserKeys();
    const { missingRequired, undefinedKeys } = validateTmpl(tmpl, userKeys);
    if (missingRequired.length || undefinedKeys.length) {
      toast('template invalid — open settings');
      return;
    }

    const parent = box.versions.find(v => v.id === box.currentVid) ?? box.versions[0];
    const v0 = box.versions[0];
    const calibArea = box.calibArea || newArea;
    const ratio = newArea / calibArea;
    const targetChars = Math.max(20, Math.round(box.calibChars * ratio));
    const vars: Record<string, string> = {
      v0_text: v0.text,
      target_count: String(targetChars),
      annotation: box.annotation || '(none)',
      included_versions: includedVersionsBlock(box) || '(none)',
      ...userKeys,
    };
    const prompt = renderTmpl(tmpl, vars);

    updateBox(boxId, b => ({ ...b, _status: 'rewriting…' } as any));
    try {
      const text = await callLLM(prompt);
      if (!text.trim()) throw new Error('LLM returned empty response');
      const newId = `v${box.versions.length}`;
      const targetPct = parent.text.length ? text.length / parent.text.length : 1;
      updateBox(boxId, b => ({
        ...b,
        versions: [...b.versions, { id: newId, text, parentId: parent.id, targetPct, included: true, annotation: b.annotation }],
        currentVid: newId,
        _status: '',
      } as any));
    } catch (err: any) {
      toast(`rewrite failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const togglePopover = useCallback((boxId: string, kind: PopoverKind) => {
    setPopover(p => (p?.boxId === boxId && p?.kind === kind) ? null : { boxId, kind });
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* grid background */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #e6e7eb 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      {/* infinite canvas viewport */}
      <div
        id="viewport"
        style={{ position: 'fixed', inset: 0 }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
      >
        <div ref={worldRef} style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, transformOrigin: '0 0' }}>
          <Canvas
            boxes={boxes}
            selectedId={selectedId}
            popover={popover}
            panzoomRef={panzoomRef}
            onSelect={setSelectedId}
            onUpdateBox={updateBox}
            onTogglePopover={togglePopover}
            onClosePopover={() => setPopover(null)}
            onRunResize={runResize}
            fitMode={loadFitMode()}
            toast={toast}
          />
        </div>
      </div>

      {/* settings toggle */}
      <button
        className="sidebarToggle"
        style={{
          position: 'fixed', top: 12, right: 12, zIndex: 30,
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '6px 10px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        }}
        onClick={() => setSidebarOpen(o => !o)}
      >☰ settings</button>

      <Toolbar
        zoom={zoom}
        onZoomIn={() => { panzoomRef.current?.zoomIn(); setZoom(panzoomRef.current?.getScale() ?? 1); }}
        onZoomOut={() => { panzoomRef.current?.zoomOut(); setZoom(panzoomRef.current?.getScale() ?? 1); }}
        onZoomReset={() => { panzoomRef.current?.reset(); setZoom(1); }}
        onAddBox={() => addBox()}
        onPasteBox={async () => {
          try { const t = await navigator.clipboard.readText(); if (t) addBox(t); }
          catch { toast('clipboard read failed', 'warn'); }
        }}
      />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} toast={toast} />

      <Toast toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  );
}
