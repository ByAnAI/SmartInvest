/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HF_API_TOKEN?: string;
  readonly VITE_HUGGING_FACE_TOKEN?: string;
  readonly VITE_HF_MODEL?: string;
  /** `hf` (default) | `ollama` — run models locally without Hugging Face Inference credits */
  readonly VITE_LLM_PROVIDER?: string;
  /** Ollama model id (after `ollama pull …`). Default: qwen2.5:7b */
  readonly VITE_OLLAMA_MODEL?: string;
  /** Override Ollama base URL; in `npm run dev` defaults to same-origin `/ollama` (Vite proxy). */
  readonly VITE_OLLAMA_BASE_URL?: string;
  readonly VITE_FINNHUB_KEY?: string;
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
