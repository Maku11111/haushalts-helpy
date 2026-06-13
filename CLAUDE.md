# Haushalts-Helpy

Eine schlanke Haushalts-Verwaltungs-App für eine Familie (5 Personen). Deutsche
Oberfläche, mobil-optimiert. **Eine einzige `index.html`-Datei** — kein Build,
kein npm, alles inline (HTML + CSS + JS).

## Live-Umgebung

- **App (GitHub Pages):** https://maku11111.github.io/haushalts-helpy/
  Deployt automatisch bei jedem Push auf `main`.
- **Backend (PocketBase):** https://pocketbase-alo1.srv1510303.hstgr.cloud
  Läuft als Docker-Container (`pocketbase-alo1-pocketbase-1`, Image
  `ghcr.io/muchobien/pocketbase`) auf einem Hostinger-VPS.

## Architektur

- **Frontend:** `index.html` — einzige Quelldatei. Enthält alles. Bei Änderungen
  immer diese Datei bearbeiten. (`index_v2.html` ist OBSOLET, nicht verwenden.)
- **SDK:** PocketBase JS-SDK via CDN (`pocketbase@0.21.3`). Achtung: Diese Version
  nutzt `pb.getFileUrl(record, name)` und `pb.baseUrl` (nicht `pb.files.getURL`).
- **QR:** `qrcodejs@1.0.0` (API: `new QRCode(el, opts)`).
- **Charts (Statistiken):** Chart.js via CDN.
- **Auth:** `pb.collection('users').authWithPassword(email, pw)`.
- **Backend-Logik:** PocketBase `pb_hooks/` (JavaScript-Hooks, siehe unten).

## PocketBase Collections

Alle Collections haben API-Regeln `@request.auth.id != ""` (nur eingeloggte
Nutzer). Felder:

| Collection   | Felder |
|--------------|--------|
| `users`      | (Standard PocketBase Auth) |
| `persons`    | name, emoji, color, birthday, email, notes |
| `locations`  | room, shelf, spot, shelves (num, Anzahl Fächer), photo (file), marker_x, marker_y, description |
| `inventory`  | name, category, quantity (num), min_stock (num), location_id, location, pos_x (num, horizontal %), pos_y (num, **Fachnummer** 1=oben) |
| `calendar`   | title, date, date_end, allday (bool), person, note |
| `todos`      | text, person, date, done (bool), recurrence (''/daily/weekly/monthly), priority (''/high/low) |
| `invoices`   | description, amount (num), date, category, status (offen/bezahlt), note, file, items (JSON-String) |
| `shopping`   | name, category, quantity (text), person, done (bool) |
| `documents`  | name, category, expiry_date, person, note, file |
| `allowance`  | person, type (credit/debit/bonus), amount (num), date, description |

**Wichtig:** Manuell angelegte Collections haben in neueren PocketBase-Versionen
KEIN automatisches `created`-Feld. Nicht nach `created` sortieren (führt zu
HTTP 400). Stattdessen nach fachlichen Feldern sortieren (z.B. `date`, `done`).

## Tabs / Bereiche der App

Start (Dashboard), Personen, Inventar, Kalender (Monat/Woche/Tag), To-dos,
Rechnungen, Einkauf, Dokumente, Statistiken, Taschengeld.

## Spracheingabe & Telegram (KI-Parser)

`pb_hooks/main.pb.js` + `pb_hooks/hh.js` bilden einen KI-Parser, der deutsche
Sätze in App-Einträge umwandelt. Zwei Eingänge:

- **🎤-Button in der App** → `POST /api/voice-input` (Auth nötig). Browser-
  Spracherkennung (Web Speech API, de-DE) liefert den Text.
- **Telegram-Bot** (@Haushaltshelpybot) → `POST /api/telegram-webhook`
  (Secret-Token-geschützt). Text + Sprachnachrichten (Whisper-Transkription).

Der Parser ruft die **Claude API** (Modell `claude-haiku-4-5`) auf und gibt
`{actions:[{collection, data}], reply}` zurück. Sprachnachrichten werden per
**OpenAI Whisper** transkribiert.

### Secrets (NICHT im Repo!)

`hh.js` im Repo enthält Platzhalter `__CLAUDE_KEY__`, `__TG_TOKEN__`,
`__TG_SECRET__`, `__OPENAI_KEY__`. Die echten Schlüssel liegen NUR auf dem VPS
in `/var/lib/docker/volumes/pocketbase-alo1_pb_hooks/_data/hh.js`.

### pb_hooks auf den Server deployen

Da die Cloud-Umgebung keinen direkten Server-Zugriff hat: Datei auf GitHub
pushen, dann diese Befehle im VPS-Terminal ausführen lassen (Nutzer hat
SSH-Zugang als root). Commit-Hash in der URL verhindert CDN-Cache:

```sh
D=/var/lib/docker/volumes/pocketbase-alo1_pb_hooks/_data
curl -fsSL https://raw.githubusercontent.com/Maku11111/haushalts-helpy/<COMMIT>/pb_hooks/main.pb.js -o $D/main.pb.js
curl -fsSL https://raw.githubusercontent.com/Maku11111/haushalts-helpy/<COMMIT>/pb_hooks/hh.js -o $D/hh.js
sed -i 's|__CLAUDE_KEY__|...|; s|__TG_TOKEN__|...|; s|__TG_SECRET__|...|; s|__OPENAI_KEY__|...|' $D/hh.js
docker restart pocketbase-alo1-pocketbase-1
```

PocketBase-Handler laufen in isolierten VMs → gemeinsame Logik in `hh.js`,
per `require(__hooks + "/hh.js")` INNERHALB jedes Handlers laden (keine
Top-Level-Variablen zwischen Handlern teilen).

## Entwicklungs-Konventions

- **Deutsche UI**, alle Texte/Labels auf Deutsch.
- **Eine Datei:** Neue Features in `index.html` einbauen, nicht aufteilen.
- **Stil:** An vorhandenen Code anpassen (CSS-Variablen oben im `<style>`,
  bestehende Helfer wie `esc()`, `toast()`, `fmtDate()`, `fmtEuro()` nutzen).
- **Zeitzonen:** PocketBase speichert UTC. Für Kalender-Anzeige `parsePBDate()`
  nutzen (parst als lokale Zeit), sonst verschieben sich ganztägige Termine.

## Lokal testen (Preview)

`.claude/launch.json` startet `npx serve -l 3000 .`. Im Browser einloggen, dann
testen. GitHub Pages aktualisiert sich ~1-2 Min nach Push.

## Deploy-Flow (Zusammenfassung)

1. `index.html` bearbeiten → committen → `git push` → GitHub Pages live.
2. Bei `pb_hooks`-Änderungen zusätzlich die Server-Befehle oben ausführen.
