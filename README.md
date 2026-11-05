# Assistent

Dein persönlicher Agent als Website mit Dashboard:

- **To-do-Liste** direkt im Dashboard – du, der Agent und Claude können To-dos anlegen und abhaken
- **iCloud-Kalender** lesen, freie Zeit prüfen, Termine eintragen, ändern und löschen
- **iCloud-Mail** lesen, durchsuchen, markieren, verschieben und **Antwort-Entwürfe** schreiben (verschickt wird nie etwas automatisch)
- **Wetter** für deinen Ort
- **Tagesplan** jeden Morgen ab 6 Uhr – oder sobald dein Mac an ist: To-dos aus Terminen und Mails plus ein kurzes Briefing
- **Chat mit dem Agenten** im Dashboard („Hab ich Freitag um 15 Uhr Zeit?“) – live: Während er arbeitet, tauchen Karten auf, was er gerade macht („Prüfe deinen Kalender …“), und danach das Ergebnis („Frei“, neues To-do, Termin, Wetter, Mail-Entwurf)
- **Sprechen statt tippen**: auf die orange Kugel tippen und reden. Antworten wahlweise **nur als Text** oder **Text + Stimme** (tiefe, ruhige Stimme)
- **Connector für Claude**: In der Claude-App auf dem Mac kannst du direkt mit deinem Dashboard arbeiten

Beim ersten Start fragt dich der Assistent Schritt für Schritt, auf welche Apps er zugreifen darf. Alles lässt sich später unter **Verbindungen** ändern.

Der Assistent braucht **keine zusätzlichen Pakete** – nur Node.js.

---

## Als Mac-App (empfohlen)

Der Assistent kommt als eigene Mac-App mit orangem Symbol: eigenes Fenster, im Dock und im Launchpad, ohne Terminal und ohne Browser. Node.js und der Assistent stecken schon in der App – du musst nichts weiter installieren.

**Download (in Safari öffnen):**
https://github.com/volk36752-blip/assistent-agent/releases/latest/download/Assistent.dmg

1. Den Link in Safari öffnen – `Assistent.dmg` wird geladen. Danach oben rechts in Safari auf den Pfeil (Downloads) und die Datei anklicken.
2. Im Fenster, das aufgeht: **Doppelklick auf „Assistent“**.
3. Beim allerersten Mal sagt macOS, dass es die App nicht überprüfen kann (sie ist nicht bei Apple registriert). Dann: **Fertig** klicken → **Systemeinstellungen → Datenschutz & Sicherheit** → ganz nach unten → bei „Assistent“ auf **Dennoch öffnen** → mit deinem Mac-Passwort bestätigen.
4. Die App fragt, ob sie sich in **Programme** legen soll → **In Programme legen**.
5. Danach fragt sie nach den **Berechtigungen**: Mikrofon und Spracherkennung (zum Sprechen), Mitteilungen (für den Tagesplan am Morgen), Standort (fürs Wetter), ob sie **im Dock** bleiben und ob sie **morgens von selbst starten** soll. Dann geht es mit Kalender, Mail und Claude weiter.

Deine Daten liegen nur auf deinem Mac unter `~/Library/Application Support/Assistent`.

Im Menü **Assistent** findest du: **Einstellungen**, **Berechtigungen**, **Morgens von selbst starten**, **Im Dock behalten**, **In Safari öffnen** und **Datenordner im Finder zeigen**.

**Neue Version:** einfach den Link oben nochmal öffnen und die neue App genauso öffnen – sie ersetzt die alte, deine Daten bleiben.

Die App wird bei jeder Änderung am Code automatisch auf GitHub gebaut (`.github/workflows/mac-app.yml`). Selbst bauen geht auch: mit Xcode-Befehlszeilenwerkzeugen und Node.js Doppelklick auf **`Mac-App bauen.command`** – diese Version läuft aus dem Ordner und nutzt dein installiertes Node.js.

---

## Auf dem Mac starten (ohne App)

### 1. Node.js installieren (einmalig)

Lade die **LTS-Version** von [nodejs.org](https://nodejs.org/de/download) und installiere sie.

### 2. Code auf den Mac holen

Am einfachsten mit **GitHub Desktop**: Repository klonen und als Speicherort direkt deinen **Benutzerordner** wählen (z. B. `/Users/dein-name/assistent-agent`).

> Nicht in „Schreibtisch“, „Dokumente“, „Downloads“ oder iCloud Drive ablegen – dort darf ein automatisch gestarteter Dienst unter macOS oft nicht lesen.

Oder im Terminal:

```bash
cd ~
git clone https://github.com/DEIN-NAME/assistent-agent.git
```

### 3. Starten

Doppelklick auf **`Start.command`**. Es öffnet sich ein Terminal-Fenster (das muss offen bleiben) und Safari zeigt das Dashboard:

**http://localhost:3000**

Falls macOS meldet, die Datei könne nicht geöffnet werden: Rechtsklick auf `Start.command` → **Öffnen** → **Öffnen**.

### 4. Automatisch starten lassen (empfohlen)

Damit der Tagesplan jeden Morgen kommt, ohne dass du etwas startest, einmal im Terminal:

```bash
cd ~/assistent-agent
./scripts/autostart-an.sh
```

Ab dann läuft der Assistent im Hintergrund, sobald du dich am Mac anmeldest. Ausschalten mit `./scripts/autostart-aus.sh`.

---

## Was du für die Verbindungen brauchst

| App | Was du brauchst |
|---|---|
| iCloud-Kalender und -Mail | Deine Apple-ID und ein **app-spezifisches Passwort**: auf [account.apple.com](https://account.apple.com) unter „Anmeldung und Sicherheit“ → „App-spezifische Passwörter“ ([Anleitung von Apple](https://support.apple.com/de-de/102654)). Dafür muss die Zwei-Faktor-Authentifizierung an sein. |
| Wetter | Nur deinen Ort – kein Konto nötig ([Open-Meteo](https://open-meteo.com)) |
| Claude (Chat und Tagesplan) | Einen API-Schlüssel aus der [Claude Console](https://platform.claude.com/). Die API wird nach Verbrauch abgerechnet, getrennt von deinem Claude-Abo. |

Ohne Claude-Schlüssel funktionieren To-dos, Kalender, Mail und Wetter trotzdem; der Tagesplan ist dann ein einfaches Briefing ohne neue To-dos.

---

## Auf dem iPhone öffnen

In **Einstellungen → Vom iPhone aus öffnen** den Haken setzen. Dann zeigt der Assistent dir die Adresse, z. B. `http://dein-mac.local:3000`. Die öffnest du auf dem iPhone in Safari (gleiches WLAN). Tipp: „Teilen → Zum Home-Bildschirm“, dann sieht es aus wie eine App.

---

## Sprechen und Vorlesen

- **Sprechen:** Im Agent-Bereich auf die orange Kugel tippen und reden. Wenn du fertig bist, schickt der Agent die Frage von selbst ab.
- **Antwort:** Unten im Agent-Bereich „Nur Text“ oder „Text + Stimme“ wählen. Mit Stimme liest er Satz für Satz vor, schon während die Antwort kommt.
- **Gespräch:** Hast du gesprochen und die Stimme ist an, hört er nach seiner Antwort gleich wieder zu. Sagst du nichts, hört er auf.
- **Stimme einstellen:** Unter **Einstellungen → Stimme** Stimme, Tempo und Tonhöhe wählen. Standard ist eine männliche deutsche Stimme, etwas tiefer und langsamer.
- **Bessere Stimmen:** Die Stimmen kommen von deinem Gerät. Tiefere, natürlichere Stimmen kannst du nachladen: am Mac unter Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme, am iPhone unter Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Deutsch.

Gut zu wissen:

- Das Mikrofon funktioniert im Browser nur über eine sichere Verbindung: direkt am Mac über `http://localhost:3000` klappt es, auf dem iPhone über das WLAN (`http://…:3000`) nicht. Dort nimmst du solange das Mikrofon der Tastatur – oder später die Server-Version mit HTTPS.
- Die Spracherkennung übernimmt der Browser (Safari: Apple, Chrome: Google). Das Vorlesen passiert auf deinem Gerät.

---

## Mit Claude verbinden (Connector)

### Claude-App auf dem Mac

1. Claude-App → Einstellungen → **Entwickler** → **Konfiguration bearbeiten**
2. Diesen Eintrag einfügen (der genaue Pfad steht im Dashboard unter **Verbindungen → In der Claude-App benutzen**):

```json
{
  "mcpServers": {
    "assistent": {
      "command": "node",
      "args": ["/Users/DEIN-NAME/assistent-agent/bin/mcp-stdio.js"]
    }
  }
}
```

3. Claude ganz beenden und neu starten. Der Assistent muss dabei laufen.

Danach kannst du in Claude z. B. schreiben: „Was steht heute an?“, „Leg mir ein To-do an: Fahrrad zur Werkstatt, morgen“, „Hab ich Freitag Nachmittag Zeit?“.

### claude.ai und Claude auf dem iPhone

Dafür muss der Assistent aus dem Internet erreichbar sein (siehe „Später auf einem Server“). Dann in Claude einen eigenen Connector mit dieser Adresse anlegen:

```
https://deine-adresse.de/mcp/DEIN-ZUGANGSSCHLÜSSEL
```

Den Zugangsschlüssel findest du unter **Verbindungen**. Er ist wie ein Passwort – nicht weitergeben.

---

## Später auf einem Server

Der Assistent läuft auch in Docker. Auf dem Server:

```bash
git clone https://github.com/DEIN-NAME/assistent-agent.git
cd assistent-agent
# In docker-compose.yml ALLOWED_HOSTS und PUBLIC_URL auf deine Adresse ändern
docker compose up -d
docker compose logs     # zeigt den Einrichtungscode für den ersten Start
```

Davor gehört ein Webserver mit HTTPS, z. B. [Caddy](https://caddyserver.com):

```
assistent.example.de {
  reverse_proxy 127.0.0.1:3000
}
```

Deine Daten (Einstellungen, To-dos) kannst du vom Mac mitnehmen: einfach den Ordner `data` kopieren.

Einstellungen über Umgebungsvariablen:

| Variable | Bedeutung |
|---|---|
| `PORT` | Port (Standard 3000) |
| `HOST` | Adresse, auf die der Server hört (Standard: nur dieser Rechner) |
| `DATA_DIR` | Ordner für Daten (Standard `./data`) |
| `ALLOWED_HOSTS` | Erlaubte Hostnamen, durch Komma getrennt |
| `PUBLIC_URL` | Öffentliche Adresse, z. B. für den Connector |
| `TRUST_PROXY` | `1`, wenn ein HTTPS-Webserver davor sitzt |

---

## Sicherheit und Datenschutz

- Alle Zugangsdaten und To-dos liegen im Ordner **`data`** auf deinem Rechner. Er wird nie zu GitHub hochgeladen (`.gitignore`).
- Das Dashboard ist mit deinem Passwort geschützt. Ohne Passwort kommt niemand an Termine oder Mails.
- Standardmäßig ist der Assistent nur auf deinem Mac erreichbar. Fürs iPhone gibst du ihn bewusst im WLAN frei.
- Der Agent **verschickt keine Mails**, er speichert nur Entwürfe. Vor dem Löschen von Terminen fragt er nach.
- Inhalte aus Mails werden als Daten behandelt, nicht als Anweisungen an den Agenten.
- An Claude gehen nur die Inhalte, die der Agent für deine Frage braucht.

---

## Was (noch) nicht geht

- **WhatsApp**: Für private Chats gibt es keine offizielle Schnittstelle. Geplant ist ein Kurzbefehl auf dem iPhone, mit dem du eine Nachricht an den Assistenten teilst.
- **Apple Erinnerungen** und **Kontakte**: geplant.
- **Wiederkehrende Termine** kann der Agent lesen, aber noch nicht ändern oder löschen.

Wünsche kannst du im Dashboard unter **Verbindungen → Geplant** ankreuzen.

---

## Für Entwickler

```
server.js            Start
src/app.js           Webserver, API, Anmeldung
src/services.js      iCloud-Kalender, iCloud-Mail, Wetter, Claude
src/tools.js         Werkzeuge für den Agenten (Chat und Connector)
src/agent.js         Claude-Agent mit Werkzeugen
src/plan.js          Tagesplan ab 6 Uhr
src/mcp.js           Connector (MCP, Versionen 2024-11-05 bis 2026-07-28)
src/lib/             CalDAV, iCalendar mit Wiederholungen, IMAP, MIME, Zeitzonen
bin/mcp-stdio.js     Brücke für die Claude-App auf dem Mac
mac/main.swift       Mac-App: Fenster, startet den Assistenten, Sprache über macOS
scripts/             Mac-App bauen, Autostart an/aus
public/              Dashboard (HTML, CSS, JavaScript ohne Framework)
public/js/           Oberfläche: dashboard.js (Agent, Karten live), widgets.js, voice.js (Sprechen/Vorlesen), setup.js
test/                Tests mit nachgebauten Servern
```

Tests laufen ohne Internet gegen nachgebaute Server (CalDAV, IMAP, Claude-API, Wetter):

```bash
npm test
```
