import { useEffect, useRef, useCallback, useState } from 'react';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Toast } from './components/Toast';
import { SpanToolbar, ShakePopover } from './components/SpanToolbar';
import type { Box, MergedSlot, SnapCandidate, PopoverKind, DensitySpan, AnchorCorner } from './types';
import { loadFitMode, loadDensityTmpl, loadDensityConcept, loadDensityVisual, loadConfirmRewrite, loadStreamMode, loadSpanDiffMode, saveCanvas, loadCanvas } from './storage';
import { callLLM, streamLLM } from './llm';
import { loadTmpl, loadUserKeys } from './storage';
import { validateTmpl, renderTmpl, includedVersionsBlock } from './template';

// mutable counter for unique box ids within a session; hydrated from snapshot on mount
let nextBoxId = 0;

function makeEmptyBox(x: number, y: number): Box {
  // start small — fitWiden will grow it when text is pasted/typed
  return {
    id: `box${nextBoxId++}`,
    x, y, w: 160, h: 58,
    versions: [], currentVid: null,
    calibChars: 0, calibArea: 160 * 58,
    annotation: '', fontSize: 14,
  };
}

// load snapshot synchronously before the first useState so initial boxes match saved state
const __initialSnapshot = loadCanvas();
if (__initialSnapshot) nextBoxId = __initialSnapshot.nextBoxId;

function boxToSlot(b: Box): MergedSlot {
  const currentV = b.versions.find(v => v.id === b.currentVid);
  return {
    sourceId: b.id,
    originalX: b.x, originalY: b.y, originalW: b.w, originalH: b.h,
    versions: b.versions,
    currentVid: b.currentVid,
    calibChars: b.calibChars, calibArea: b.calibArea,
    annotation: b.annotation, fontSize: b.fontSize,
    textAtMerge: currentV?.text ?? '',
  };
}

function slotCurrentText(slot: MergedSlot): string {
  return slot.versions.find(v => v.id === slot.currentVid)?.text ?? '';
}

export default function App() {
  const worldRef = useRef<HTMLDivElement>(null);
  const panzoomRef = useRef<PanzoomObject | null>(null);
  const spaceDown = useRef(false);
  const panState = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [boxes, setBoxes] = useState<Box[]>(() =>
    __initialSnapshot && __initialSnapshot.boxes.length > 0
      ? __initialSnapshot.boxes
      : [makeEmptyBox(120, 120)]
  );
  const [selectedId, setSelectedId] = useState<string | null>(boxes[0]?.id ?? null);
  // keep ref in sync so keydown handler (inside useEffect) sees current value without stale closure
  selectedIdRef.current = selectedId;
  const [popover, setPopover] = useState<{ boxId: string; kind: PopoverKind } | null>(null);
  const [activeSpan, setActiveSpan] = useState<{ boxId: string; start: number; end: number; screenX: number; screenY: number } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const toastId = useRef(0);

  // debounced autosave — 1s after last mutation
  useEffect(() => {
    const t = setTimeout(() => saveCanvas(boxes, nextBoxId), 1000);
    return () => clearTimeout(t);
  }, [boxes]);

  const toast = useCallback((msg: string, kind = 'err') => {
    const id = toastId.current++;
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    if (!worldRef.current) return;
    const pz = Panzoom(worldRef.current, {
      maxScale: 4, minScale: 0.2, startScale: 1, cursor: 'default',
      overflow: 'visible',
      handleStartEvent: () => {},
    });
    panzoomRef.current = pz;
    pz.setOptions({ disablePan: true });

    const vp = worldRef.current.parentElement!;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest('.sidebar,.toolbar,.sidebarToggle,.popover')) return;
      e.preventDefault();
      if (e.ctrlKey) {
        // pinch gesture on trackpad, or ctrl+wheel
        pz.zoomWithWheel(e);
        setZoom(pz.getScale());
      } else {
        // two-finger pan on trackpad, or plain scroll wheel
        const scale = pz.getScale();
        const pan = pz.getPan();
        pz.pan(pan.x - e.deltaX / scale, pan.y - e.deltaY / scale, { force: true });
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.code === 'Space' && !e.repeat && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
        spaceDown.current = true;
        vp.style.cursor = 'grab';
        e.preventDefault();
      }
      if (e.code === 'Escape') { setSelectedId(null); setPopover(null); }
      if (e.code === 'Backspace' && t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA') {
        const id = selectedIdRef.current;
        if (id) { setBoxes(bs => bs.filter(b => b.id !== id)); setSelectedId(null); setPopover(null); }
      }
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

  const handleViewportPointerUp = useCallback(() => { panState.current = null; }, []);

  const getPanzoom = () => panzoomRef.current;

  const addBox = useCallback((text = '', atX?: number, atY?: number) => {
    const pz = getPanzoom();
    const scale = pz ? pz.getScale() : 1;
    const pan = pz ? pz.getPan() : { x: 0, y: 0 };
    const wx = atX ?? (window.innerWidth / 2) / scale - pan.x - 210;
    const wy = atY ?? (window.innerHeight / 2) / scale - pan.y - 110;
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

  // =============================================================================
  // merge / scissor / stitch
  // =============================================================================
  const mergeBoxes = useCallback(async (dragged: Box, candidate: SnapCandidate) => {
    // read current state from boxes ref before any async/setState work
    const draggedCurrent = boxes.find(b => b.id === dragged.id);
    const target = boxes.find(b => b.id === candidate.targetId);
    if (!draggedCurrent || !target) return;

    const axis = candidate.axis;
    // dragEdge is the dragged box's edge that's near the target.
    // B = dragged bottom near target top → dragged is above → dragged is A (first).
    // T = dragged top near target bottom → dragged is below → target is A (first).
    // R = dragged right near target left → dragged is left → dragged is A (first).
    // L = dragged left near target right → dragged is right → target is A (first).
    const draggedIsFirst = candidate.dragEdge === 'B' || candidate.dragEdge === 'R';
    const [boxA, boxB] = draggedIsFirst ? [draggedCurrent, target] : [target, draggedCurrent];

    const textA = slotCurrentText(boxToSlot(boxA));
    const textB = slotCurrentText(boxToSlot(boxB));
    const mergedId = `box${nextBoxId++}`;

    setBoxes(bs => {
      const draggedCurrent = bs.find(b => b.id === dragged.id);
      const target = bs.find(b => b.id === candidate.targetId);
      if (!draggedCurrent || !target) return bs;

      const draggedIsFirst = candidate.dragEdge === 'B' || candidate.dragEdge === 'R';
      const [boxA, boxB] = draggedIsFirst ? [draggedCurrent, target] : [target, draggedCurrent];

      const w = axis === 'v' ? Math.max(boxA.w, boxB.w) : boxA.w + boxB.w;
      const h = axis === 'v' ? boxA.h + boxB.h : Math.max(boxA.h, boxB.h);
      const x = Math.min(boxA.x, boxB.x);
      const y = Math.min(boxA.y, boxB.y);

      const merged: Box = {
        id: mergedId, x, y, w, h,
        versions: [], currentVid: null,
        calibChars: 0, calibArea: w * h,
        annotation: '', fontSize: 14,
        merged: {
          axis, stitched: false,
          slotA: boxToSlot(boxA),
          slotB: boxToSlot(boxB),
        },
      };

      return [...bs.filter(b => b.id !== draggedCurrent.id && b.id !== target.id), merged];
    });

    // LLM call: suggest transitions at the boundary — skip if either box has no text
    if (!textA || !textB) return;
    updateBox(mergedId, b => ({ ...b, _status: 'joining…' } as any));
    try {
      const prompt = `Two paragraphs have been placed adjacent to each other. Minimally edit them so they flow together naturally at the boundary.

Rules:
- Match the style, tone, and capitalization of the original text exactly
- Only modify what is necessary near the boundary — do not rewrite the body of either paragraph
- You may adjust punctuation, fix capitalization, or add a short transition phrase if needed
- If no changes are needed, repeat each paragraph unchanged

paragraph_1: ${textA}
paragraph_2: ${textB}

Reply in exactly this format:
p1: <full text of paragraph 1, minimally edited>
p2: <full text of paragraph 2, minimally edited>`;

      const result = await callLLM(prompt);

      const newTextA = result.match(/^p1:\s*([\s\S]+?)(?=\np2:)/m)?.[1]?.trim() ?? '';
      const newTextB = result.match(/^p2:\s*([\s\S]+?)$/m)?.[1]?.trim() ?? '';

      const changed = (newTextA && newTextA !== textA) || (newTextB && newTextB !== textB);

      if (changed) {
        updateBox(mergedId, b => {
          if (!b.merged) return b;
          const makeUpdatedSlot = (slot: typeof b.merged.slotA, newText: string) => {
            const newVid = `v${slot.versions.length}`;
            return {
              ...slot,
              versions: [...slot.versions, { id: newVid, text: newText, parentId: slot.currentVid, targetPct: 1, included: true, annotation: '' }],
              currentVid: newVid,
              textAtMerge: newText,
            };
          };
          return {
            ...b,
            merged: {
              ...b.merged,
              slotA: (newTextA && newTextA !== textA) ? makeUpdatedSlot(b.merged.slotA, newTextA) : b.merged.slotA,
              slotB: (newTextB && newTextB !== textB) ? makeUpdatedSlot(b.merged.slotB, newTextB) : b.merged.slotB,
            },
            _status: '',
          } as any;
        });
      } else {
        updateBox(mergedId, b => ({ ...b, _status: '' } as any));
      }
    } catch (err: any) {
      toast(`join failed: ${err.message || err}`);
      updateBox(mergedId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const scissorBox = useCallback(async (boxId: string) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box?.merged || box.merged.stitched) return;

    const { slotA, slotB } = box.merged;
    const textA = slotCurrentText(slotA);
    const textB = slotCurrentText(slotB);
    const editedA = textA !== slotA.textAtMerge;
    const editedB = textB !== slotB.textAtMerge;

    if (!editedA && !editedB) {
      // restore originals exactly
      setBoxes(bs => {
        const rest = bs.filter(b => b.id !== boxId);
        const restoredA: Box = {
          id: slotA.sourceId, x: slotA.originalX, y: slotA.originalY,
          w: slotA.originalW, h: slotA.originalH,
          versions: slotA.versions, currentVid: slotA.currentVid,
          calibChars: slotA.calibChars, calibArea: slotA.calibArea,
          annotation: slotA.annotation, fontSize: slotA.fontSize,
        };
        const restoredB: Box = {
          id: slotB.sourceId, x: slotB.originalX, y: slotB.originalY,
          w: slotB.originalW, h: slotB.originalH,
          versions: slotB.versions, currentVid: slotB.currentVid,
          calibChars: slotB.calibChars, calibArea: slotB.calibArea,
          annotation: slotB.annotation, fontSize: slotB.fontSize,
        };
        return [...rest, restoredA, restoredB];
      });
      return;
    }

    // LLM split
    updateBox(boxId, b => ({ ...b, _status: 'splitting…' } as any));
    try {
      const prompt = `This text was merged from two paragraphs. Split it back at the natural boundary.
Minimally rewrite each half so it reads as a standalone paragraph.
Use the originals as context for where the boundary should fall.
Reply with exactly two parts separated by the delimiter: <<<SPLIT>>>

merged_text: ${textA}\n\n${textB}
original_paragraph_1: ${slotA.textAtMerge}
original_paragraph_2: ${slotB.textAtMerge}`;

      const result = await callLLM(prompt);
      const parts = result.split('<<<SPLIT>>>');
      if (parts.length < 2) throw new Error('LLM did not return <<<SPLIT>>> delimiter');
      const newTextA = parts[0].trim();
      const newTextB = parts[1].trim();

      setBoxes(bs => {
        const rest = bs.filter(b => b.id !== boxId);
        const makeRestored = (slot: MergedSlot, newText: string, isA: boolean): Box => {
          const newVid = `v${slot.versions.length}`;
          const versions = [...slot.versions, {
            id: newVid, text: newText, parentId: slot.currentVid,
            targetPct: 1, included: true, annotation: '',
          }];
          return {
            id: isA ? slotA.sourceId : slotB.sourceId,
            x: isA ? slotA.originalX : slotB.originalX,
            y: isA ? slotA.originalY : slotB.originalY,
            w: isA ? slotA.originalW : slotB.originalW,
            h: isA ? slotA.originalH : slotB.originalH,
            versions, currentVid: newVid,
            calibChars: isA ? slotA.calibChars : slotB.calibChars,
            calibArea: isA ? slotA.calibArea : slotB.calibArea,
            annotation: isA ? slotA.annotation : slotB.annotation,
            fontSize: isA ? slotA.fontSize : slotB.fontSize,
          };
        };
        return [...rest, makeRestored(slotA, newTextA, true), makeRestored(slotB, newTextB, false)];
      });
    } catch (err: any) {
      toast(`split failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const stitchBox = useCallback(async (boxId: string) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box?.merged || box.merged.stitched) return;

    const textA = slotCurrentText(box.merged.slotA);
    const textB = slotCurrentText(box.merged.slotB);

    updateBox(boxId, b => ({ ...b, _status: 'stitching…' } as any));
    try {
      const prompt = `Combine these two paragraphs into a single continuous paragraph with no separation. Make the content flow as naturally as possible. Reply with the combined text only — no newlines between what were the two paragraphs.

paragraph_1: ${textA}
paragraph_2: ${textB}`;

      const result_final = await callLLM(prompt);
      if (!result_final.trim()) throw new Error('LLM returned empty response');

      updateBox(boxId, b => {
        const newVid = `v${b.versions.length}`;
        return {
          ...b,
          versions: [...b.versions, { id: newVid, text: result_final, parentId: null, targetPct: 1, included: true, annotation: '' }],
          currentVid: newVid,
          calibChars: result_final.length,
          calibArea: b.w * b.h,
          merged: { ...b.merged!, stitched: true },
          _status: '',
        } as any;
      });
    } catch (err: any) {
      toast(`stitch failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  // =============================================================================
  // rewrite pipeline
  // =============================================================================
  // TODO(abort-resize): add AbortController per box to cancel in-flight LLM calls when a new
  // resize fires before the previous one completes. Pattern:
  //   const abortRefs = useRef<Map<string, AbortController>>(new Map())
  //   On new resize: abortRefs.current.get(boxId)?.abort(); const ctrl = new AbortController(); abortRefs.current.set(boxId, ctrl);
  //   Pass ctrl.signal to callLLM (add signal param to callLLM/streamLLM → pass to pi-ai complete() options).
  //   On completion/error: abortRefs.current.delete(boxId).

  // TODO(debounce-resize): debounce corner drag → LLM trigger by 300ms so rapid small drags
  // don't each fire a request. Use a per-box timeout ref, clear on each new pointerup,
  // only fire runResize after 300ms of no new drags. Same abort pattern as above.

  const runResize = useCallback(async (boxId: string, newArea: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; origX: number; origY: number; origW: number; origH: number; anchor: AnchorCorner }) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box) return;

    // origX/Y/W/H from resizeInfo is the pre-drag snapshot captured in startResize
    // box.x/y/w/h at this point is the dragged position (stale from move handler)
    const origX = resizeInfo?.origX ?? box.x;
    const origY = resizeInfo?.origY ?? box.y;
    const origW = resizeInfo?.origW ?? box.w;
    const origH = resizeInfo?.origH ?? box.h;

    if (resizeInfo && loadConfirmRewrite()) {
      updateBox(boxId, b => ({ ...b, x: origX, y: origY, w: origW, h: origH }));
    }

    // merged pre-stitch: rewrite each slot independently
    if (box.merged && !box.merged.stitched) {
      const { slotA, slotB } = box.merged;
      const totalChars = slotCurrentText(slotA).length + slotCurrentText(slotB).length;
      if (totalChars === 0) return;
      const calibArea = box.calibArea || newArea;
      const ratio = newArea / calibArea;
      const totalTarget = Math.max(40, Math.round(totalChars * ratio));
      const fracA = slotCurrentText(slotA).length / totalChars;
      const targetA = Math.max(20, Math.round(totalTarget * fracA));
      const targetB = Math.max(20, totalTarget - targetA);

      updateBox(boxId, b => ({ ...b, _status: 'rewriting…' } as any));

      const rewriteSlot = async (text: string, target: number, annotation: string) => {
        const tmpl = loadTmpl();
        const userKeys = loadUserKeys();
        const { missingRequired, undefinedKeys } = validateTmpl(tmpl, userKeys);
        if (missingRequired.length || undefinedKeys.length) throw new Error('template invalid — open settings');
        const vars: Record<string, string> = {
          v0_text: text, target_count: String(target),
          annotation: annotation || '(none)', included_versions: '(none)',
          ...userKeys,
        };
        return callLLM(renderTmpl(tmpl, vars));
      };

      try {
        const [newA, newB] = await Promise.all([
          rewriteSlot(slotCurrentText(slotA), targetA, slotA.annotation),
          rewriteSlot(slotCurrentText(slotB), targetB, slotB.annotation),
        ]);
        updateBox(boxId, b => {
          if (!b.merged) return b;
          const makeNewSlot = (slot: MergedSlot, newText: string) => {
            const newVid = `v${slot.versions.length}`;
            return { ...slot, versions: [...slot.versions, { id: newVid, text: newText, parentId: slot.currentVid, targetPct: 1, included: true, annotation: '' }], currentVid: newVid };
          };
          return { ...b, merged: { ...b.merged!, slotA: makeNewSlot(b.merged!.slotA, newA), slotB: makeNewSlot(b.merged!.slotB, newB) }, calibArea: newArea, _status: '' } as any;
        });
      } catch (err: any) {
        toast(`rewrite failed: ${err.message || err}`);
        updateBox(boxId, b => ({ ...b, _status: '' } as any));
      }
      return;
    }

    if (box.versions.length === 0) return;
    const tmpl = loadTmpl();
    const userKeys = loadUserKeys();
    const { missingRequired, undefinedKeys } = validateTmpl(tmpl, userKeys);
    if (missingRequired.length || undefinedKeys.length) { toast('template invalid — open settings'); return; }

    const parent = box.versions.find(v => v.id === box.currentVid) ?? box.versions[0];
    const v0 = box.versions[0];
    const calibArea = box.calibArea || newArea;
    const ratio = newArea / calibArea;
    const targetChars = Math.max(20, Math.round(box.calibChars * ratio));
    // ~4 chars/token for English; add 50% buffer; clamp to [256, 16384]
    const smartMaxTokens = Math.min(16384, Math.max(256, Math.round(targetChars / 4 * 1.5)));
    const currentText = parent.text;
    const buildInitialPrompt = () => {
      const vars: Record<string, string> = {
        v0_text: v0.text,
        target_count: String(targetChars),
        current_count: String(currentText.length),
        annotation: box.annotation || '(none)',
        included_versions: includedVersionsBlock(box) || '(none)',
        ...userKeys,
      };
      return renderTmpl(tmpl, vars);
    };

    const pct = Math.round((targetChars / Math.max(1, box.calibChars)) * 100);
    updateBox(boxId, b => ({ ...b, _status: `rewriting: ${targetChars}c | ${pct}%` } as any));

    const commitText = (text: string) => {
      if (!text.trim()) { toast('rewrite failed: empty response'); updateBox(boxId, b => ({ ...b, _status: '' } as any)); return; }
      if (loadConfirmRewrite()) {
        updateBox(boxId, b => ({
          ...b,
          pendingRewrite: {
            text,
            originalChars: currentText.length,
            targetChars,
            targetX: resizeInfo?.nx ?? b.x, targetY: resizeInfo?.ny ?? b.y,
            targetW: resizeInfo?.nw ?? b.w, targetH: resizeInfo?.nh ?? b.h,
            origX, origY, origW, origH,
            anchor: resizeInfo?.anchor ?? 'tl',
            topBox: 'ghost',
          },
          _status: '',
        } as any));
      } else {
        const newId = `v${box.versions.length}`;
        const targetPct = parent.text.length ? text.length / parent.text.length : 1;
        updateBox(boxId, b => ({
          ...b,
          versions: [...b.versions, { id: newId, text, parentId: parent.id, targetPct, included: true, annotation: b.annotation }],
          currentVid: newId, _status: '',
        } as any));
      }
    };

    try {
      const initialPrompt = buildInitialPrompt();

      if (loadStreamMode() && !loadConfirmRewrite()) {
        // stream directly to textarea DOM, commit on done
        const ta = document.querySelector<HTMLTextAreaElement>(`.box[data-id="${boxId}"] textarea.main`);
        if (ta) {
          ta.value = '';
          ta.disabled = true;
        }
        await new Promise<void>((resolve, reject) => {
          streamLLM(
            initialPrompt,
            (word) => { if (ta) ta.value += word; },
            (fullText) => { if (ta) { ta.disabled = false; ta.scrollTop = 0; } commitText(fullText); resolve(); },
            (msg) => { if (ta) ta.disabled = false; reject(new Error(msg)); },
            smartMaxTokens,
          );
        });
        return;
      }

      const text = await callLLM(initialPrompt, smartMaxTokens);
      commitText(text);
    } catch (err: any) {
      toast(`rewrite failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const acceptRewrite = useCallback((boxId: string) => {
    setBoxes(bs => bs.map(b => {
      if (b.id !== boxId || !b.pendingRewrite) return b;
      const { text, targetX, targetY, targetW, targetH } = b.pendingRewrite;
      const newId = `v${b.versions.length}`;
      const parent = b.versions.find(v => v.id === b.currentVid) ?? b.versions[0];
      const targetPct = parent?.text.length ? text.length / parent.text.length : 1;
      return {
        ...b,
        x: targetX, y: targetY, w: targetW, h: targetH,
        versions: [...b.versions, { id: newId, text, parentId: parent?.id ?? null, targetPct, included: true, annotation: b.annotation }],
        currentVid: newId,
        pendingRewrite: undefined,
      };
    }));
  }, []);

  const rejectRewrite = useCallback((boxId: string) => {
    // restore original dims (box was snapped back already, nothing to do for position)
    updateBox(boxId, b => ({ ...b, pendingRewrite: undefined }));
  }, [updateBox]);

  const toggleRewriteTop = useCallback((boxId: string) => {
    updateBox(boxId, b => {
      if (!b.pendingRewrite) return b;
      return { ...b, pendingRewrite: { ...b.pendingRewrite, topBox: b.pendingRewrite.topBox === 'ghost' ? 'original' : 'ghost' } };
    });
  }, [updateBox]);

  const runDensity = useCallback(async (boxId: string) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box || box.versions.length === 0) return;
    const v = box.versions.find(x => x.id === box.currentVid);
    if (!v?.text) return;

    const concept = loadDensityConcept();
    const visual = loadDensityVisual();
    const tmpl = loadDensityTmpl();
    const prompt = tmpl
      .replace('{{concept}}', concept)
      .replace('{{text}}', v.text);

    updateBox(boxId, b => ({ ...b, _status: 'scoring…' } as any));
    try {
      const result = await callLLM(prompt);
      // strip possible markdown fences
      const json = result.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
      const spans: DensitySpan[] = JSON.parse(json);
      if (!Array.isArray(spans)) throw new Error('expected JSON array');
      updateBox(boxId, b => ({ ...b, density: { spans, visual }, _status: '' } as any));
    } catch (err: any) {
      toast(`density scoring failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const runTranslateBox = useCallback(async (boxId: string, register: string) => {
    const box = boxes.find(b => b.id === boxId);
    const v = box?.versions.find(v => v.id === box.currentVid);
    if (!v?.text) return;
    updateBox(boxId, b => ({ ...b, _status: `translating: ${register}` } as any));
    try {
      const text = await callLLM(
        `Rewrite the following text as ${register}. Preserve all meaning. Reply with the rewritten text only.\n\ntext: ${v.text}`
      );
      if (!text.trim()) throw new Error('empty response');
      const newId = `v${box!.versions.length}`;
      updateBox(boxId, b => ({
        ...b,
        versions: [...b.versions, { id: newId, text, parentId: v.id, targetPct: text.length / v.text.length, included: true, annotation: b.annotation }],
        currentVid: newId, _status: '',
      } as any));
    } catch (err: any) {
      toast(`translate failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const runTranslateSpan = useCallback(async (boxId: string, start: number, end: number, register: string) => {
    const box = boxes.find(b => b.id === boxId);
    const v = box?.versions.find(v => v.id === box.currentVid);
    if (!v?.text) return;
    const spanText = v.text.slice(start, end);
    if (!spanText.trim()) return;
    setActiveSpan(null);
    updateBox(boxId, b => ({ ...b, _status: `translating span: ${register}` } as any));
    try {
      const translated = await callLLM(
        `Rewrite the following span as ${register}. Preserve meaning. Match the surrounding style. Reply with the rewritten span only.\n\nFull context: ${v.text}\n\nSpan to rewrite: ${spanText}`
      );
      if (!translated.trim()) throw new Error('empty response');
      const mode = loadSpanDiffMode();
      // splice both original + new text into the textarea: ...before...[original][new]...after...
      // original stays at [start..end], new text inserted at end
      const combined = v.text.slice(0, end) + translated + v.text.slice(end);
      const newId = `v${box!.versions.length}`;
      updateBox(boxId, b => ({
        ...b,
        versions: [...b.versions, { id: newId, text: combined, parentId: v.id, targetPct: combined.length / v.text.length, included: true, annotation: b.annotation }],
        currentVid: newId,
        pendingSpanDiff: mode !== 'ghost' ? { strikeStart: start, strikeEnd: end, insertEnd: end + translated.length, mode } : undefined,
        _status: '',
      } as any));
    } catch (err: any) {
      toast(`translate span failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [boxes, toast, updateBox]);

  const runShakeSpan = useCallback((boxId: string, start: number, end: number) => {
    // activate shake mode on the span overlay — LLM fires when gesture detected
    setActiveSpan(prev => prev ? { ...prev, shakeActive: true } : { boxId, start, end, screenX: 0, screenY: 0, shakeActive: true });
  }, []);

  const onShakeDetected = useCallback(async (boxId: string) => {
    const span = activeSpan;
    if (!span || span.boxId !== boxId) return;
    const box = boxes.find(b => b.id === boxId);
    const v = box?.versions.find(v => v.id === box.currentVid);
    if (!v?.text) return;
    const spanText = v.text.slice(span.start, span.end);
    if (!spanText.trim()) return;
    setActiveSpan(prev => prev ? { ...prev, shakeActive: false } : null);
    updateBox(boxId, b => ({ ...b, _status: 'finding alternatives…' } as any));
    try {
      const result = await callLLM(
        `Give 4 alternative phrasings for the following span. Match the style, tone, and register of the original exactly.\nFull context: ${v.text}\nSpan: ${spanText}\nReply as a JSON array of strings only. No explanation.`
      );
      const json = result.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim();
      const alternatives: string[] = JSON.parse(json);
      if (!Array.isArray(alternatives)) throw new Error('expected JSON array');
      updateBox(boxId, b => ({ ...b, _shakeResult: { start: span.start, end: span.end, originalText: spanText, alternatives }, _status: '' } as any));
    } catch (err: any) {
      toast(`shake failed: ${err.message || err}`);
      updateBox(boxId, b => ({ ...b, _status: '' } as any));
    }
  }, [activeSpan, boxes, toast, updateBox]);

  const acceptSpanDiff = useCallback((boxId: string) => {
    // remove the original span [strikeStart..strikeEnd], keep the new text [strikeEnd..insertEnd]
    setBoxes(bs => bs.map(b => {
      if (b.id !== boxId || !b.pendingSpanDiff) return b;
      const { strikeStart, strikeEnd, insertEnd } = b.pendingSpanDiff;
      const v = b.versions.find(v => v.id === b.currentVid);
      if (!v) return b;
      const accepted = v.text.slice(0, strikeStart) + v.text.slice(strikeEnd, insertEnd) + v.text.slice(insertEnd);
      const newId = `v${b.versions.length}`;
      return { ...b, versions: [...b.versions, { id: newId, text: accepted, parentId: v.id, targetPct: accepted.length / v.text.length, included: true, annotation: b.annotation }], currentVid: newId, pendingSpanDiff: undefined } as any;
    }));
  }, []);

  const rejectSpanDiff = useCallback((boxId: string) => {
    // remove the new text [strikeEnd..insertEnd], keep the original [strikeStart..strikeEnd]
    setBoxes(bs => bs.map(b => {
      if (b.id !== boxId || !b.pendingSpanDiff) return b;
      const { strikeEnd, insertEnd } = b.pendingSpanDiff;
      const v = b.versions.find(v => v.id === b.currentVid);
      if (!v) return b;
      const rejected = v.text.slice(0, strikeEnd) + v.text.slice(insertEnd);
      const newId = `v${b.versions.length}`;
      return { ...b, versions: [...b.versions, { id: newId, text: rejected, parentId: v.id, targetPct: rejected.length / v.text.length, included: true, annotation: b.annotation }], currentVid: newId, pendingSpanDiff: undefined } as any;
    }));
  }, []);

  const acceptShake = useCallback((boxId: string, alternative: string) => {
    setBoxes(bs => bs.map(b => {
      if (b.id !== boxId) return b;
      const shake = (b as any)._shakeResult;
      if (!shake) return b;
      const v = b.versions.find(v => v.id === b.currentVid);
      if (!v) return b;
      const newText = v.text.slice(0, shake.start) + alternative + v.text.slice(shake.end);
      const newId = `v${b.versions.length}`;
      return {
        ...b,
        versions: [...b.versions, { id: newId, text: newText, parentId: v.id, targetPct: newText.length / v.text.length, included: true, annotation: b.annotation }],
        currentVid: newId, _shakeResult: undefined,
      } as any;
    }));
  }, []);

  // =============================================================================
  // TODO(span-ops): span-level operations
  // All require reading textarea selectionStart/selectionEnd to get the highlighted span.
  // Capture on textarea mouseup/keyup in BoxComponent, store as { boxId, start, end } in App state.
  // Show a floating mini-toolbar near the selection (position via getBoundingClientRect of selection,
  // or approximate via pretext char position map) with icons for each operation below.
  // =============================================================================

  // TODO(span-lock): implement lockSpan(boxId, start, end).
  // Adds { start, end, text: currentText.slice(start,end) } to box.lockedSpans[].
  // Modify buildInitialPrompt in runResize to append:
  //   "\n\nThe following spans must not be changed:\n" + lockedSpans.map(s => `"${s.text}"`).join('\n')
  // Render locked spans as dotted green underline via canvas overlay (extend DensityOverlay).
  // Mini-toolbar icon: 🔒. Second click on a locked span removes the lock.

  // TODO(span-resize): implement runSpanResize(boxId, start, end, targetPct).
  // targetPct comes from a small slider or +/- buttons in the mini-toolbar (e.g. 50%, 150%).
  // Prompt:
  //   "Rewrite only the following span so it is approximately {{target_count}} characters
  //    (currently {{current_count}} characters). Do not change anything outside the span.
  //    Preserve the meaning and style of the original.
  //
  //    Full text for context:
  //    {{box_text}}
  //
  //    Span to rewrite (chars {{start}}–{{end}}):
  //    {{span_text}}
  //
  //    Reply with the rewritten span text only."
  // Result: splice into current version text at [start, end], push new version.
  // Ghost the result the same way as full-box rewrite (pending span rewrite + accept/reject).

  // TODO(span-shake): implement runSpanShake(boxId, start, end).
  // Gets 3-5 alternative phrasings for the selected span.
  // Prompt:
  //   "Give 3-5 alternative phrasings for the following span. Match the style and register exactly.
  //    Full context: '{{box_text}}'
  //    Span: '{{span_text}}'
  //    Reply as a JSON array of strings only."
  // Result: stored as box.shakeResults = { start, end, originalText, alternatives }.
  // Rendered as a popover near the span with each alternative as a clickable item.
  // Accepting: splices alternative into text at [start, end], push new version, clear shakeResults.
  // Mini-toolbar icon: 〜 or ✦

  // TODO(span-strikethrough): implement toggleStrikethrough(boxId, start, end).
  // Adds/removes { start, end } from box.strikethroughSpans[].
  // Rendered as red strikethrough via canvas overlay.
  // Optional "annotate loss" button in mini-toolbar (appears when span is struck):
  //   Prompt: "The author has struck through this text: '{{span_text}}'
  //            Full piece: '{{box_text}}'
  //            In 1-2 sentences, what does this piece lose without it? Be specific and concrete."
  //   Result shown as a tooltip on hover over the strikethrough span.
  // Mini-toolbar icon: S̶ (strikethrough S). Second click removes strikethrough.

  // TODO(annotate): implement runAnnotation(boxIds, highlight, userRequest).
  // (Full spec in earlier TODO block — freeform conversation / google docs mode.)
  // This is the entry point for all span-level freeform requests not covered above:
  // user selects text, types a request, LLM returns Op[] (comment + optional edit hunks).

  // TODO(tree-fold): implement runTreeFold(boxId).
  // Sends the box text to LLM with prompt:
  //   "Please copy the following content verbatim, but format it as a tree structure based on the
  //    logical relationships between sentences, using outline (- <text>) notation. Output in Markdown
  //    format. Remember: do not summarize, modify, or editorialize in any way.\n\n{{text}}"
  // Result is pushed as a new version on the box (same version model as resize/translate).
  // The box should switch to a read-only rendered Markdown view for tree versions (detect if currentVid
  // text starts with "- " or "#"). User can switch back to plain text via versions popover.
  // Pill: 🌲 or "⊞" at next pill slot in SelectionOverlay.
  // Future: allow collapsing/expanding individual tree nodes inline (click to fold subtree).

  // TODO(translate): implement runTranslate(boxId, register).
  // register is a free-text string: "portuguese", "pirate speak", "linkedin", "ELI5", etc.
  // Prompt: "Rewrite the following text as {{register}}. Preserve meaning. Reply with rewritten text only.\n\ntext: {{text}}"
  // callLLM, push new version. Wire to 🌐 pill in SelectionOverlay.

  // TODO(annotate): implement runAnnotation(boxIds, highlight, userRequest).
  // LLM returns structured Op[] — mix of comment and edit operations anchored by char offsets.
  // Op schema:
  //   { type: 'comment'; start: number; end: number; text: string; id: string }
  //   { type: 'edit'; start: number; end: number; delete: string; insert: string; id: string }
  // Settings toggle: annotation mode = off | comments-only | comments+diffs
  // Settings toggle: diff style = google-docs (inline strikethrough+insertion) | margin-only
  //
  // Context model: user can shift-click to select multiple boxes. Text highlight in a textarea
  // is also captured (selectionStart/selectionEnd on the textarea DOM node).
  // Prompt structure:
  //   context_boxes: {{all selected box texts, labeled by box id}}
  //   highlighted_portion: {{highlighted text if any}}
  //   user_request: {{what user typed}}
  //
  // When diffs disabled, system prompt tells LLM to only return comment ops.
  // When enabled, LLM may return either type.
  //
  // Conversation/follow-up: AnnotationThread stored per box (or multi-box selection):
  //   { id, boxIds, highlight?: {boxId,start,end}, messages: {role,content,ops?}[] }
  // Follow-up turns append to messages and re-call LLM with full history.
  // Tree threading: each comment op can spawn a child thread. Linear threading acceptable as v1.
  //
  // Rendering: pretext overlay (same approach as density).
  //   - comment ops: colored underline on span. Click opens thread panel.
  //   - edit ops (google-docs): red strikethrough over delete text, green insertion after. Accept/reject per hunk.
  //   - edit ops (margin-only): before/after shown in thread panel only.
  //
  // Accept/reject: per-op granularity. Accepting an edit commits insert, creates new version.
  // "Accept all" / "Reject all" in thread panel header.
  //
  // Tools / web search: pass webSearch(query) tool to LLM. User provides search API key in settings.
  // LLM can invoke mid-annotation to find citations. pi-ai supports ToolCall in AssistantMessage content.
  //
  // Cancellation: add AbortController per box, cancel on new annotation request.
  // Debounce: 300ms debounce on resize trigger to avoid rapid-fire calls.

  // TODO(export-save): serialize canvas state to JSON and restore it.
  // State to persist: boxes[] (x,y,w,h,versions,currentVid,calibChars,calibArea,annotation,fontSize,merged,density).
  // UI: "export" button in Toolbar → downloads JSON. "import" button → file picker, restores state.
  // Also consider localStorage autosave (throttled, e.g. every 30s) so refresh doesn't lose work.
  // On import, reassign box IDs to avoid collisions with nextBoxId counter.

  // TODO(multi-box-selection): shift-click a box to add it to a selection set.
  // State: selectedIds: Set<string> (replace selectedId: string | null).
  // Visual: all selected boxes get the blue selection ring (SelectionOverlay rendered for each).
  // Used as context for annotation: when user opens annotation input, all selectedIds' texts
  // are sent as context_boxes. Also used for batch translate/density/tree-fold.
  // Lasso selection: drag on empty canvas (without space) draws a rect, selects all boxes it intersects.

  // TODO(review-batch): canned "review" prompts that run annotation across selected boxes.
  // Presets (shown as buttons in a toolbar or pill popover):
  //   - "logical fallacies" — find logical fallacies, annotate each as a comment op
  //   - "clarity" — flag unclear sentences, suggest rewrites as diff ops
  //   - "flow" — check paragraph transitions, suggest seam edits
  //   - "citations needed" — flag unsupported claims (pairs with web search TODO)
  // Each preset fires runAnnotation(selectedBoxIds, null, presetPrompt).
  // Results are Op[] (comment + optional edit), rendered via SpanOverlay + comment bubbles.

  // TODO(tension-map): background pass that scores each box on multiple axes continuously.
  // Axes: clarity (0–1), specificity (0–1), energy (0–1).
  // Runs automatically after text settles (debounced 2s after last edit).
  // Results tint the box header or border with a subtle color (not the full density overlay).
  // E.g. low clarity = slight orange border, low energy = slight blue wash.
  // Prompt: "Score the following text on three axes from 0.0 to 1.0:
  //   clarity (how easy it is to understand), specificity (how concrete/specific),
  //   energy (how engaging/active the prose is).
  //   Reply as JSON: {\"clarity\": 0.0, \"specificity\": 0.0, \"energy\": 0.0}"
  // Runs in the background without blocking the UI (fire-and-forget, no status indicator).

  const togglePopover = useCallback((boxId: string, kind: PopoverKind) => {
    setPopover(p => (p?.boxId === boxId && p?.kind === kind) ? null : { boxId, kind });
  }, []);

  const exportCanvas = useCallback(() => {
    const snap = { version: 1, boxes, nextBoxId };
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `annotate-resize-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [boxes]);

  const importCanvas = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.boxes)) throw new Error('missing boxes[]');
        if (!confirm(`Replace current canvas with ${parsed.boxes.length} boxes from "${file.name}"? Current work will be discarded.`)) return;
        nextBoxId = typeof parsed.nextBoxId === 'number' ? parsed.nextBoxId : parsed.boxes.length;
        setBoxes(parsed.boxes);
        setSelectedId(parsed.boxes[0]?.id ?? null);
        setPopover(null);
        toast(`imported ${parsed.boxes.length} boxes`, 'ok');
      } catch (err: any) {
        toast(`import failed: ${err.message || err}`);
      }
    };
    input.click();
  }, [toast]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        backgroundImage: 'radial-gradient(circle, #e6e7eb 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />

      <div
        id="viewport"
        style={{ position: 'fixed', inset: 0 }}
        onPointerDown={handleViewportPointerDown}
        onPointerMove={handleViewportPointerMove}
        onPointerUp={handleViewportPointerUp}
        onDoubleClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('.box,.sidebar,.toolbar,.sidebarToggle,.popover')) return;
          const pz = panzoomRef.current;
          const scale = pz?.getScale() ?? 1;
          const pan = pz?.getPan() ?? { x: 0, y: 0 };
          const wx = e.clientX / scale - pan.x - 210;
          const wy = e.clientY / scale - pan.y - 110;
          addBox('', wx, wy);
        }}
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
            onMerge={mergeBoxes}
            onScissor={scissorBox}
            onStitch={stitchBox}
            onRunDensity={runDensity}
            onAcceptRewrite={acceptRewrite}
            onRejectRewrite={rejectRewrite}
            onToggleRewriteTop={toggleRewriteTop}
            onSpanSelected={(boxId, s, e, sx, sy) => setActiveSpan({ boxId, start: s, end: e, screenX: sx, screenY: sy })}
            onRunTranslateBox={runTranslateBox}
            activeSpan={activeSpan}
            onShakeDetected={onShakeDetected}
            onAcceptSpanDiff={acceptSpanDiff}
            onRejectSpanDiff={rejectSpanDiff}
            fitMode={loadFitMode()}
            toast={toast}
          />
        </div>
      </div>

      {activeSpan && (
        <SpanToolbar
          boxId={activeSpan.boxId}
          start={activeSpan.start}
          end={activeSpan.end}
          screenX={activeSpan.screenX}
          screenY={activeSpan.screenY}
          onTranslate={(boxId, s, e, register) => runTranslateSpan(boxId, s, e, register)}
          onShake={(boxId, s, e) => runShakeSpan(boxId, s, e)}
          onDismiss={() => setActiveSpan(null)}
        />
      )}

      {boxes.map(b => {
        const shake = (b as any)._shakeResult;
        if (!shake) return null;
        const ta = document.querySelector<HTMLTextAreaElement>(`.box[data-id="${b.id}"] textarea.main`);
        const rect = ta?.getBoundingClientRect();
        return (
          <ShakePopover
            key={b.id}
            boxId={b.id}
            result={shake}
            onAccept={acceptShake}
            onDismiss={id => updateBox(id, b => ({ ...b, _shakeResult: undefined } as any))}
            screenX={rect ? rect.left + rect.width / 2 : 400}
            screenY={rect ? rect.top : 200}
          />
        );
      })}

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
        onExport={exportCanvas}
        onImport={importCanvas}
      />

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} toast={toast} />
      <Toast toasts={toasts} onDismiss={id => setToasts(t => t.filter(x => x.id !== id))} />
    </div>
  );
}
