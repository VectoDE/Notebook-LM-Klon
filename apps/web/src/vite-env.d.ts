/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Öffentlicher Turnstile-Site-Key (Build-Umgebung). Fehlt er, zeigt die Anmeldung einen Fehler. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
