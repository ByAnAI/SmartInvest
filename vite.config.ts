import type { ServerResponse } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import type { Plugin, ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite sends `full-reload` when tsconfig changes (see terminal: "changed tsconfig file detected").
 * OneDrive/Cursor often *touch* tsconfig without real edits → endless reloads. `hmr: false` does NOT stop this.
 */
function suppressTsconfigFullReloadPlugin(enabled: boolean): Plugin {
  return {
    name: 'smartinvest-suppress-tsconfig-full-reload',
    configureServer(server) {
      if (!enabled) return;
      const ws = server.ws;
      const send = ws.send.bind(ws);
      ws.send = (payload: unknown) => {
        if (
          payload &&
          typeof payload === 'object' &&
          (payload as { type?: string }).type === 'full-reload'
        ) {
          const p = (payload as { path?: string }).path;
          if (typeof p === 'string' && /(^|[\\/])tsconfig.*\.json$/i.test(p)) {
            return;
          }
        }
        return send(payload as Parameters<typeof send>[0]);
      };
    },
  };
}

/** Browser → Vite → FastAPI on 127.0.0.1:8000. Avoids calling 127.0.0.1 from another device when host is 0.0.0.0. */
/** Yahoo rejects many proxied requests without a normal browser User-Agent */
function yahooChartProxyOptions(): ProxyOptions {
  const ua =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  return {
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    secure: true,
    rewrite: (p: string) => p.replace(/^\/yahoo-chart/, '') || '/',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq) => {
        proxyReq.setHeader('User-Agent', ua);
        proxyReq.setHeader('Accept', 'application/json,text/plain,*/*');
        proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
        proxyReq.setHeader('Referer', 'https://finance.yahoo.com/');
      });
    },
  };
}

function ollamaProxyOptions(): ProxyOptions {
  return {
    target: 'http://127.0.0.1:11434',
    changeOrigin: true,
    rewrite: (p: string) => p.replace(/^\/ollama/, '') || '/',
  };
}

/** Browser → same-origin `/hf-router/*` → HF Inference Providers router (avoids cross-origin fetch failures to router.huggingface.co). */
function hfInferenceRouterProxyOptions(): ProxyOptions {
  return {
    target: 'https://router.huggingface.co',
    changeOrigin: true,
    secure: true,
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (p: string) => p.replace(/^\/hf-router/, '') || '/',
    configure: (proxy) => {
      proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
        const socket = res as ServerResponse | undefined;
        if (!socket || typeof socket.writeHead !== 'function' || socket.headersSent) return;
        const detail = String(err?.message || err || 'unknown').slice(0, 600);
        socket.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        socket.end(
          JSON.stringify({
            error: `Hugging Face router proxy could not reach huggingface.co (${detail}). Check network/VPN/firewall.`,
          })
        );
      });
    },
  };
}

/** Browser → same-origin `/gemini-api/*` → Google (avoids CORS on generativelanguage.googleapis.com). Matches `listGeminiFetchBaseUrls()` in geminiService.ts */
function geminiGoogleApiProxyOptions(insecureUpstreamTls: boolean): ProxyOptions {
  return {
    target: 'https://generativelanguage.googleapis.com',
    changeOrigin: true,
    /** Dev-only: set `VITE_GEMINI_PROXY_INSECURE_TLS=true` if TLS to Google fails behind corporate SSL inspection. */
    secure: !insecureUpstreamTls,
    /** Gemini + Search grounding can run long; default proxy timeouts surface as browser “Failed to fetch”. */
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (p: string) => p.replace(/^\/gemini-api/, '') || '/',
    configure: (proxy) => {
      proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
        const socket = res as ServerResponse | undefined;
        if (!socket || typeof socket.writeHead !== 'function' || socket.headersSent) return;
        const detail = String(err?.message || err || 'unknown').slice(0, 600);
        socket.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
        socket.end(
          JSON.stringify({
            error: {
              code: 502,
              message: `Gemini dev proxy could not reach Google (${detail}). Check network/VPN/firewall.`,
              status: 'BAD_GATEWAY',
            },
          })
        );
      });
    },
  };
}

function watchlistApiProxyOptions(apiPort: string): ProxyOptions {
  return {
    target: `http://127.0.0.1:${apiPort}`,
    changeOrigin: true,
    /** Full watchlist runs can take many minutes; avoid proxy closing the socket early. */
    timeout: 0,
    proxyTimeout: 0,
    rewrite: (p: string) => p.replace(/^\/watchlist-api/, '') || '/',
    configure: (proxy) => {
      proxy.on('error', (err: NodeJS.ErrnoException, _req, res) => {
        const socket = res as ServerResponse | undefined;
        if (!socket || typeof socket.writeHead !== 'function' || socket.headersSent) return;
        const refused =
          err?.code === 'ECONNREFUSED' || String(err?.message || '').includes('ECONNREFUSED');
        const detail = refused
          ? `Watchlist API is not running on port ${apiPort}. Run npm run dev:all or npm run watchlist-api. Set WATCHLIST_API_PORT in .env to match. Check: curl http://127.0.0.1:${apiPort}/api/health`
          : `Watchlist API proxy error: ${err?.message || String(err)}`;
        socket.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        socket.end(JSON.stringify({ detail }));
      });
    },
  };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const geminiKey = env.VITE_GEMINI_API_KEY || env.GEMINI_API_KEY || '';
    /** Must match `npm run watchlist-api` (see scripts/watchlist-api.mjs). Default 8000. */
    const watchlistApiPort = (env.WATCHLIST_API_PORT || '8000').trim();
    /**
     * OneDrive/iCloud: polling helps; sync still touches files → extra reloads.
     * Read from merged env (loadEnv + process.env — CLI injects .env before config runs).
     */
    const fsPollRaw =
      env.VITE_FS_POLLING ??
      process.env.VITE_FS_POLLING ??
      '';
    const useFsPolling = fsPollRaw === 'true' || fsPollRaw === '1';
    /** ms between polls when polling — higher = fewer false HMR triggers from cloud sync (default 2000). */
    const fsPollInterval = Math.max(
      500,
      Number.parseInt(String(env.VITE_FS_POLL_INTERVAL ?? process.env.VITE_FS_POLL_INTERVAL ?? '2000'), 10) || 2000
    );
    /**
     * Wait until file size stops changing before emitting a change — crucial on OneDrive/iCloud (many rapid touches).
     * Default 3000 ms; raise if reloads persist (e.g. 5000).
     */
    const fsStabilityMs = Math.max(
      200,
      Number.parseInt(
        String(env.VITE_FS_STABILITY_MS ?? process.env.VITE_FS_STABILITY_MS ?? '3000'),
        10
      ) || 3000
    );
    const disableHmr =
      env.VITE_DISABLE_HMR === 'true' ||
      env.VITE_DISABLE_HMR === '1' ||
      process.env.VITE_DISABLE_HMR === 'true' ||
      process.env.VITE_DISABLE_HMR === '1';
    /** No file watcher — zero auto reloads; restart `npm run dev` after code changes. Nuclear option for synced folders. */
    const disableFileWatch =
      env.VITE_DISABLE_FILE_WATCH === 'true' ||
      env.VITE_DISABLE_FILE_WATCH === '1' ||
      process.env.VITE_DISABLE_FILE_WATCH === 'true' ||
      process.env.VITE_DISABLE_FILE_WATCH === '1';
    /**
     * When using cloud sync polling, drop tsconfig-driven full reloads unless explicitly re-enabled:
     * `VITE_SUPPRESS_TSCONFIG_RELOAD=false`
     */
    const suppressTsconfigReload =
      !disableFileWatch &&
      (useFsPolling || env.VITE_SUPPRESS_TSCONFIG_RELOAD === 'true' || process.env.VITE_SUPPRESS_TSCONFIG_RELOAD === 'true') &&
      env.VITE_SUPPRESS_TSCONFIG_RELOAD !== 'false' &&
      process.env.VITE_SUPPRESS_TSCONFIG_RELOAD !== 'false';
    const geminiProxyInsecureTls =
      env.VITE_GEMINI_PROXY_INSECURE_TLS === 'true' ||
      env.VITE_GEMINI_PROXY_INSECURE_TLS === '1' ||
      process.env.VITE_GEMINI_PROXY_INSECURE_TLS === 'true' ||
      process.env.VITE_GEMINI_PROXY_INSECURE_TLS === '1';
    return {
      server: {
        port: 3000,
        /**
         * If 3000 is taken (old Vite, another app), use the next free port so `npm run dev` still runs.
         * Always open the exact URL printed in the terminal (`Local: http://localhost:3001/` etc.).
         * With strictPort:true, Vite exited while something else kept serving :3000 → blank/wrong page in the browser.
         */
        strictPort: false,
        /**
         * Avoid host: '0.0.0.0' here: Vite resolves LAN URLs via os.networkInterfaces(), which can throw on
         * some macOS/OneDrive/iCloud setups (ERR_SYSTEM_ERROR / uv_interface_addresses) and the dev server never starts.
         * For LAN testing: `npm run dev -- --host` or `npx vite --host 0.0.0.0`
         */
        host: 'localhost',
        /** Last resort on synced folders: no HMR — you refresh the browser yourself (no random full reloads). */
        ...(disableHmr ? { hmr: false } : {}),
        ...(disableFileWatch
          ? {
              /** Per Vite: no watchers → no automatic reloads from disk churn (restart dev server to pick up edits). */
              watch: null,
            }
          : useFsPolling
            ? {
                watch: {
                  usePolling: true,
                  interval: fsPollInterval,
                  /**
                   * Debounce: cloud sync often re-writes the same file several times; without this, each touch can reload the page.
                   */
                  awaitWriteFinish: {
                    stabilityThreshold: fsStabilityMs,
                    pollInterval: 300,
                  },
                  /** Extra churn from sync clients — ignore common noise (still watches your source files). */
                  ignored: [
                    '**/node_modules/**',
                    '**/.git/**',
                    '**/dist/**',
                    '**/.DS_Store',
                    '**/Thumbs.db',
                    '**/~$*',
                  ],
                },
              }
            : {}),
        proxy: {
          '/watchlist-api': watchlistApiProxyOptions(watchlistApiPort),
          /** HF chat completions — same-origin avoids browser CORS / opaque “Failed to fetch” to router.huggingface.co. */
          '/hf-router': hfInferenceRouterProxyOptions(),
          /** Local Ollama — browser → same-origin `/ollama/*` → http://127.0.0.1:11434 (no HF credits). */
          '/ollama': ollamaProxyOptions(),
          /** Gemini REST API — browser fetch is blocked by CORS to Google; proxy preserves ?key= API key. */
          '/gemini-api': geminiGoogleApiProxyOptions(geminiProxyInsecureTls),
          /** Alias proxy path for environments/extensions that block one route name. */
          '/google-ai-api': geminiGoogleApiProxyOptions(geminiProxyInsecureTls),
          /** Yahoo Chart v8 — browser CORS blocks direct calls; dev/preview use same-origin proxy for FX candle fallback */
          '/yahoo-chart': yahooChartProxyOptions(),
        },
      },
      preview: {
        proxy: {
          '/watchlist-api': watchlistApiProxyOptions(watchlistApiPort),
          '/hf-router': hfInferenceRouterProxyOptions(),
          '/ollama': ollamaProxyOptions(),
          '/gemini-api': geminiGoogleApiProxyOptions(geminiProxyInsecureTls),
          '/google-ai-api': geminiGoogleApiProxyOptions(geminiProxyInsecureTls),
          '/yahoo-chart': yahooChartProxyOptions(),
        },
      },
      plugins: [suppressTsconfigFullReloadPlugin(suppressTsconfigReload), react()],
      define: {
        'process.env.API_KEY': JSON.stringify(geminiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiKey)
      },
      resolve: {
        // Rollup's CJS resolver mishandles @google/genai conditional exports; use the web build in the browser bundle.
        alias: {
          '@': path.resolve(__dirname, '.'),
          '@google/genai': path.resolve(__dirname, 'node_modules/@google/genai/dist/web/index.mjs'),
        }
      },
      build: {
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            newsBoard: path.resolve(__dirname, 'news-board.html'),
          },
        },
      },
    };
});
