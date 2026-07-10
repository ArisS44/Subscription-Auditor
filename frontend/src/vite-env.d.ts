/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_VAPID_PUBLIC_KEY: string;
  /** Cloudflare Turnstile site key. Optional in dev — falls back to Cloudflare's
   *  public always-passing test key so local auth works without configuration. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
