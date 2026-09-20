## Versionierung

- Nach jeder Änderung am Skript-Code immer zuerst die Versionsnummer im `@version`-Header von `kleinazeigen-plus.js` hochzählen. Kein Ausnahmefall, auch nicht bei kleinen Fixes.
- Es gibt keinen Build-Schritt — `kleinazeigen-plus.js` ist direkt die Datei, die der Nutzer über Tampermonkey/Violentmonkey lädt (auch für Auto-Updates via `@updateURL`/`@downloadURL`). Nach dem Versions-Bump ist also nichts weiter zu bauen.
- Reine Doku-/Meta-Änderungen ohne jede Änderung am Skript-Code (z. B. README, graphify-Ausschluss) brauchen keinen Versions-Bump.

## Testen

- Soll etwas getestet oder live nachvollzogen werden (DOM-Struktur, Layout-Bug, ob ein Fix wirklich greift), das im echten Chrome-Browser des Nutzers tun (`claude-in-chrome`-Tools), nicht im eingebauten Browser-Pane. Der Nutzer testet das Tampermonkey-Skript in seinem echten Chrome, und Selektoren/Layout von kleinanzeigen.de sind dort am verlässlichsten zu prüfen.
- Tampermonkey/Violentmonkey selbst (Dashboard, Skript-Editor, `chrome://extensions`) NICHT über `claude-in-chrome` ansteuern oder das Skript dort aktualisieren/installieren — das macht der Nutzer immer selbst. Nur die eigentlichen kleinanzeigen.de-Seiten mit dem bereits geladenen Skript besuchen/testen.
