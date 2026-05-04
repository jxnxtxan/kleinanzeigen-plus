# Kleinanzeigen Plus

Userscript fuer `kleinanzeigen.de` mit einer kleinen Tools-Oberflaeche, automatischer Sortierung, Notizen und PDF auf Anzeigenseiten sowie einer Bild-Lupe in Suchergebnissen.

## Features

- Tools-Button im Header
- Einstellungs-Panel direkt auf der Seite
- Automatische Standard-Sortierung
- **Anzeige (`/s-anzeige/…`)**: Notizen (Speichern/Löschen, eigener Speicher `kaPlusNotesV1`), **Als PDF speichern** (direkter Download via eingebetteter [html2pdf.js](https://github.com/eKoopmans/html2pdf.js), `@require` im Script)
- **Suche**: gelbe Lupen-Schaltfläche auf Kartenbildern, Lightbox mit größtmöglicher Bild-URL
- Auto-Update ueber Tampermonkey/Violentmonkey

## Installation

1. Tampermonkey oder Violentmonkey installieren.
2. Diese URL im Browser oeffnen:
   - `https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js`
3. Installation im Userscript-Manager bestaetigen (CDN-Zugriff fuer `html2pdf` erlauben, falls gefragt).

## Nutzung

1. `https://www.kleinanzeigen.de/` oeffnen.
2. Im Header auf `Tools` klicken.
3. Sortier-Automatik und gewuenschte Sortierung einstellen.
4. Auf einer Anzeigenseite: Block **MEINE NOTIZEN** unter dem Kontaktbereich; PDF-Button fuer Archiv-Export.
5. In Suchergebnissen: gelbe **Lupe** auf dem Vorschaubild antippen.

## Update

Das Script enthaelt `@updateURL` und `@downloadURL` und kann automatisch aktualisiert werden.

Manuelle Pruefung:
- Tampermonkey/Violentmonkey -> Dashboard -> `Nach Updates suchen`

## Hinweis

Inoffizielles Projekt ohne Verbindung zu Kleinanzeigen. PDF-Export haengt von ladenden Bildern (CORS) ab; bei Problemen kann der Download fehlschlagen oder Bilder fehlen.
