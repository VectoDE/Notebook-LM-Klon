# Weitere Sprachkataloge

Eine Datei `<locale>.json` in diesem Ordner legt eine Sprache an, ohne dass Code geändert wird
(Anleitung und Zielsprachen: `docs/i18n.md`, Issue #351). Aufbau:

```json
{
  "$meta": { "fallback": ["de"], "dir": "ltr" },
  "sourcesTitle": "…",
  "sourcesCount.one": "{n} …",
  "sourcesCount.other": "{n} …"
}
```

Der Katalog darf unvollständig sein: Fehlende Schlüssel fallen einzeln auf die Kette
(Locale, Eltern-Tag, `$meta.fallback`, Deutsch, Englisch) zurück. Jede Datei lädt erst bei Wahl
der Sprache (eigener Chunk). Sichtbar sind Deutsch, Leichte Sprache (`de-x-ls.json`, vollständig,
siehe `docs/leichte-sprache.md`) und Englisch.
