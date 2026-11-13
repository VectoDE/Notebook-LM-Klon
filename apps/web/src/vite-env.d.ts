/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Öffentlicher Turnstile-Site-Key (Build-Umgebung). Fehlt er, zeigt die Anmeldung einen Fehler. */
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  /** Google-Tag-Manager-Container (GTM-XXXX). Fehlt er, lädt nichts von Google und es gibt kein Banner. */
  readonly VITE_GTM_ID?: string;
  /** Token für das Meta-Tag google-site-verification (Search Console). */
  readonly VITE_GSC_VERIFICATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
