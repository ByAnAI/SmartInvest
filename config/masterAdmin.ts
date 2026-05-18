/** Hard-coded fallback; override with `VITE_MASTER_ADMIN_EMAIL` in `.env`. */
const DEFAULT_MASTER_ADMIN = 'idris.elfeghi@byanai.com';

export const MASTER_ADMIN_EMAIL = (
  (import.meta.env.VITE_MASTER_ADMIN_EMAIL as string | undefined) || DEFAULT_MASTER_ADMIN
)
  .trim()
  .toLowerCase();
