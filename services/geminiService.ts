import {
  InsightResponse,
  type TickerWatchlistConditionBrief,
  type GrowthRiskDashboardReport,
  type GrowthRiskDashboardItem,
  type GrowthRiskImpactLevel,
} from "../types";

const SYSTEM_INSTRUCTION = `You are a world-class senior investment advisor and financial analyst. 
Your goal is to provide objective, data-driven stock market insights. 
Analyze news, trends, and fundamentals. 
Always warn users that your advice is for informational purposes and they should do their own research.
When asked for specific analysis, focus on technical indicators, fundamental health, and market sentiment.`;

/** Active: HF Inference Providers `chat/completions` — must be a router-supported chat model (not every Hub id works). Override via VITE_HF_MODEL. */
const HF_MODEL_DEFAULT = "Qwen/Qwen2.5-7B-Instruct";
/** Direct router URL (production / when not using local Vite proxy). */
const HF_ROUTER_DIRECT_CHAT_URL = "https://router.huggingface.co/v1/chat/completions";

/**
 * Local dev / `vite preview` on localhost: call same-origin `/hf-router` so Vite proxies to HF (avoids CORS and some “Failed to fetch”).
 * Override with `VITE_HF_BASE_URL` (API origin or full chat URL). Remote production hosts use direct router URL unless they set `VITE_HF_BASE_URL` to their own gateway.
 */
function shouldUseSameOriginHfRouterProxy(): boolean {
  if (typeof window === "undefined") return false;
  const { protocol, hostname } = window.location;
  if (protocol === "file:" || !hostname) return false;
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

function getHfChatCompletionsUrl(): string {
  const custom = import.meta.env.VITE_HF_BASE_URL?.trim();
  if (custom) {
    const base = custom.replace(/\/$/, "");
    if (/\/v1\/chat\/completions$/i.test(base)) return base;
    if (/\/v1$/i.test(base)) return `${base}/chat/completions`;
    return `${base}/v1/chat/completions`;
  }
  if (shouldUseSameOriginHfRouterProxy()) {
    return `${window.location.origin.replace(/\/$/, "")}/hf-router/v1/chat/completions`;
  }
  return HF_ROUTER_DIRECT_CHAT_URL;
}

const GEMINI_MODEL_DEFAULT = "gemini-2.5-flash-lite";

/** After retries on the primary model, try this model (separate quota bucket from flash-lite; override via `VITE_GEMINI_MODEL_FALLBACK`). */
const GEMINI_MODEL_FALLBACK_DEFAULT = "gemini-2.5-flash";

const GEMINI_TRANSIENT_BACKOFF_MS = [0, 1100, 2600, 5200];

const GEMINI_MAX_TRANSIENT_ATTEMPTS_PER_MODEL = 5;

const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Parse server hint like `Please retry in 44.603524603s` or JSON `"retryDelay":"44s"`. */
function parseGeminiSuggestedRetryDelayMs(message: string): number | null {
  const plain = message.match(/retry\s+in\s+([\d.]+)\s*s\b/i);
  if (plain) {
    const sec = Number.parseFloat(plain[1]);
    if (Number.isFinite(sec) && sec > 0) return Math.min(Math.ceil(sec * 1000), 120_000);
  }
  const json = message.match(/"retryDelay"\s*:\s*"(\d+)s"/);
  if (json) {
    const sec = Number.parseInt(json[1], 10);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 120_000);
  }
  return null;
}

function isGeminiQuotaOrRateLimit(message: string): boolean {
  return (
    /RESOURCE_EXHAUSTED|Quota exceeded|quota exceeded|free_tier|rate.?limit|GenerateRequestsPerMinute/i.test(
      message
    )
  );
}

/** Matches Gemini REST paths (`.../v1beta/models/...:generateContent`). */
function getGeminiApiVersion(): string {
  const v = import.meta.env.VITE_GEMINI_API_VERSION?.trim();
  return v || 'v1beta';
}

type GeminiChatTurn = { role: string; parts: Array<{ text: string }> };

function extractGeminiResponseText(data: Record<string, unknown>): string {
  const candidates = data.candidates as unknown[] | undefined;
  const first = candidates?.[0] as Record<string, unknown> | undefined;
  const content = first?.content as Record<string, unknown> | undefined;
  const parts = content?.parts as unknown[] | undefined;
  if (!Array.isArray(parts)) return '';
  return parts
    .map((p) =>
      p && typeof p === 'object' && 'text' in p ? String((p as { text?: string }).text ?? '') : ''
    )
    .join('');
}

function isBrowserFetchNetworkFailure(e: unknown): boolean {
  if (!(e instanceof TypeError)) return false;
  const m = e.message || '';
  return /failed to fetch|networkerror|load failed|fetch.*abort/i.test(m);
}

function isGeminiRecoverableFallbackError(e: unknown): boolean {
  if (isBrowserFetchNetworkFailure(e)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  /** Wrapped `buildGeminiFailureError` is a plain Error — still signal HF/Ollama fallback. */
  if (/failed to fetch|networkerror|load failed|fetch.*abort/i.test(msg)) return true;
  if (
    /"status"\s*:\s*404\b|"status"\s*:\s*429\b|"status"\s*:\s*5\d\d\b|UNAVAILABLE|RESOURCE_EXHAUSTED|quota exceeded|high demand/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Bases for `…/{apiVer}/models/…:generateContent` (each ends with `/gemini-api` or custom gateway path — no trailing slash).
 * Tries localhost ↔ 127.0.0.1 when one loopback binding fails (opaque “Failed to fetch”).
 */
function listGeminiFetchBaseUrls(): string[] {
  const raw: string[] = [];
  const primaryCustom = import.meta.env.VITE_GEMINI_BASE_URL?.trim();
  const secondaryCustom = import.meta.env.VITE_GEMINI_SECONDARY_BASE_URL?.trim();

  if (typeof window !== 'undefined') {
    const { protocol, origin } = window.location;
    if (protocol === 'file:' || origin === 'null' || !origin) {
      throw new Error(
        'Gemini cannot run from file://. Use `npm run dev` and open http://localhost:PORT from the terminal, or set VITE_GEMINI_BASE_URL to your HTTPS proxy.'
      );
    }
    const sameOriginProxy = `${origin}/gemini-api`.replace(/\/$/, '');
    const sameOriginAlias = `${origin}/google-ai-api`.replace(/\/$/, '');
    raw.push(sameOriginProxy);
    raw.push(sameOriginAlias);
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost') {
        u.hostname = '127.0.0.1';
        raw.push(`${u.origin}/gemini-api`.replace(/\/$/, ''));
        raw.push(`${u.origin}/google-ai-api`.replace(/\/$/, ''));
      } else if (u.hostname === '127.0.0.1') {
        u.hostname = 'localhost';
        raw.push(`${u.origin}/gemini-api`.replace(/\/$/, ''));
        raw.push(`${u.origin}/google-ai-api`.replace(/\/$/, ''));
      }
    } catch {
      /* ignore */
    }
  }

  if (primaryCustom) raw.unshift(primaryCustom.replace(/\/$/, ''));
  if (secondaryCustom) raw.push(secondaryCustom.replace(/\/$/, ''));

  if (typeof window === 'undefined') {
    raw.push('https://generativelanguage.googleapis.com');
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const b of raw) {
    const n = b.replace(/\/$/, '');
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  if (out.length === 0) {
    throw new Error('No Gemini API base URL. Set VITE_GEMINI_BASE_URL or load the app over http(s).');
  }
  return out;
}

function geminiGenerateContentUrlForBase(base: string, model: string): string {
  const key = getGeminiApiKey();
  const ver = getGeminiApiVersion();
  const id = model.startsWith('models/') ? model.slice('models/'.length) : model;
  const url = new URL(`${base}/${ver}/models/${id}:generateContent`);
  url.searchParams.set('key', key);
  return url.toString();
}

async function geminiRestGenerateContent(
  model: string,
  body: Record<string, unknown>
): Promise<{ data: Record<string, unknown>; text: string }> {
  const bases = listGeminiFetchBaseUrls();
  const key = getGeminiApiKey();
  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(body),
  };

  let lastNetworkErr: unknown;
  let res: Response | undefined;

  for (const base of bases) {
    const url = geminiGenerateContentUrlForBase(base, model);
    try {
      res = await fetch(url, init);
    } catch (e: unknown) {
      if (isBrowserFetchNetworkFailure(e)) {
        lastNetworkErr = e;
        continue;
      }
      throw e;
    }
    break;
  }

  if (!res) {
    throw lastNetworkErr instanceof Error
      ? lastNetworkErr
      : new Error('Gemini: Failed to fetch (all API base URLs failed — check dev proxy / network).');
  }

  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    if (raw.trim()) data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`Gemini HTTP ${res.status}: non-JSON body ${raw.slice(0, 400)}`);
  }
  if (!res.ok) {
    const err = data.error as Record<string, unknown> | undefined;
    const payload =
      err != null
        ? JSON.stringify(err)
        : JSON.stringify({ status: res.status, message: raw.slice(0, 600) });
    throw new Error(payload);
  }
  const pf = data.promptFeedback as Record<string, unknown> | undefined;
  const block = pf?.blockReason;
  if (block != null && block !== '' && block !== 'BLOCK_REASON_UNSPECIFIED') {
    throw new Error(JSON.stringify({ blocked: true, promptFeedback: pf }));
  }
  const text = extractGeminiResponseText(data).trim();
  return { data, text };
}

const INSIGHT_CACHE_TTL_MS = 10 * 60 * 1000;
const insightCache = new Map<string, { ts: number; data: InsightResponse }>();

/** Default max completion tokens for ticker/sector insights (lower = faster; min 512). */
const INSIGHT_MAX_OUTPUT_TOKENS_DEFAULT = 1800;
/** Forex Sentinel observation JSON is large; keep completion smaller for latency. */
const FOREX_INSIGHT_MAX_OUTPUT_TOKENS_DEFAULT = 1600;

function getInsightMaxOutputTokens(): number {
  const raw = import.meta.env.VITE_INSIGHT_MAX_OUTPUT_TOKENS;
  const n = typeof raw === "string" ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (Number.isFinite(n) && n >= 512 && n <= 8192) return n;
  return INSIGHT_MAX_OUTPUT_TOKENS_DEFAULT;
}

function jsonInsightTemperature(): number {
  const raw = import.meta.env.VITE_INSIGHT_TEMPERATURE;
  const n = typeof raw === "string" ? Number.parseFloat(raw.trim()) : Number.NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  return 0.35;
}

const getHfToken = (): string => {
  /** Must use `import.meta.env.VITE_*` literally — dynamic access breaks Vite’s compile-time injection. */
  const key =
    import.meta.env.VITE_HF_API_TOKEN ||
    import.meta.env.VITE_HUGGING_FACE_TOKEN ||
    "";
  const t = String(key).trim();
  if (!t) {
    throw new Error(
      "Missing Hugging Face token. Add VITE_HF_API_TOKEN to project-root .env, save, restart npm run dev."
    );
  }
  return t;
};

const getHfModelId = (): string => {
  const m = import.meta.env.VITE_HF_MODEL;
  return typeof m === "string" && m.trim() ? m.trim() : HF_MODEL_DEFAULT;
};

type LlmProviderId = 'hf' | 'ollama' | 'gemini';
type GeminiNetworkFallbackProvider = 'none' | 'hf' | 'ollama' | 'auto';

/**
 * `hf` — Hugging Face Inference Providers (router).
 * `ollama` — local Ollama at localhost (no HF credits).
 * `gemini` — Google Gemini API (`VITE_GEMINI_API_KEY`).
 */
function getLlmProvider(): LlmProviderId {
  const v = import.meta.env.VITE_LLM_PROVIDER?.trim().toLowerCase();
  if (v === 'ollama' || v === 'local') return 'ollama';
  if (v === 'gemini' || v === 'google') return 'gemini';
  return 'hf';
}

function getGeminiNetworkFallbackProvider(): GeminiNetworkFallbackProvider {
  const v = import.meta.env.VITE_GEMINI_NETWORK_FALLBACK_PROVIDER?.trim().toLowerCase();
  if (v === 'ollama') return 'ollama';
  if (v === 'hf' || v === 'huggingface') return 'hf';
  if (v === 'auto') return 'auto';
  if (v === 'none' || v === 'off' || v === 'disabled') return 'none';
  /** Default to auto so Gemini network failures still return analysis. */
  return 'auto';
}

const getGeminiApiKey = (): string => {
  const viteKey = import.meta.env.VITE_GEMINI_API_KEY;
  const viteCompatKey = import.meta.env.GEMINI_API_KEY;
  const nodeKey = typeof process !== 'undefined' ? process.env?.API_KEY : undefined;
  const nodeCompatKey = typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : undefined;
  const key = String(viteKey || viteCompatKey || nodeKey || nodeCompatKey || '').trim();
  if (!key) {
    throw new Error(
      'Missing Gemini API key. Set VITE_GEMINI_API_KEY (or GEMINI_API_KEY) in .env and restart npm run dev.'
    );
  }
  return key;
};

function getGeminiModelId(): string {
  const m = import.meta.env.VITE_GEMINI_MODEL?.trim();
  return m || GEMINI_MODEL_DEFAULT;
}

function getGeminiFallbackModelId(): string {
  const m = import.meta.env.VITE_GEMINI_MODEL_FALLBACK?.trim();
  return m || GEMINI_MODEL_FALLBACK_DEFAULT;
}

/** True for overloaded / quota spikes — worth retrying or switching fallback model. */
function isTransientGeminiError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  if (
    /503|429|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|try again later|overloaded|temporarily|please retry/i.test(s)
  ) {
    return true;
  }
  if (/quota exceeded|Quota exceeded|free_tier|GenerateRequestsPerMinute|GenerateContentInputTokens/i.test(s)) {
    return true;
  }
  const codeMatch = s.match(/"code"\s*:\s*(\d+)/);
  if (codeMatch && (codeMatch[1] === '503' || codeMatch[1] === '429')) return true;
  if (/"status"\s*:\s*"RESOURCE_EXHAUSTED"/i.test(s)) return true;
  return false;
}

function buildGeminiFailureError(e: unknown): Error {
  const raw = e instanceof Error ? e.message : String(e);
  const msg =
    raw.length > 2800 ? `${raw.slice(0, 2800)}\n…(truncated)` : raw;
  const networkHint =
    typeof raw === 'string' && /failed to fetch|networkerror|load failed/i.test(raw)
      ? [
          ' Usually means the browser never got an HTTP response.',
          'Fixes: (1) Run via `npm run dev` or `npm run preview` (not opening dist/index.html as file://).',
          '(2) Restart dev server after vite.config changes so `/gemini-api` proxy is active.',
          '(3) Try http://127.0.0.1:PORT instead of http://localhost:PORT (or vice versa).',
          '(4) Hosting static `dist/` requires nginx/Caddy (or similar) to proxy `/gemini-api` → https://generativelanguage.googleapis.com — or set `VITE_GEMINI_BASE_URL` / `VITE_GEMINI_SECONDARY_BASE_URL`.',
          '(5) Corporate SSL inspection: dev-only `VITE_GEMINI_PROXY_INSECURE_TLS=true` (see .env.example).',
          '(6) VPN/firewall/ad-block can block Google.',
        ].join(' ')
      : '';
  const quotaHint =
    typeof raw === 'string' && isGeminiQuotaOrRateLimit(raw)
      ? (() => {
          const waitMs = parseGeminiSuggestedRetryDelayMs(raw);
          const waitHint =
            waitMs != null ? ` Google asked to retry after ~${Math.ceil(waitMs / 1000)}s.` : '';
          const zeroLimit =
            /"limit"\s*:\s*0\b/.test(raw) || /\blimit:\s*0\b/.test(raw)
              ? ' If you see limit 0 on free tier, link billing or use a key/project with Gemini quota enabled.'
              : '';
          return [
            ' Rate limit / quota (often free tier RPM/RPD or tokens-per-minute).',
            waitHint,
            zeroLimit,
            ' Options: wait and retry, pick another model (`VITE_GEMINI_MODEL` / `VITE_GEMINI_MODEL_FALLBACK` — each model has separate quotas), see https://ai.google.dev/gemini-api/docs/rate-limits and https://ai.dev/rate-limit , enable billing for higher limits, or use `VITE_LLM_PROVIDER=hf` / `ollama`.',
          ].join('');
        })()
      : '';
  const capacityHint =
    typeof raw === 'string' &&
    (/503|high demand|UNAVAILABLE/i.test(raw) ||
      (/429/.test(raw) && !isGeminiQuotaOrRateLimit(raw)))
      ? ' Tip (temporary capacity): wait and retry, or set `VITE_GEMINI_MODEL_FALLBACK` to another model id.'
      : '';
  return new Error(
    `Gemini request failed: ${msg}. Check API key and Cloud billing/quota if needed.${networkHint}${quotaHint}${capacityHint}`
  );
}

/**
 * Retries transient errors with backoff and Google’s suggested retry delay (RESOURCE_EXHAUSTED), then tries fallback model.
 */
async function geminiCallWithRetries<T>(call: (model: string) => Promise<T>): Promise<T> {
  const primary = getGeminiModelId();
  const fallback = getGeminiFallbackModelId();
  const models = primary === fallback ? [primary] : [primary, fallback];
  let lastErr: unknown;

  for (const model of models) {
    for (let attempt = 0; attempt < GEMINI_MAX_TRANSIENT_ATTEMPTS_PER_MODEL; attempt++) {
      if (attempt > 0) {
        const backoff =
          GEMINI_TRANSIENT_BACKOFF_MS[
            Math.min(attempt - 1, GEMINI_TRANSIENT_BACKOFF_MS.length - 1)
          ] ?? 0;
        if (backoff > 0) await sleepMs(backoff);
      }
      try {
        return await call(model);
      } catch (e) {
        lastErr = e;
        if (!isTransientGeminiError(e)) {
          throw buildGeminiFailureError(e);
        }
        const em = e instanceof Error ? e.message : String(e);
        const quotaWait = parseGeminiSuggestedRetryDelayMs(em);
        if (quotaWait != null && quotaWait > 0) {
          await sleepMs(quotaWait);
        }
      }
    }
  }

  throw buildGeminiFailureError(lastErr);
}

async function geminiGenerateText(
  userContent: string,
  maxTokens = 2048,
  opts?: { jsonOnly?: boolean; temperature?: number }
): Promise<string> {
  const system = buildSystemPrompt(opts?.jsonOnly);

  const temperature =
    opts?.temperature ?? (opts?.jsonOnly ? jsonInsightTemperature() : 0.75);

  return geminiCallWithRetries(async (model) => {
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userContent }] }],
      systemInstruction: { parts: [{ text: system }] },
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature,
        ...(opts?.jsonOnly ? { responseMimeType: 'application/json' } : {}),
      },
    };
    const { text } = await geminiRestGenerateContent(model, body);
    if (!text) {
      throw new Error('Gemini returned empty text');
    }
    return text;
  });
}

/** Dev: proxied `/ollama` → 11434 (see vite.config). Prod/static: set `VITE_OLLAMA_BASE_URL` or defaults to localhost. */
function getOllamaApiRoot(): string {
  const custom = import.meta.env.VITE_OLLAMA_BASE_URL?.trim();
  if (custom) return custom.replace(/\/$/, '');
  if (import.meta.env.DEV) return '/ollama';
  return 'http://127.0.0.1:11434';
}

function getOllamaModelId(): string {
  const m = import.meta.env.VITE_OLLAMA_MODEL?.trim();
  return m || 'qwen2.5:7b';
}

function buildSystemPrompt(jsonOnly?: boolean): string {
  let system = SYSTEM_INSTRUCTION;
  if (jsonOnly) {
    system +=
      "\n\nWhen the user asks for JSON, respond with ONLY a valid JSON object or array — no markdown fences, no text before or after.";
  }
  return system;
}

async function ollamaGenerateText(
  userContent: string,
  maxTokens = 2048,
  opts?: { jsonOnly?: boolean; temperature?: number }
): Promise<string> {
  const root = getOllamaApiRoot();
  const model = getOllamaModelId();
  const system = buildSystemPrompt(opts?.jsonOnly);
  let res: Response;
  const temperature =
    opts?.temperature ?? (opts?.jsonOnly ? jsonInsightTemperature() : 0.65);
  try {
    res = await fetch(`${root}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: userContent },
        ],
        stream: false,
        options: { num_predict: maxTokens, temperature },
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Ollama unreachable (${root}). Install from https://ollama.com, run \`ollama pull ${model}\`, ensure Ollama is running, then retry. ${msg}`
    );
  }

  const textBody = await res.text();
  if (!res.ok) {
    throw new Error(
      `Ollama API error ${res.status}: ${textBody.slice(0, 600)}. Try: ollama pull ${model}`
    );
  }
  let data: { message?: { content?: string }; error?: string };
  try {
    data = JSON.parse(textBody) as { message?: { content?: string }; error?: string };
  } catch {
    throw new Error(`Ollama: invalid response: ${textBody.slice(0, 400)}`);
  }
  const errMsg = typeof data?.error === 'string' ? data.error : '';
  if (errMsg) throw new Error(`Ollama: ${errMsg}`);
  const content = data?.message?.content;
  if (typeof content === 'string' && content.trim()) return content.trim();
  throw new Error(`Ollama returned no assistant text. Run: ollama pull ${model}`);
}

/** Strip markdown fences and grab first JSON object from model output (exported for structured tasks). */
export function parseModelJson(raw: string): string {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const start = trimmed.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return trimmed.slice(start, i + 1);
      }
    }
  }
  return trimmed;
}

function sanitizeJsonLike(raw: string): string {
  return raw
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00A0/g, " ")
    .replace(/,\s*([}\]])/g, "$1");
}

function parseJsonWithRecovery(raw: string): unknown {
  const candidates: string[] = [];
  const extracted = parseModelJson(raw);
  if (extracted && extracted.trim()) candidates.push(extracted.trim());
  const sanitizedExtracted = sanitizeJsonLike(extracted);
  if (sanitizedExtracted && sanitizedExtracted.trim() !== extracted.trim()) {
    candidates.push(sanitizedExtracted.trim());
  }
  if (raw.trim() !== extracted.trim()) {
    candidates.push(raw.trim());
    const sanitizedRaw = sanitizeJsonLike(raw);
    if (sanitizedRaw.trim() !== raw.trim()) candidates.push(sanitizedRaw.trim());
  }

  let lastError: unknown;
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to parse model JSON");
}

function toInsightResponse(parsed: unknown): InsightResponse {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const sentimentRaw = String(obj.sentiment ?? "").trim().toLowerCase();
  const sentiment =
    sentimentRaw === "bullish" ? "Bullish" : sentimentRaw === "bearish" ? "Bearish" : "Neutral";
  const summaryRaw = String(obj.summary ?? "").trim();
  const executiveSummary = String(obj.executive_summary ?? "").trim();
  const valuationView = String(obj.valuation_view ?? "").trim();
  const torchlightView = String(obj.torchlight_view ?? "").trim();
  const riskView = String(obj.risk_view ?? "").trim();
  const marketCatalysts = String(obj.market_catalysts ?? "").trim();
  const extendedReport = String(obj.extended_report ?? "").trim();

  /** Prefer short executive line for the main summary when present; else legacy long summary or stitched sections. */
  let summary = executiveSummary || summaryRaw;
  if (!summary) {
    const stitched = [valuationView, torchlightView, riskView, marketCatalysts].filter(Boolean).join("\n\n");
    summary = stitched;
  }
  if (!summary) summary = "AI returned a partial response; please verify details manually.";

  const recommendation = String(obj.recommendation ?? "").trim();
  const pros = Array.isArray(obj.pros)
    ? obj.pros.map((v) => String(v).trim()).filter(Boolean)
    : String(obj.pros ?? "")
        .split(/\r?\n|;\s*/)
        .map((v) => v.trim())
        .filter(Boolean);
  const cons = Array.isArray(obj.cons)
    ? obj.cons.map((v) => String(v).trim()).filter(Boolean)
    : String(obj.cons ?? "")
        .split(/\r?\n|;\s*/)
        .map((v) => v.trim())
        .filter(Boolean);

  const confidenceNum = Number(obj.confidence);
  const confidence = Number.isFinite(confidenceNum)
    ? Math.max(0, Math.min(100, confidenceNum))
    : 50;

  const out: InsightResponse = {
    sentiment,
    summary,
    pros: pros.length > 0 ? pros : ["Potential upside exists, but details were incomplete."],
    cons: cons.length > 0 ? cons : ["Model response format was incomplete; risk assessment may be limited."],
    recommendation:
      recommendation || "Hold / review manually due to incomplete AI response format.",
    confidence,
  };
  if (valuationView) out.valuation_view = valuationView;
  if (torchlightView) out.torchlight_view = torchlightView;
  if (riskView) out.risk_view = riskView;
  if (marketCatalysts) out.market_catalysts = marketCatalysts;
  if (extendedReport) out.extended_report = extendedReport;
  return out;
}

function fallbackInsightFromText(raw: string): InsightResponse {
  const text = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const sentiment = /bearish/i.test(text)
    ? "Bearish"
    : /bullish/i.test(text)
      ? "Bullish"
      : "Neutral";
  const confidenceMatch = text.match(/confidence[^0-9]{0,12}(\d{1,3})/i);
  const confidence = confidenceMatch
    ? Math.max(0, Math.min(100, Number(confidenceMatch[1])))
    : 50;
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const summary =
    lines.find((l) => l.length > 40) ||
    lines.slice(0, 2).join(" ").slice(0, 500) ||
    "AI returned unstructured output.";

  const bulletLines = lines
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim())
    .filter(Boolean);
  const pros = bulletLines.slice(0, 3);
  const cons = bulletLines.slice(3, 6);

  return {
    sentiment,
    summary,
    pros: pros.length ? pros : ["Positive factors not clearly structured in model output."],
    cons: cons.length ? cons : ["Risk factors not clearly structured in model output."],
    recommendation: /buy|accumulate|long/i.test(text)
      ? "Buy with caution"
      : /sell|short|reduce/i.test(text)
        ? "Reduce / Sell with caution"
        : "Hold pending manual review",
    confidence,
  };
}

async function hfGenerateTextViaHfRouter(
  userContent: string,
  maxTokens = 2048,
  opts?: { jsonOnly?: boolean; temperature?: number }
): Promise<string> {
  const token = getHfToken();
  const model = getHfModelId();
  const system = buildSystemPrompt(opts?.jsonOnly);
  const temperature =
    opts?.temperature ?? (opts?.jsonOnly ? jsonInsightTemperature() : 0.65);

  const url = getHfChatCompletionsUrl();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: userContent },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
    });
  } catch (e) {
    if (isBrowserFetchNetworkFailure(e)) {
      const via = url.includes("/hf-router/")
        ? "same-origin /hf-router proxy"
        : "direct https://router.huggingface.co";
      throw new Error(
        `Hugging Face request failed (network — browser got no response). Using ${via}. ` +
          `Fixes: (1) Restart \`npm run dev\` after vite.config changes so /hf-router proxy is active. ` +
          `(2) Try http://127.0.0.1:PORT vs http://localhost:PORT. ` +
          `(3) VPN / firewall / ad-block blocking huggingface.co. ` +
          `(4) For 403 after a response arrives, create a Fine-grained HF token with Inference API + Inference Providers scopes (see existing 403 message). ` +
          `(5) Bypass cloud LLM: VITE_LLM_PROVIDER=ollama with Ollama running, or VITE_LLM_PROVIDER=gemini with VITE_GEMINI_API_KEY.`
      );
    }
    throw e;
  }

  if (res.status === 503) {
    let detail = "";
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      detail = await res.text();
    }
    throw new Error(
      `Hugging Face model is loading or busy (503). Wait ~30–60s and retry. ${detail.slice(0, 400)}`
    );
  }

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 402) {
      throw new Error(
        "Hugging Face 402: monthly Inference credits are used up. Add prepaid credits or upgrade to PRO (huggingface.co), or wait for the next billing period. AI features in this app (stock/forex insights, JSON sentiment) will keep failing until quota is available."
      );
    }
    if (res.status === 403 && /inference providers|sufficient permissions|inference api/i.test(text)) {
      throw new Error(
        "Hugging Face 403: this token cannot call Inference Providers (router). Fix: (1) https://huggingface.co/settings/tokens — new Fine-grained token — enable user scopes for serverless Inference API + Inference Providers. " +
          "(2) https://huggingface.co/settings/inference-providers — confirm routing/billing if prompted. " +
          "Paste the token into VITE_HF_API_TOKEN, restart npm run dev. Bypass cloud: VITE_LLM_PROVIDER=ollama + Ollama running. Docs: https://huggingface.co/docs/inference-providers/en/index"
      );
    }
    if (res.status === 400) {
      try {
        const j = JSON.parse(text) as { error?: { message?: string; code?: string } };
        const inner = j?.error?.message ?? "";
        const code = j?.error?.code ?? "";
        if (
          code === "model_not_supported" ||
          /not a chat model/i.test(inner)
        ) {
          throw new Error(
            `Hugging Face: model "${model}" cannot be used with chat completions on Inference Providers. ` +
              `Set VITE_HF_MODEL to a chat/instruct model the router supports (try default Qwen/Qwen2.5-7B-Instruct). ` +
              `Browse: https://huggingface.co/inference/models`
          );
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Hugging Face: model")) throw e;
      }
    }
    throw new Error(`Hugging Face API error ${res.status}: ${text.slice(0, 800)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: string;
  };

  const errMsg = typeof data?.error === "string" ? data.error : "";
  if (errMsg) {
    throw new Error(
      `Hugging Face: ${errMsg} Check VITE_HF_API_TOKEN (Inference Providers / Inference access) at https://huggingface.co/settings/tokens`
    );
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();

  throw new Error(
    "Unexpected Hugging Face response (no choices[0].message.content). Try another VITE_HF_MODEL."
  );
}

async function hfGenerateText(
  userContent: string,
  maxTokens = 2048,
  opts?: { jsonOnly?: boolean; temperature?: number }
): Promise<string> {
  const provider = getLlmProvider();
  if (provider === 'ollama') {
    return ollamaGenerateText(userContent, maxTokens, opts);
  }
  if (provider === 'gemini') {
    try {
      return await geminiGenerateText(userContent, maxTokens, opts);
    } catch (e) {
      if (!isGeminiRecoverableFallbackError(e)) throw e;
      const fallback = getGeminiNetworkFallbackProvider();
      if (fallback === 'none') throw e;

      const attempts: Array<() => Promise<string>> =
        fallback === 'ollama'
          ? [() => ollamaGenerateText(userContent, maxTokens, opts)]
          : fallback === 'hf'
            ? [() => hfGenerateTextViaHfRouter(userContent, maxTokens, opts)]
            : [
                () => ollamaGenerateText(userContent, maxTokens, opts),
                () => hfGenerateTextViaHfRouter(userContent, maxTokens, opts),
              ];

      let lastFallbackErr: unknown = e;
      for (const run of attempts) {
        try {
          return await run();
        } catch (fallbackErr) {
          lastFallbackErr = fallbackErr;
        }
      }
      throw lastFallbackErr instanceof Error ? lastFallbackErr : e;
    }
  }
  return hfGenerateTextViaHfRouter(userContent, maxTokens, opts);
}

/** JSON-only chat completion for structured pipelines (e.g. news sentiment). Routes per `VITE_LLM_PROVIDER` (hf / ollama / gemini). */
export async function generateJsonCompletion(userContent: string, maxTokens = 4096): Promise<string> {
  return hfGenerateText(userContent, maxTokens, { jsonOnly: true });
}

/** Plain-text completion (reports, narratives). Routes per `VITE_LLM_PROVIDER` (hf / ollama / gemini). */
export async function generateTextCompletion(
  userContent: string,
  maxTokens = 4096,
  opts?: { temperature?: number }
): Promise<string> {
  return hfGenerateText(userContent, maxTokens, opts);
}

function normalizeWatchlistConditionBrief(
  parsed: unknown,
  expectedTicker: string
): TickerWatchlistConditionBrief {
  const sym = expectedTicker.trim().toUpperCase();
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const ticker = String(obj.ticker ?? sym)
    .trim()
    .toUpperCase() || sym;
  const rawCond = String(obj.condition ?? "").trim().toLowerCase();
  const condition: TickerWatchlistConditionBrief["condition"] =
    rawCond === "bullish"
      ? "Bullish"
      : rawCond === "bearish"
        ? "Bearish"
        : rawCond === "hold" || rawCond === "neutral"
          ? "Hold"
          : "Hold";
  const report = String(obj.report ?? "").trim();
  return {
    ticker: ticker || sym,
    condition,
    report: report || "No narrative returned; please retry.",
  };
}

/**
 * Short LLM report: investable condition (Bullish / Bearish / Hold) from watchlist row metrics only.
 */
export async function getTickerWatchlistConditionBrief(
  ticker: string,
  companyName: string,
  dataBlock: string,
  maxTokens = 900
): Promise<TickerWatchlistConditionBrief> {
  const sym = ticker.trim().toUpperCase();
  const prompt = [
    `You summarize the investable CONDITION of one equity using ONLY the watchlist data block below (no web, no news feeds, no outside knowledge).`,
    `Ticker: ${sym}`,
    `Company: ${(companyName || sym).trim()}`,
    "",
    "=== AUTHORITATIVE WATCHLIST DATA ===",
    dataBlock.trim(),
    "=== END DATA ===",
    "",
    "Return ONLY valid JSON with these keys (no markdown, no extra keys):",
    "ticker — string, uppercase symbol",
    'condition — exactly one of: Bullish, Bearish, Hold (use Hold when metrics conflict, data is thin, or stance is neutral / wait-and-see)',
    "report — 3–6 sentences, under ~160 words, plain text. Ground every claim in the data block; mention N/A briefly if key fields are missing. Interpret IV vs price, Torchlight, CTR, and risk summary together.",
  ].join("\n");

  const raw = await generateJsonCompletion(prompt, maxTokens);
  const jsonStr = parseModelJson(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("AI returned invalid JSON for watchlist condition brief.");
  }
  return normalizeWatchlistConditionBrief(parsed, sym);
}

function normalizeGrowthRiskImpactLevel(raw: string): GrowthRiskImpactLevel {
  const t = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (t === "high") return "High";
  if (t === "low") return "Low";
  return "Medium";
}

function parseGrowthRiskDashboardItem(entry: unknown, fallbackTitle: string): GrowthRiskDashboardItem | null {
  if (!entry || typeof entry !== "object") return null;
  const o = entry as Record<string, unknown>;
  const title = String(o.title ?? o.name ?? "").trim() || fallbackTitle;
  const descriptionRaw = String(
    o.description ?? o.detail ?? o.summary ?? o.desc ?? o.rationale ?? o.text ?? "",
  ).trim();
  const description =
    descriptionRaw ||
    (title && title !== fallbackTitle ? `Focus: ${title}.` : "Grounded in watchlist metrics; see score and category.");
  const impactRaw = String(o.impact_level ?? o.impactLevel ?? "Medium");
  const category = String(o.category ?? "General").trim() || "General";
  let score = Number(o.score ?? o.weight ?? o.rank);
  if (!Number.isFinite(score)) score = 50;
  score = Math.max(0, Math.min(100, Math.round(score)));
  if (!title || title.length < 1) return null;
  return {
    title: title.slice(0, 48),
    description: description.slice(0, 180),
    impactLevel: normalizeGrowthRiskImpactLevel(impactRaw),
    category: category.slice(0, 48),
    score,
  };
}

const GROWTH_RISK_DASHBOARD_MAX_ITEMS = 5;

export function normalizeGrowthRiskDashboard(parsed: unknown): GrowthRiskDashboardReport {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const scopeRaw = String(obj.scope ?? "").trim().toLowerCase();
  const scope: GrowthRiskDashboardReport["scope"] =
    scopeRaw === "sector" ? "sector" : "ticker";
  const subjectLabel = String(obj.subject_label ?? obj.subjectLabel ?? "").trim();
  const growthSummary = String(obj.growth_summary ?? obj.growthSummary ?? "").trim();
  const riskSummary = String(obj.risk_summary ?? obj.riskSummary ?? "").trim();
  const growthRaw = obj.growth_drivers ?? obj.growthDrivers ?? obj.growth ?? obj.drivers;
  const riskRaw = obj.risk_factors ?? obj.riskFactors ?? obj.risks ?? obj.risk;
  const growthArr = Array.isArray(growthRaw) ? growthRaw : [];
  const riskArr = Array.isArray(riskRaw) ? riskRaw : [];
  const growthDrivers = growthArr
    .map((e, i) => parseGrowthRiskDashboardItem(e, `Driver ${i + 1}`))
    .filter((x): x is GrowthRiskDashboardItem => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, GROWTH_RISK_DASHBOARD_MAX_ITEMS);
  const riskFactors = riskArr
    .map((e, i) => parseGrowthRiskDashboardItem(e, `Risk ${i + 1}`))
    .filter((x): x is GrowthRiskDashboardItem => x != null)
    .sort((a, b) => b.score - a.score)
    .slice(0, GROWTH_RISK_DASHBOARD_MAX_ITEMS);
  const out: GrowthRiskDashboardReport = { growthDrivers, riskFactors };
  if (subjectLabel) out.subjectLabel = subjectLabel;
  if (growthSummary) out.growthSummary = growthSummary;
  if (riskSummary) out.riskSummary = riskSummary;
  out.scope = scope;
  return out;
}

function buildGrowthRiskDashboardPrompt(
  mode: "ticker" | "sector",
  subjectPrimary: string,
  subjectSecondary: string,
  dataBlock: string
): string {
  const scope = mode;
  const label = subjectPrimary.trim();
  const secondary = (subjectSecondary || "").trim();
  return [
    "You are a financial analyst writing dashboard copy — short labels, no fluff.",
    "",
    mode === "ticker"
      ? `Scope: single EQUITY ticker ${label}.`
      : `Scope: SECTOR aggregate for "${label}" (cross-company averages in the data block).`,
    secondary ? `Context line: ${secondary}` : "",
    "",
    "Using ONLY the data block, produce:",
    "1) growth_summary — max 220 characters, dashboard headline for growth/opportunity.",
    "2) risk_summary — max 220 characters, dashboard headline for risks.",
    `3) growth_drivers — at most ${GROWTH_RISK_DASHBOARD_MAX_ITEMS} items, sorted by score descending.`,
    `4) risk_factors — at most ${GROWTH_RISK_DASHBOARD_MAX_ITEMS} items, sorted by score descending.`,
    "",
    "Each item: title (≤40 chars, chart-style), description (≤140 chars, one tight sentence), impact_level (Low|Medium|High), category (Financial|Market|Product|Macro|Operational|Competitive — pick best fit), score (0–100, evidence-weighted).",
    "Every object in growth_drivers and risk_factors MUST include a non-empty string for \"description\" (even a short clause).",
    "Spread items across categories where the data supports it; avoid duplicate themes.",
    "",
    "Return ONLY valid JSON with keys:",
    `- scope: "${scope}"`,
    '- subject_label: string (ticker symbol for ticker mode, or sector name for sector mode)',
    "- growth_summary, risk_summary (strings)",
    "- growth_drivers, risk_factors (arrays of objects with title, description, impact_level, category, score)",
    "",
    "Rules: ground every claim in the block; if data is thin, lower scores and use Low/Medium impact; no markdown fences.",
    "",
    "=== DATA ===",
    dataBlock.trim(),
    "=== END DATA ===",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

/**
 * Growth/risk dashboard JSON for UI (ticker row or sector aggregate block).
 */
export async function getGrowthRiskDashboard(
  mode: "ticker" | "sector",
  subjectPrimary: string,
  subjectSecondary: string,
  dataBlock: string,
  maxTokens = 2600
): Promise<GrowthRiskDashboardReport> {
  const analystBlock = buildGrowthRiskDashboardPrompt(mode, subjectPrimary, subjectSecondary, dataBlock);
  const raw = await generateJsonCompletion(analystBlock, maxTokens);
  let parsed: unknown;
  try {
    parsed = parseJsonWithRecovery(raw);
  } catch {
    throw new Error("AI returned invalid JSON for growth/risk dashboard.");
  }
  const normalized = normalizeGrowthRiskDashboard(parsed);
  if (!normalized.subjectLabel) {
    normalized.subjectLabel =
      mode === "ticker" ? subjectPrimary.trim().toUpperCase() : subjectPrimary.trim();
  }
  normalized.scope = mode;
  return normalized;
}

/** @deprecated Use getGrowthRiskDashboard("ticker", ...) */
export async function getGrowthRiskDashboardFromWatchlist(
  ticker: string,
  companyName: string,
  dataBlock: string,
  maxTokens = 2800
): Promise<GrowthRiskDashboardReport> {
  return getGrowthRiskDashboard("ticker", ticker.trim().toUpperCase(), companyName || ticker, dataBlock, maxTokens);
}

export type StockInsightRequestOpts = {
  /** Override max completion tokens (default from VITE_INSIGHT_MAX_OUTPUT_TOKENS or 2400). */
  maxOutputTokens?: number;
  skipCache?: boolean;
};

export const getStockInsight = async (
  symbol: string,
  contextualPrompt?: string,
  requestOpts?: StockInsightRequestOpts
): Promise<InsightResponse> => {
  const base =
    contextualPrompt && contextualPrompt.trim()
      ? contextualPrompt.trim()
      : `Analyze the stock ticker ${symbol}. Provide market sentiment, a summary of recent performance, key pros and cons for investors, and a final recommendation with a confidence level.`;

  /** AIAnalysis builds prompts that already end with JSON schema instructions — avoid duplicating. */
  const hasJsonFooter =
    /Return ONLY valid JSON|Return only valid JSON|Output format:\s*return only valid JSON/i.test(base);
  const jsonSuffix = hasJsonFooter
    ? ""
    : "\n\nReturn a JSON object with keys: sentiment (one of Bullish, Bearish, Neutral), summary (string), pros (array of strings), cons (array of strings), recommendation (string), confidence (number 0-100).";

  const jsonTask = `${base}${jsonSuffix}`;

  const cacheKey = `${symbol.toUpperCase()}::${base}`;
  const now = Date.now();
  const maxOut = requestOpts?.maxOutputTokens ?? getInsightMaxOutputTokens();
  const jsonOpts = { jsonOnly: true as const, temperature: jsonInsightTemperature() };

  if (!requestOpts?.skipCache) {
    const cached = insightCache.get(cacheKey);
    if (cached && now - cached.ts < INSIGHT_CACHE_TTL_MS) {
      return cached.data;
    }
  }

  const raw = await hfGenerateText(jsonTask, maxOut, jsonOpts);
  if (!raw.trim()) {
    throw new Error("AI provider returned an empty response. Please retry.");
  }

  try {
    const parsed = parseJsonWithRecovery(raw);
    const normalized = toInsightResponse(parsed);
    if (!requestOpts?.skipCache) {
      insightCache.set(cacheKey, { ts: now, data: normalized });
    }
    return normalized;
  } catch (e) {
    console.error("Failed to parse insight JSON", e);
    const fallback = fallbackInsightFromText(raw);
    if (!requestOpts?.skipCache) {
      insightCache.set(cacheKey, { ts: now, data: fallback });
    }
    return fallback;
  }
};

export const getStockInsightsBatch = async (tickers: string[]): Promise<Record<string, string>> => {
  const normalized = tickers.map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (!normalized.length) return {};

  const task = [
    "Provide one concise sentence of current market insight per ticker.",
    "Tickers:",
    normalized.join(", "),
    'Return only valid JSON as: {"items":[{"ticker":"AAPL","insight":"..."}]}',
  ].join("\n");

  const raw = await hfGenerateText(task, 1024, { jsonOnly: true, temperature: jsonInsightTemperature() });
  const jsonStr = parseModelJson(raw);
  if (!jsonStr) return {};

  try {
    const parsed = JSON.parse(jsonStr) as { items?: Array<{ ticker: string; insight: string }> };
    const out: Record<string, string> = {};
    (parsed.items || []).forEach((item) => {
      const t = String(item?.ticker || "").toUpperCase();
      const insight = String(item?.insight || "").trim();
      if (t && insight) out[t] = insight;
    });
    return out;
  } catch {
    return {};
  }
};

/** “Forex Sentinel Alpha” — LLM fuses HMM regime + sentiment + technical levels (HMM alone uses RSI+MACD). */
const FOREX_SENTINEL_ALPHA_INSTRUCTION = `You are "Forex Sentinel Alpha", a quantitative trading strategist specializing in Regime Detection (HMM), Sentiment Analysis, and Technical Price Action.

Objective: Analyze the provided observation JSON and determine if a high-probability trade exists. Seek confluence between Market Regime, Sentiment Flow, and Technical Levels.

Input context:
- directional_forecast.scenarios: collective probabilities for up (toward resistance), neutral (range), down (toward support), each with probability (0–1), confidence_percent (0–100), and path hints vs classic pivot S/R.
- directional_forecast.pivot_levels: classic daily pivots from the prior bar (P, R1–R3, S1–S3) — align your narrative with these levels when relevant.
- directional_forecast.touch_race: distance-based first-touch odds between nearest support and resistance (illustrative, not a guarantee).
- hmm_regime.state: 0 = Bear / downtrend regime, 1 = Neutral / range or transition, 2 = Bull / uptrend regime. If leading_probability < 0.60 or regime_unstable is true, treat the regime as uncertain.
- sentiment.score: -1 (extreme fear) to +1 (extreme greed). sentiment.confidence: 0–1 from news/data volume — high confidence can override neutral technicals.
- technicals: RSI (overbought >70, oversold <30), MACD sign/momentum, proximity_to_support / proximity_to_resistance (scaled distances — lower often means nearer the level).

Strategy hints (not rigid rules — reason holistically):
- HIGH CONVICTION LONG: Bull regime (state 2), sentiment > 0.2, and (price nearer support OR RSI not extremely overbought).
- HIGH CONVICTION SHORT: Bear regime (state 0), sentiment < -0.2, and (price nearer resistance OR RSI not extremely oversold).
- NEUTRAL / HOLD: conflicting signals or neutral regime when uncertainty dominates.

Respond with disciplined risk-aware language; no guarantees.`;

/** AI Analysis (forex universe): interpret only HMM regime + OHLC-derived features — no headline news or equity context. */
const FOREX_SENTINEL_OHLC_HMM_ONLY_INSTRUCTION = `You are "Forex Sentinel Alpha" in OHLC+HMM-only mode.

The observation was built from forex price data (CSV) and a Hidden Markov Model on RSI/MACD features. The directional_forecast weights are HMM + FX technicals only (news sentiment was not blended).

Rules:
- Base reasoning on hmm_regime, directional_forecast, technicals, and pivot/touch_race fields in the JSON.
- Do NOT cite company earnings, equity fundamentals, or headline news feeds; if sentiment.score is 0 and a note says it was excluded, treat news as unavailable.
- Describe uncertainty when regime_unstable is true or entropy is high.

Respond with disciplined risk-aware language; no guarantees.`;

export type ForexSentinelInsightOpts = {
  /** True when backend used hmm_and_fx_data_only / AI Analysis forex universe */
  ohlcHmmOnly?: boolean;
};

export const getForexSentinelInsight = async (
  observation: Record<string, unknown>,
  opts?: ForexSentinelInsightOpts
): Promise<InsightResponse> => {
  const ohlcHmm =
    Boolean(opts?.ohlcHmmOnly) ||
    observation['analysis_mode'] === 'forex_ohlc_hmm_only';
  const instruction = ohlcHmm
    ? FOREX_SENTINEL_OHLC_HMM_ONLY_INSTRUCTION
    : FOREX_SENTINEL_ALPHA_INSTRUCTION;
  const task = [
    instruction,
    '',
    '---',
    'Observation JSON:',
    JSON.stringify(observation, null, 2),
    '',
    'Return ONLY valid JSON with keys: sentiment (one of Bullish, Bearish, Neutral), summary, pros (array of strings), cons (array of strings), recommendation (string), confidence (number 0-100).',
  ].join('\n');

  const maxOut = Math.min(getInsightMaxOutputTokens(), FOREX_INSIGHT_MAX_OUTPUT_TOKENS_DEFAULT);
  const raw = await hfGenerateText(task, maxOut, { jsonOnly: true, temperature: jsonInsightTemperature() });
  if (!raw.trim()) {
    throw new Error('Forex Sentinel returned an empty response. Please retry.');
  }

  try {
    const parsed = parseJsonWithRecovery(raw);
    return toInsightResponse(parsed);
  } catch (e) {
    console.error('Forex Sentinel JSON parse', e);
    return fallbackInsightFromText(raw);
  }
};

function toGeminiChatHistory(
  history: { role: string; parts: { text: string }[] }[]
): GeminiChatTurn[] {
  const out: GeminiChatTurn[] = [];
  for (const h of history) {
    const text = (h.parts || []).map((p) => p.text).join('\n').trim();
    if (!text) continue;
    const r = (h.role || '').toLowerCase();
    const role = r === 'assistant' || r === 'model' ? 'model' : 'user';
    out.push({ role, parts: [{ text }] });
  }
  while (out.length > 0 && out[0].role !== 'user') {
    out.shift();
  }
  return out;
}

export const chatWithAdvisor = async (
  history: { role: string; parts: { text: string }[] }[],
  message: string
) => {
  if (getLlmProvider() === 'gemini') {
    const initial = toGeminiChatHistory(history);
    return geminiCallWithRetries(async (model) => {
      const contents: GeminiChatTurn[] = [
        ...initial.map((t) => ({ role: t.role, parts: t.parts.map((p) => ({ text: p.text })) })),
        { role: 'user', parts: [{ text: message }] },
      ];
      const body: Record<string, unknown> = {
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { maxOutputTokens: 2048 },
      };
      const { text: t } = await geminiRestGenerateContent(model, body);
      const trimmed = t.trim();
      if (!trimmed) throw new Error('Gemini returned empty chat reply');
      return trimmed;
    });
  }

  const histText = history
    .map((h) => {
      const body = (h.parts || []).map((p) => p.text).join("\n");
      return `${h.role}: ${body}`;
    })
    .join("\n");

  const prompt = `${histText}\nuser: ${message}\nassistant:`;
  const raw = await hfGenerateText(prompt, 2048);
  return raw.trim();
};

/** Market news: with `gemini` provider, uses Google Search grounding when supported; HF/Ollama paths are prompt-only (no live sources). */
export const getMarketNews = async () => {
  const task =
    "Provide a brief summary of the top 5 global market stories relevant to a stock market dashboard right now. Include a sentiment (positive, negative, or neutral) for each story. Plain text paragraphs are fine.";

  if (getLlmProvider() === 'gemini') {
    return geminiCallWithRetries(async (model) => {
      const body: Record<string, unknown> = {
        contents: [{ role: 'user', parts: [{ text: task }] }],
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        generationConfig: { maxOutputTokens: 1536 },
        // REST JSON uses snake_case for tool ids (see ai.google.dev grounding docs).
        tools: [{ google_search: {} } as Record<string, unknown>],
      };
      const { data, text } = await geminiRestGenerateContent(model, body);
      const first = (data.candidates as unknown[] | undefined)?.[0] as
        | Record<string, unknown>
        | undefined;
      const chunks =
        (first?.groundingMetadata as Record<string, unknown> | undefined)?.groundingChunks ?? [];
      type GroundChunk = { web?: { uri?: string; title?: string } };
      const sources = (chunks as GroundChunk[])
        .map((c) => c.web)
        .filter((w): w is { uri: string; title: string } => Boolean(w && typeof w.uri === 'string'))
        .map((w) => ({ uri: w.uri, title: String(w.title ?? '') }));
      return { text, sources };
    });
  }

  const text = await hfGenerateText(task, 1536);

  return {
    text,
    sources: [] as { uri: string; title: string }[],
  };
};
