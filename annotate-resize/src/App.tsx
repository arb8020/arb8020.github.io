import { useEffect, useRef, useCallback, useState } from 'react';
import Panzoom, { type PanzoomObject } from '@panzoom/panzoom';
import { Canvas } from './components/Canvas';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { Toast } from './components/Toast';
import type { Box, MergedSlot, SnapCandidate, PopoverKind, DensitySpan, AnchorCorner } from './types';
import { loadFitMode, loadDensityTmpl, loadDensityConcept, loadDensityVisual, loadConfirmRewrite } from './storage';
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
  const runResize = useCallback(async (boxId: string, newArea: number, resizeInfo?: { nx: number; ny: number; nw: number; nh: number; anchor: AnchorCorner }) => {
    const box = boxes.find(b => b.id === boxId);
    if (!box) return;

    // if confirm mode and we have resize geometry, snap box back to original dims
    // so it stays at original size while ghost animates to target
    const origX = box.x, origY = box.y, origW = box.w, origH = box.h;
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

    updateBox(boxId, b => ({ ...b, _status: 'rewriting…' } as any));
    try {
      const initialPrompt = buildInitialPrompt();
      const text = await callLLM(initialPrompt);
      if (!text.trim()) throw new Error('LLM returned empty response');
      // User can re-drag the ghost if the size isn't right — no auto-retry loop.

      if (loadConfirmRewrite()) {
        updateBox(boxId, b => ({
          ...b,
          pendingRewrite: {
            text,
            targetX: resizeInfo?.nx ?? b.x,
            targetY: resizeInfo?.ny ?? b.y,
            targetW: resizeInfo?.nw ?? b.w,
            targetH: resizeInfo?.nh ?? b.h,
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

  const togglePopover = useCallback((boxId: string, kind: PopoverKind) => {
    setPopover(p => (p?.boxId === boxId && p?.kind === kind) ? null : { boxId, kind });
  }, []);

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
            fitMode={loadFitMode()}
            toast={toast}
          />
        </div>
      </div>

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
