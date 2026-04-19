import { useState, useEffect, useCallback } from 'react';
import { getModels } from '../llm';
import { validateKey } from '../llm';
import { UNIQUE_PROVIDERS } from '../providers';
import {
  loadKey, saveKey, tail4, loadActiveProvider, saveActiveProvider,
  loadActiveModel, saveActiveModel, loadFitMode, saveFitMode,
  loadTmpl, saveTmpl, loadUserKeys, saveUserKeys,
  DEFAULT_TMPL,
  getSpend, resetSpend,
} from '../storage';
import { validateTmpl } from '../template';
import type { FitMode } from '../types';

interface ModelInfo { id: string; cost?: { input: number; output: number } }

function fuzzyRank(needle: string, hay: string): number | null {
  if (!needle) return 0;
  const n = needle.toLowerCase(), h = hay.toLowerCase();
  const idx = h.indexOf(n);
  if (idx >= 0) return idx;
  let hi = 0, score = 0;
  for (const ch of n) {
    const j = h.indexOf(ch, hi);
    if (j < 0) return null;
    score += (j - hi) + 1; hi = j + 1;
  }
  return 1000 + score;
}

function formatModelId(pid: string, id: string) {
  if (pid === 'openrouter' && id.includes('/')) {
    const slash = id.indexOf('/');
    return { prefix: id.slice(0, slash + 1), name: id.slice(slash + 1) };
  }
  return { prefix: '', name: id };
}

function priceLabel(m: ModelInfo) {
  const c = m.cost;
  if (!c) return '';
  return `$${(c.input ?? 0).toFixed(2)}/$${(c.output ?? 0).toFixed(2)}`;
}

interface Props { open: boolean; onClose: () => void; toast: (msg: string, kind?: string) => void; }

export function Sidebar({ open, onClose, toast }: Props) {
  const [provider, setProvider] = useState(loadActiveProvider);
  const [modelId, setModelId] = useState(loadActiveModel);
  const [apiKey, setApiKey] = useState(() => loadKey(loadActiveProvider()));
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelQuery, setModelQuery] = useState('');
  const [modelDropOpen, setModelDropOpen] = useState(false);
  const [fitMode, setFitMode] = useState<FitMode>(loadFitMode);
  const [tmpl, setTmpl] = useState(loadTmpl);
  const [userKeys, setUserKeys] = useState<[string, string][]>(() => Object.entries(loadUserKeys()));
  const [tmplErr, setTmplErr] = useState('');
  const [tmplOk, setTmplOk] = useState('');
  const [spend, setSpend] = useState(() => getSpend(loadActiveProvider()));
  const [validateLog, setValidateLog] = useState<string[]>([]);
  const [validateStatus, setValidateStatus] = useState('');
  const [validating, setValidating] = useState(false);

  // load models when provider changes
  useEffect(() => {
    try {
      const ms = (getModels(provider as any) ?? []) as ModelInfo[];
      setModels(ms.slice().sort((a, b) => a.id.localeCompare(b.id)));
    } catch { setModels([]); }
  }, [provider]);

  // sync api key field when provider changes
  useEffect(() => {
    setApiKey(loadKey(provider));
    setSpend(getSpend(provider));
  }, [provider]);

  const rankedModels = models
    .map(m => ({ m, r: fuzzyRank(modelQuery, m.id) }))
    .filter(x => x.r !== null)
    .sort((a, b) => a.r! - b.r!)
    .slice(0, 150);

  const onProviderChange = (p: string) => {
    setProvider(p); saveActiveProvider(p);
  };
  const onApiKeyChange = (k: string) => {
    setApiKey(k); saveKey(provider, k);
  };
  const onModelPick = (id: string) => {
    setModelId(id); saveActiveModel(id); setModelQuery('');
  };
  const onFitModeChange = (m: FitMode) => {
    setFitMode(m); saveFitMode(m);
  };

  const onSave = () => {
    const ukObj = Object.fromEntries(userKeys.filter(([k]) => k.trim()));
    const { missingRequired, missingRecommended, undefinedKeys } = validateTmpl(tmpl, ukObj);
    if (missingRequired.length) { setTmplErr(`Cannot save — missing required: ${missingRequired.map(k => '{{' + k + '}}').join(', ')}`); setTmplOk(''); return; }
    if (undefinedKeys.length) { setTmplErr(`Cannot save — undefined keys: ${undefinedKeys.map(k => '{{' + k + '}}').join(', ')}`); setTmplOk(''); return; }
    saveTmpl(tmpl); saveUserKeys(ukObj);
    setTmplErr(missingRecommended.length ? `Saved. Warning — missing recommended: ${missingRecommended.map(k => '{{' + k + '}}').join(', ')}` : '');
    setTmplOk('Saved.');
  };

  const onValidate = useCallback(async () => {
    const logs: string[] = [];
    const log = (s: string) => { logs.push(s); setValidateLog([...logs]); };
    setValidateLog([]); setValidateStatus('testing…'); setValidating(true);
    log(`provider: ${provider}`);
    log(`model: ${modelId || '(none)'}`);
    log(`key: ${apiKey ? '…' + apiKey.slice(-4) : '(empty)'} (len=${apiKey.length})`);
    log(`key has whitespace: ${/\s/.test(apiKey)}`);
    if (!apiKey) { setValidateStatus('no key'); setValidating(false); return; }
    if (!modelId) { setValidateStatus('no model selected'); setValidating(false); return; }
    try {
      log('calling complete()…');
      const res = await validateKey(provider, modelId, apiKey);
      log(`api: ${res.api}  baseUrl: ${res.baseUrl}`);
      log(`stopReason: ${res.stopReason}`);
      log(`errorMessage: ${res.errorMessage || '(none)'}`);
      log(`content: ${res.contentPreview}`);
      log(`cost: ${JSON.stringify(res.cost)}`);
      setValidateStatus(res.ok ? '✓ key valid' : `error: ${res.errorMessage}`);
      if (!res.ok) toast(`validation failed: ${res.errorMessage}`);
    } catch (err: any) {
      log(`threw: ${err.message || err}`);
      setValidateStatus(`error: ${String(err.message || err).slice(0, 60)}`);
      toast(`validation failed: ${err.message || err}`);
    }
    setValidating(false);
  }, [provider, modelId, apiKey, toast]);

  const s: React.CSSProperties = { background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', font: 'inherit', width: '100%' };
  const h4: React.CSSProperties = { margin: '16px 0 6px', fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const ghost: React.CSSProperties = { background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', padding: '6px 10px', borderRadius: 6, cursor: 'pointer' };
  const primary: React.CSSProperties = { background: 'var(--accent)', color: '#fff', border: 'none', padding: '8px 12px', borderRadius: 6, cursor: 'pointer', fontWeight: 600 };

  if (!open) return null;

  return (
    <aside style={{
      position: 'fixed', top: 48, right: 12, width: 380,
      maxHeight: 'calc(100vh - 64px)',
      background: 'var(--panel)', border: '1px solid var(--border)',
      borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
      padding: 0, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      zIndex: 250,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Settings</h3>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--muted)', lineHeight: 1, padding: '0 2px' }} title="close">✕</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

      {/* provider */}
      <h4 style={h4}>Active provider</h4>
      <select style={s} value={provider} onChange={e => onProviderChange(e.target.value)}>
        {UNIQUE_PROVIDERS.map(p => (
          <option key={p.id} value={p.id}>{p.label}{loadKey(p.id) ? '' : ' (no key)'}</option>
        ))}
      </select>

      {/* api key */}
      <h4 style={h4}>API key</h4>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 6 }}>
        <input type="password" style={s} value={apiKey} placeholder={`paste ${UNIQUE_PROVIDERS.find(p => p.id === provider)?.label} key`}
          onChange={e => onApiKeyChange(e.target.value)} />
        <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>{tail4(apiKey)}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <button style={ghost} onClick={onValidate} disabled={validating}>validate key</button>
        <span style={{ fontSize: 12, color: validateStatus.startsWith('✓') ? 'var(--ok)' : 'var(--warn)' }}>{validateStatus}</span>
      </div>
      {validateLog.length > 0 && (
        <div style={{ marginTop: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 8, font: '11px/1.5 ui-monospace,Menlo,monospace', maxHeight: 160, overflow: 'auto' }}>
          {validateLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}
      <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--muted)', marginTop: 4 }}>
        session spend: ${spend.toFixed(4)}
        <a style={{ color: 'var(--accent)', cursor: 'pointer', marginLeft: 8, textDecoration: 'none' }}
          onClick={() => { resetSpend(provider); setSpend(0); }}>reset</a>
      </div>

      {/* model */}
      <h4 style={h4}>Model</h4>
      <div style={{ position: 'relative' }}>
        <div
          onClick={() => setModelDropOpen(o => !o)}
          style={{ ...s, display: 'flex', alignItems: 'center', cursor: 'pointer', userSelect: 'none' }}
        >
          <span style={{ flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {modelId || 'select a model…'}
          </span>
          <span style={{ color: 'var(--muted)', marginLeft: 6 }}>{modelDropOpen ? '▲' : '▼'}</span>
        </div>
        {modelDropOpen && (
          <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
                        background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 2 }}>
            <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>
              <input
                autoFocus
                style={{ ...s, width: '100%' }}
                placeholder="filter models…"
                value={modelQuery}
                onChange={e => setModelQuery(e.target.value)}
              />
            </div>
            {provider === 'openrouter' && (
              <div style={{ padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>
                <a href="https://openrouter.ai/rankings?category=translation#categories" target="_blank" rel="noreferrer"
                   style={{ fontSize: 11, color: 'var(--accent)' }}>↗ OpenRouter rankings</a>
              </div>
            )}
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {rankedModels.length === 0 && <div style={{ padding: 8, color: 'var(--muted)', fontSize: 12 }}>no models available</div>}
              {rankedModels.map(({ m }) => {
                const { prefix, name } = formatModelId(provider, m.id);
                return (
                  <div key={m.id} onClick={() => { onModelPick(m.id); setModelDropOpen(false); }} style={{
                    padding: '6px 10px', cursor: 'pointer', display: 'flex', gap: 8, fontSize: 12,
                    background: m.id === modelId ? '#e4edff' : undefined,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    {prefix && <span style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace' }}>{prefix}</span>}
                    <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', flex: 1 }}>{name}</span>
                    <span style={{ color: 'var(--muted)', fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', whiteSpace: 'nowrap' }}>{priceLabel(m)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* fit mode */}
      <h4 style={h4}>Box sizing (on paste / rewrite)</h4>
      <div style={{ display: 'flex', gap: 16 }}>
        {(['grow', 'shrink'] as FitMode[]).map(m => (
          <label key={m} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="radio" name="fitMode" value={m} checked={fitMode === m} onChange={() => onFitModeChange(m)} />
            {m === 'grow' ? 'grow box to fit text' : 'shrink text to fit box'}
          </label>
        ))}
      </div>

      {/* template */}
      <h4 style={h4}>Prompt template</h4>
      <p style={{ color: 'var(--muted)', fontSize: 12, lineHeight: 1.5, margin: '0 0 6px' }}>
        Required: <code style={{ background: 'var(--panel-2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{'{{v0_text}}'}</code>{' '}
        <code style={{ background: 'var(--panel-2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{'{{target_count}}'}</code><br />
        Recommended: <code style={{ background: 'var(--panel-2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{'{{annotation}}'}</code>{' '}
        <code style={{ background: 'var(--panel-2)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{'{{included_versions}}'}</code>
      </p>
      <textarea style={{ ...s, minHeight: 180, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.45 }}
        value={tmpl} onChange={e => { setTmpl(e.target.value); setTmplOk(''); setTmplErr(''); }} />
      {tmplErr && <div style={{ color: 'var(--warn)', fontSize: 12, marginTop: 6, whiteSpace: 'pre-wrap' }}>{tmplErr}</div>}

      {/* user keys */}
      <h4 style={h4}>User-defined keys</h4>
      {userKeys.map(([k, v], i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input style={{ ...s, flex: 1 }} placeholder="key" value={k} onChange={e => setUserKeys(ks => ks.map((pair, j) => j === i ? [e.target.value, pair[1]] : pair))} />
          <input style={{ ...s, flex: 1 }} placeholder="value" value={v} onChange={e => setUserKeys(ks => ks.map((pair, j) => j === i ? [pair[0], e.target.value] : pair))} />
          <button style={ghost} onClick={() => setUserKeys(ks => ks.filter((_, j) => j !== i))}>×</button>
        </div>
      ))}
      <button style={ghost} onClick={() => setUserKeys(ks => [...ks, ['', '']])}>+ key</button>

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button style={primary} onClick={onSave}>save</button>
        <button style={ghost} onClick={() => { setTmpl(DEFAULT_TMPL); setTmplErr(''); setTmplOk(''); }}>reset template</button>
      </div>
      {tmplOk && <div style={{ color: 'var(--ok)', fontSize: 12, marginTop: 6 }}>{tmplOk}</div>}
      </div>{/* end scrollable */}
    </aside>
  );
}
