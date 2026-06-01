/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HF_API_TOKEN?: string;
  readonly VITE_HUGGING_FACE_TOKEN?: string;
  readonly VITE_HF_MODEL?: string;
  /**
   * HF Inference Providers API origin (e.g. https://router.huggingface.co) or full …/v1/chat/completions URL.
   * Omit on localhost: app uses same-origin /hf-router (Vite proxy). Set on static production hosts if you do not proxy /hf-router.
   */
  readonly VITE_HF_BASE_URL?: string;
  /** `hf` (default) | `ollama` | `gemini` — run models locally/alternate provider without Hugging Face Inference credits */
  readonly VITE_LLM_PROVIDER?: string;
  /** `auto` (default) | `ollama` | `gemini` | `none` — fallback when Hugging Face router/network fails. */
  readonly VITE_HF_NETWORK_FALLBACK_PROVIDER?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  readonly GEMINI_API_KEY?: string;
  /** Ollama model id (after `ollama pull …`). Default: qwen2.5:7b */
  readonly VITE_OLLAMA_MODEL?: string;
  /** GPU layers for Ollama (0 = CPU only, default). Also set OLLAMA_NUM_GPU=0 when starting `ollama serve`. */
  readonly VITE_OLLAMA_NUM_GPU?: string;
  /** Override Ollama base URL; in `npm run dev` defaults to same-origin `/ollama` (Vite proxy). */
  readonly VITE_OLLAMA_BASE_URL?: string;
  readonly VITE_FINNHUB_KEY?: string;
  /** `alphavantage` (default) avoids LLM/HF; `llm` uses Finnhub headlines + selected LLM provider. */
  readonly VITE_SENTIMENT_SOURCE?: string;
  readonly VITE_FOREX_LOCAL_FIRST?: string;
  /** Master account email (admin bypass for suspension / role). Default: idris.elfeghi@byanai.com */
  readonly VITE_MASTER_ADMIN_EMAIL?: string;
  /**
   * When true with VITE_AUTH_UNIVERSAL_PASSWORD set, login sends that password to Supabase instead of the typed value.
   * All accounts must have that password (run auth:bulk-set-universal-password).
   */
  readonly VITE_ALLOW_ANY_PASSWORD?: string;
  /** When true, only VITE_MASTER_ADMIN_EMAIL uses VITE_AUTH_UNIVERSAL_PASSWORD on sign-in (admin “any password”). */
  readonly VITE_ADMIN_ANY_PASSWORD?: string;
  readonly VITE_AUTH_UNIVERSAL_PASSWORD?: string;
  /** When `true`, skip browser navigator.locks for Supabase Auth (fewer Lock broken / steal errors in multi-tab or Strict Mode). Default behavior already uses memory locks; this flag remains for compatibility. */
  readonly VITE_SUPABASE_AUTH_MEMORY_LOCK?: string;
  /** When `true`, use native `navigator.locks` for auth (multi-tab coordination). Omit for faster tab close / fewer “Wait” prompts (default). */
  readonly VITE_SUPABASE_AUTH_WEB_LOCKS?: string;
  /**
   * Comma-separated tables stored only in the browser (IndexedDB), not Supabase:
   * `company_fundamentals`, `market_data`. Auth/profiles/portfolios/watchlists stay hosted.
   */
  readonly VITE_LOCAL_STORAGE_TABLES?: string;
}
