/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_HOSTED?: string;
  readonly VITE_APP_ID?: string;
  readonly VITE_APP_SCHEMA?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_HUB_URL?: string;
  readonly VITE_COOKIE_DOMAIN?: string;
  readonly VITE_SUITE_URLS?: string;
  readonly VITE_DOCS_URL?: string;
  readonly VITE_SIGNUPS_OPEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
