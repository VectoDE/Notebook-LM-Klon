import type { Language } from "./theme-preferences.js";

/**
 * Texte für Einwilligungsbanner, Cookie-Einstellungen, Fußzeile und Datenschutzhinweise
 * (Issues #258, #259, #261, #262). Eigene Datei, damit die gemeinsamen Übersetzungen
 * nicht wachsen. Kurzfassung von docs/datenschutz.md; keine Rechtsberatung.
 */
export interface PrivacyNoticeSection {
  readonly heading: string;
  readonly body: readonly string[];
}

export interface PrivacyTexts {
  readonly bannerTitle: string;
  readonly bannerText: string;
  readonly bannerNoticeLink: string;
  readonly acceptAll: string;
  readonly necessaryOnly: string;
  readonly customize: string;
  readonly settingsTitle: string;
  readonly settingsIntro: string;
  readonly necessaryLabel: string;
  readonly necessaryDesc: string;
  readonly analyticsLabel: string;
  readonly analyticsDesc: string;
  readonly analyticsUnavailable: string;
  readonly save: string;
  readonly close: string;
  readonly savedAnalyticsOn: string;
  readonly savedAnalyticsOff: string;
  readonly footerLabel: string;
  readonly footerPrivacy: string;
  readonly footerCookies: string;
  readonly noticeTitle: string;
  readonly noticeDisclaimer: string;
  readonly noticeSections: readonly PrivacyNoticeSection[];
}

const de: PrivacyTexts = {
  bannerTitle: "Darf RelationNotes die Nutzung messen?",
  bannerText:
    "Mit Ihrer Erlaubnis laden wir Google Tag Manager und Google Analytics, um zu sehen, welche Funktionen genutzt werden. Dabei werden Cookies gesetzt und Daten an Google übermittelt. Ohne Erlaubnis lädt nichts davon. Sie können Ihre Wahl jederzeit unten über „Cookie-Einstellungen“ ändern.",
  bannerNoticeLink: "Datenschutzhinweise lesen",
  acceptAll: "Alle akzeptieren",
  necessaryOnly: "Nur notwendige",
  customize: "Anpassen",
  settingsTitle: "Cookie-Einstellungen",
  settingsIntro:
    "Hier entscheiden Sie, was außer dem technisch Nötigen geladen werden darf. Eine Änderung gilt sofort.",
  necessaryLabel: "Notwendig",
  necessaryDesc:
    "Anmelde-Cookie, Ihre Einstellungen und diese Entscheidung im Speicher Ihres Browsers. Ohne sie funktioniert die App nicht, daher immer aktiv.",
  analyticsLabel: "Messung (Google Tag Manager, Google Analytics 4)",
  analyticsDesc:
    "Setzt Cookies von Google und übermittelt Nutzungsdaten an Google, auch in die USA. Hilft uns zu sehen, was gebraucht wird.",
  analyticsUnavailable: "Auf dieser Installation ist keine Messung eingerichtet.",
  save: "Auswahl speichern",
  close: "Schließen",
  savedAnalyticsOn: "Gespeichert: Messung erlaubt.",
  savedAnalyticsOff: "Gespeichert: nur notwendige.",
  footerLabel: "Rechtliches",
  footerPrivacy: "Datenschutz",
  footerCookies: "Cookie-Einstellungen",
  noticeTitle: "Datenschutzhinweise",
  noticeDisclaimer:
    "Kurzfassung. Die vollständige Fassung steht in docs/datenschutz.md im Repository. Technischer Entwurf, keine Rechtsberatung.",
  noticeSections: [
    {
      heading: "Was wir speichern",
      body: [
        "Konto: E-Mail-Adresse (nur bei Anmeldung per Link), Anzeigename, Sprache und Passkey-Daten. Gastkonten verfallen nach 24 Stunden.",
        "Inhalte: Ihre Notebooks, Quellen, Chats, Notizen und erzeugten Ergebnisse.",
        "Sitzung: ein notwendiges Cookie (__Host-sid). Gespeichert wird nur ein Hash des Tokens, IP-Adresse und Browserkennung nur als täglich neu gesalzener Hash."
      ]
    },
    {
      heading: "Im Browser",
      body: [
        "Design, Farbmodus, Sprache, Spaltenlayout und Ihre Cookie-Entscheidung liegen im lokalen Speicher Ihres Browsers und verlassen das Gerät nicht."
      ]
    },
    {
      heading: "Reichweitenmessung ohne Cookies",
      body: [
        "Beim Öffnen der App erhöht unser Server einen Tageszähler. Gespeichert werden nur Datum, Messgröße und Anzahl. Kein Cookie, keine IP-Adresse, keine Kennung. Browser mit „Global Privacy Control“ oder „Do Not Track“ zählen wir nicht."
      ]
    },
    {
      heading: "Messung mit Google (nur mit Einwilligung)",
      body: [
        "Ist auf dieser Installation Google Tag Manager eingerichtet, fragen wir vorher. Bis Sie zustimmen, gilt für Google alles als abgelehnt und es wird nichts von Google geladen. Den Widerruf erreichen Sie jederzeit über „Cookie-Einstellungen“ unten auf der Seite."
      ]
    },
    {
      heading: "Sicherheitsprotokoll",
      body: [
        "Anmeldungen und Löschungen protokollieren wir mit Zeitpunkt, Art und betroffener ID, die IP-Adresse nur als gesalzenen Hash, nie Inhalte. Die Einträge werden nach 90 Tagen gelöscht."
      ]
    },
    {
      heading: "Löschen",
      body: [
        "Löschen Sie Ihr Konto, entfernen wir alle Datensätze und Dateien sofort. In der Wiederherstellungskopie der Datenbank bleiben sie noch bis zu 30 Tage, danach sind sie endgültig weg."
      ]
    },
    {
      heading: "Ihre Rechte",
      body: [
        "Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit, Widerspruch, Widerruf einer Einwilligung und Beschwerde bei einer Aufsichtsbehörde. Kontakt: siehe Impressum des Betreibers."
      ]
    }
  ]
};

const en: PrivacyTexts = {
  bannerTitle: "May RelationNotes measure usage?",
  bannerText:
    "With your permission we load Google Tag Manager and Google Analytics to see which features are used. This sets cookies and sends data to Google. Without permission none of it loads. You can change your choice at any time via “Cookie settings” at the bottom.",
  bannerNoticeLink: "Read the privacy notice",
  acceptAll: "Accept all",
  necessaryOnly: "Necessary only",
  customize: "Customize",
  settingsTitle: "Cookie settings",
  settingsIntro:
    "Decide what may load beyond what is technically required. Changes apply immediately.",
  necessaryLabel: "Necessary",
  necessaryDesc:
    "Sign-in cookie, your settings and this choice in your browser’s storage. The app does not work without them, so they are always on.",
  analyticsLabel: "Measurement (Google Tag Manager, Google Analytics 4)",
  analyticsDesc:
    "Sets cookies from Google and sends usage data to Google, including to the USA. Helps us see what people need.",
  analyticsUnavailable: "No measurement is set up on this installation.",
  save: "Save selection",
  close: "Close",
  savedAnalyticsOn: "Saved: measurement allowed.",
  savedAnalyticsOff: "Saved: necessary only.",
  footerLabel: "Legal",
  footerPrivacy: "Privacy",
  footerCookies: "Cookie settings",
  noticeTitle: "Privacy notice",
  noticeDisclaimer:
    "Short version. The full text is in docs/datenschutz.md in the repository. Technical draft, not legal advice.",
  noticeSections: [
    {
      heading: "What we store",
      body: [
        "Account: e-mail address (only for sign-in by link), display name, language and passkey data. Guest accounts expire after 24 hours.",
        "Content: your notebooks, sources, chats, notes and generated results.",
        "Session: one necessary cookie (__Host-sid). Only a hash of the token is stored; IP address and browser string only as a hash with a salt that changes daily."
      ]
    },
    {
      heading: "In your browser",
      body: [
        "Design, color mode, language, column layout and your cookie choice stay in your browser’s local storage and never leave the device."
      ]
    },
    {
      heading: "Cookie-free usage count",
      body: [
        "When the app opens, our server increments a daily counter. Only date, metric and count are stored. No cookie, no IP address, no identifier. Browsers sending “Global Privacy Control” or “Do Not Track” are not counted."
      ]
    },
    {
      heading: "Measurement with Google (consent only)",
      body: [
        "If Google Tag Manager is set up on this installation, we ask first. Until you agree, everything for Google is set to denied and nothing from Google loads. You can withdraw at any time via “Cookie settings” at the bottom of the page."
      ]
    },
    {
      heading: "Security log",
      body: [
        "Sign-ins and deletions are logged with time, type and the affected ID, the IP address only as a salted hash, never content. Entries are deleted after 90 days."
      ]
    },
    {
      heading: "Deletion",
      body: [
        "If you delete your account, all records and files are removed immediately. The database recovery history keeps them for up to 30 more days, after which they are gone for good."
      ]
    },
    {
      heading: "Your rights",
      body: [
        "Access, rectification, erasure, restriction, data portability, objection, withdrawal of consent and complaint to a supervisory authority. Contact: see the operator’s legal notice."
      ]
    }
  ]
};

const TEXTS: Record<Language, PrivacyTexts> = { de, en };

export function privacyTexts(language: Language): PrivacyTexts {
  return TEXTS[language];
}
