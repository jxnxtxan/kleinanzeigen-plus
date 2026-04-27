# Kleinanzeigen Plus (Userscript)

Ein Userscript fuer `kleinanzeigen.de`, das eine kleine Tools-Oberflaeche in der Kopfzeile hinzufuegt und die gewuenschte Sortierung automatisch setzen kann.

## Funktionen

- Tools-Button im Header mit Einstellungs-Panel
- Automatisches Setzen der bevorzugten Sortierung
- Manuelles Anwenden per `Jetzt anwenden`-Button
- Speicherung der Einstellungen in `localStorage`
- Update-Unterstuetzung ueber Tampermonkey/Violentmonkey (`@updateURL`, `@downloadURL`)

## Voraussetzungen

- Browser mit Userscript-Manager:
  - Tampermonkey oder
  - Violentmonkey

## Installation

1. Userscript-Manager installieren (falls noch nicht vorhanden).
2. Diese Raw-URL im Browser oeffnen:
   - `https://raw.githubusercontent.com/jxnxtxan/kleinanzeigen-plus/main/kleinazeigen-plus.js`
3. Script im Userscript-Manager bestaetigen und installieren.

## Verwendung

1. `https://www.kleinanzeigen.de/` aufrufen.
2. Im Header den Button `Tools` oeffnen.
3. Sortier-Automatik aktivieren/deaktivieren.
4. Gewuenschte Sortierung auswaehlen:
   - `Neueste`
   - `Niedrigster Preis`
   - `Hoechster Preis`
5. Optional `Jetzt anwenden` klicken.

## Updates

Das Script ist fuer automatische Updates vorbereitet.

Wichtig:
- Die installierte Script-Version wird nur aktualisiert, wenn die Remote-Version **hoeher** ist.
- Bei jeder Aenderung die `@version` im Script erhoehen (z. B. `1.0.2` -> `1.0.3`).
- Danach `commit` + `push` auf `main`.

Manuell pruefen:
- Tampermonkey/Violentmonkey -> Script-Dashboard -> `Nach Updates suchen`.

## Entwicklung

Repository:
- `https://github.com/jxnxtxan/kleinanzeigen-plus`

Typischer Ablauf:
1. Script aendern (`kleinazeigen-plus.js`)
2. `@version` erhoehen
3. Commit erstellen
4. Nach GitHub pushen
5. Update in Tampermonkey testen

## Haftung / Hinweis

Dieses Projekt ist inoffiziell und steht in keiner Verbindung zu Kleinanzeigen.
