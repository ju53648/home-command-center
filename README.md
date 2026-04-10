# Home Command Center

Lokales Smart-Home- und Device-Control-Center mit Rollen, Szenen, MQTT und Windows-Agent-Template.

## Neu umgesetzt

- Rollenbasiertes Login:
  - admin: alles
  - member: ausfuehren + publish
  - viewer: nur lesen
- Benutzerverwaltung (Admin)
- MQTT Integration (Status, Config, Publish)
- Device Actions mit zwei Modi:
  - HTTP
  - MQTT
- Szenensteuerung fuer mehrere Schritte
- Aktivitaetslog
- Windows-Agent-Vorlage fuer Programmsteuerung auf Ziel-PCs

## Voraussetzungen

- Node.js 18+
- Optional fuer MQTT: `npm install`

## Start

```bash
npm install
npm start
```

Dann Browser:

- http://localhost:8877

## Login

Beim ersten Start wird automatisch erstellt:

- Username: `admin`
- Passwort: `admin123`

Bitte nach dem ersten Login sofort in der Benutzerverwaltung aendern.

## MQTT

1. Als Admin in der MQTT-Sektion Broker eintragen.
2. Aktivieren und speichern.
3. Testweise Topic + Payload publishen.

Wenn MQTT nicht verfuegbar ist, fehlt meist das Modul (`npm install`).

## Windows Agent nutzen

1. Auf Ziel-PC Ordner [agents/windows-agent](agents/windows-agent) kopieren.
2. Agent starten:

```powershell
powershell -ExecutionPolicy Bypass -File .\agent.ps1 -Port 5000 -Token "SECRET"
```

3. Im Control Center Device anlegen:
  - Base URL: `http://<ziel-pc-ip>:5000`
  - Token: `SECRET`
  - Actions JSON Beispiel:

```json
[
  { "name": "Health", "mode": "http", "method": "GET", "path": "/health", "body": "" },
  { "name": "Spotify starten", "mode": "http", "method": "POST", "path": "/program/start", "body": "{\"name\":\"spotify.exe\"}" },
  { "name": "Monitor aus", "mode": "http", "method": "POST", "path": "/monitor/off", "body": "{}" },
  { "name": "Wohnzimmer MQTT", "mode": "mqtt", "topic": "home/livingroom/scene", "body": "{\"state\":\"movie\"}" }
]
```

## API (Kurz)

- Auth:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- State:
  - `GET /api/state`
- Users (admin):
  - `GET /api/users`
  - `POST /api/users`
  - `PUT /api/users/:id/password`
- MQTT:
  - `GET /api/mqtt/status`
  - `PUT /api/mqtt/config`
  - `POST /api/mqtt/publish`
- Devices:
  - `POST /api/device`
  - `PUT /api/device/:id`
  - `DELETE /api/device/:id`
  - `POST /api/device/:id/action`
- Scenes:
  - `POST /api/scene`
  - `DELETE /api/scene/:id`
  - `POST /api/scene/:id/run`
