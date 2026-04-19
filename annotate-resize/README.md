# annotate-resize

Infinite canvas text editor with LLM-powered rewriting, merging, density scoring, and span-level editing.

## Running

```bash
cd annotate-resize
npm install
./dev.sh              # opens tmux session, serves at http://localhost:5173
./dev.sh --no-attach  # same but stays in current shell (for scripting)
```

The dev server writes browser console output to `logs/browser_YYYY-MM-DDTHH-MM-SS.jsonl` automatically via the vite-plugin-browser-log plugin. Useful for debugging without opening devtools.

There's also a `/dev/eval` endpoint — POST `{"code": "..."}` to execute JS in the browser and get the result back:

```bash
curl -s -X POST http://localhost:5173/dev/eval \
  -H "Content-Type: application/json" \
  -d '{"code": "document.querySelectorAll(\".box\").length + \" boxes\""}'
```

## Building

```bash
npm run build   # type-checks + vite build → dist/
```

The GitHub Actions workflow at `.github/workflows/deploy-annotate-resize.yml` rebuilds `dist/` on push to main and deploys to GitHub Pages at `/annotate-resize/dist/`.

## Architecture

```
src/
  App.tsx                  — root state, all LLM call handlers, box CRUD
  types.ts                 — Box, Version, MergedState, PendingRewrite, PendingSpanDiff, etc.
  storage.ts               — localStorage keys, load/save for all settings
  llm.ts                   — callLLM, streamLLM, callLLMMultiTurn (pi-ai wrapper)
  template.ts              — prompt template rendering and validation
  components/
    Canvas.tsx             — renders all boxes, snap ghost, selection overlay, passes callbacks down
    BoxComponent.tsx       — single box: drag, resize, auto-fit, textarea sync, span selection
    SelectionOverlay.tsx   — selection ring, resize handles, side pills, popovers
    GhostBox.tsx           — animated proposed-rewrite ghost with accept/reject/toggle
    SpanToolbar.tsx        — floating mini-toolbar on text selection (translate, shake)
    SpanOverlay.tsx        — canvas layer: selection highlight, shake drag, span diff coloring
    DensityOverlay.tsx     — canvas layer: density/importance heatmap via pretext
    pretext-utils.ts       — shared buildCharRects/spanLineRects using @chenglou/pretext
    Sidebar.tsx            — settings panel (provider, model, template, fit mode)
    Toolbar.tsx            — bottom bar (add box, zoom controls)
    Toast.tsx              — toast notifications
```

Key invariants:
- `box.calibChars` and `box.calibArea` are always the char count and pixel area at the time text was last set. `runResize` uses their ratio to compute the target char count.
- `fitWiden` recalibrates both whenever it changes box dimensions, so the ratio stays correct.
- `pendingRewrite` on a box means the LLM result landed and is awaiting accept/reject. The box is snapped back to original dims; the ghost shows the proposed size.
- `pendingSpanDiff` on a box means the textarea holds `original + new` text concatenated. `strikeStart..strikeEnd` = original, `strikeEnd..insertEnd` = new.

## Settings

All settings are stored in `localStorage` with `ar.*` prefix. Key ones:

| Key | Default | Description |
|-----|---------|-------------|
| `ar.activeProvider` | `openrouter` | LLM provider |
| `ar.activeModel` | — | Model ID |
| `ar.key.<provider>` | — | API key per provider |
| `ar.fitMode` | `widen` | Overflow strategy: `widen` or `shrink` |
| `ar.confirmRewrite` | `true` | Show ghost diff before committing rewrite |
| `ar.streamMode` | `true` | Stream LLM output word-by-word |
| `ar.spanDiffMode` | `google-docs` | Span edit rendering: `google-docs`, `code-diff`, or `ghost` |
| `ar.densityConcept` | `importance` | Concept word for density scoring |
| `ar.densityVisual` | `heatmap` | Density render mode: `heatmap` or `opacity` |

## Key interactions

- **Double-click** empty canvas → create box
- **Backspace** with box selected → delete box
- **Corner drag** → LLM rewrite (ghost diff if confirm mode on)
- **Edge drag** → geometric resize only
- **Drag box near another** → snap-to-merge, LLM suggests boundary transitions
- **Select text in box** → mini-toolbar appears (translate span, shake for alternatives)
- **Shake selected span** → drag back and forth ≥3 times → LLM returns alternatives
- **◉ pill** → density scoring (heatmap/opacity overlay via pretext)
- **🌐 pill** → translate whole box
- **Space + drag** or **middle-mouse drag** → pan canvas
- **Ctrl + scroll** or **pinch** → zoom
- **Two-finger scroll** → pan

## TODOs

See inline `// TODO(...)` comments throughout `src/`. Key open items:
- `TODO(sidebar-settings)` — expose all settings toggles in Sidebar UI
- `TODO(annotate)` — freeform comment/conversation mode (google docs style)
- `TODO(span-resize)` — drag handles on span edges to resize in place
- `TODO(span-lock)` — lock spans from LLM modification
- `TODO(span-strikethrough)` — mark deletions, annotate what's lost
- `TODO(tree-fold)` — reformat text as outline tree (verbatim)
- `TODO(translate)` — translate box pill (🌐 already done; tree-fold pill pending)
- `TODO(abort-resize)` — AbortController to cancel in-flight LLM on new resize
- `TODO(export-save)` — JSON export/import + localStorage autosave
- `TODO(multi-box-selection)` — shift-click + lasso for annotation context
- `TODO(review-batch)` — canned review prompts (logical fallacies, clarity, flow)
- `TODO(tension-map)` — background clarity/specificity/energy scoring per box
