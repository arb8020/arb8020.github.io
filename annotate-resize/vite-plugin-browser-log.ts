/**
 * Vite plugin:
 * 1. Forwards browser console.log/warn/error to the dev server (logs + stdout)
 * 2. Provides /__eval endpoint to execute JS in the browser and return the result
 *    (only active in dev, localhost only)
 */
import type { Plugin } from 'vite';
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SESSION = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LOG_DIR = join(process.cwd(), 'logs');
const LOG_FILE = join(LOG_DIR, `browser_${SESSION}.jsonl`);

// pending eval requests: id -> { resolve, reject }
const pending = new Map<string, { resolve: (v: string) => void; reject: (e: string) => void }>();

const INJECT = `
(function() {
  // console forwarding
  const _post = (type, args) => {
    try {
      const data = args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); } catch { return String(a); }
      }).join(' ');
      fetch('/__browser_log', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, data, ts: Date.now() }),
      }).catch(() => {});
    } catch {}
  };
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log   = (...a) => { orig.log(...a);   _post('log',   a); };
  console.warn  = (...a) => { orig.warn(...a);  _post('warn',  a); };
  console.error = (...a) => { orig.error(...a); _post('error', a); };

  // eval bridge: polls /__eval/poll, executes JS, posts result back
  async function evalLoop() {
    while (true) {
      try {
        const res = await fetch('/__eval/poll', { signal: AbortSignal.timeout(30000) });
        if (res.status === 200) {
          const { id, code } = await res.json();
          let result, error;
          try {
            // eslint-disable-next-line no-eval
            result = await eval(code);
            result = typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
          } catch (e) {
            error = String(e);
          }
          await fetch('/__eval/result', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id, result, error }),
          });
        }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
  }
  evalLoop();
})();
`;

export function browserLogPlugin(): Plugin {
  // queue of pending eval jobs waiting to be picked up by the browser
  const evalQueue: Array<{ id: string; code: string }> = [];

  return {
    name: 'browser-log',
    apply: 'serve',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module' }, children: INJECT, injectTo: 'head-prepend' }];
    },
    configureServer(server) {
      mkdirSync(LOG_DIR, { recursive: true });

      // console log receiver
      server.middlewares.use('/__browser_log', (req, res) => {
        if (req.method !== 'POST') { res.end(); return; }
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            const line = JSON.stringify({ ...parsed, server_time: new Date().toISOString() });
            appendFileSync(LOG_FILE, line + '\n');
            const prefix = parsed.type === 'error' ? '\x1b[31m[browser:error]\x1b[0m'
                         : parsed.type === 'warn'  ? '\x1b[33m[browser:warn]\x1b[0m'
                         :                           '\x1b[36m[browser:log]\x1b[0m';
            process.stdout.write(`${prefix} ${parsed.data}\n`);
          } catch {}
          res.statusCode = 204;
          res.end();
        });
      });

      // browser polls this to get eval jobs
      server.middlewares.use('/__eval/poll', (_req, res) => {
        const job = evalQueue.shift();
        if (job) {
          res.setHeader('content-type', 'application/json');
          res.statusCode = 200;
          res.end(JSON.stringify(job));
        } else {
          res.statusCode = 204;
          res.end();
        }
      });

      // browser posts result back here
      server.middlewares.use('/__eval/result', (req, res) => {
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', () => {
          try {
            const { id, result, error } = JSON.parse(body);
            const p = pending.get(id);
            if (p) { pending.delete(id); error ? p.reject(error) : p.resolve(result ?? 'undefined'); }
          } catch {}
          res.statusCode = 204;
          res.end();
        });
      });

      // /dev/eval — POST {"code": "..."} -> runs in browser, returns result
      server.middlewares.use('/dev/eval', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c: Buffer) => { body += c.toString(); });
        req.on('end', async () => {
          try {
            const { code } = JSON.parse(body);
            const id = Math.random().toString(36).slice(2);
            const result = await new Promise<string>((resolve, reject) => {
              pending.set(id, { resolve, reject });
              evalQueue.push({ id, code });
              setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject('timeout — is the browser tab open?'); } }, 10000);
            });
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ result }));
          } catch (e) {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
      });
    },
  };
}
