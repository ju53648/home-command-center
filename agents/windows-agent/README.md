# Windows Agent

Dieser Agent laeuft auf einem Windows-Zielgeraet und nimmt HTTP-Befehle vom Home Command Center entgegen.

## One-Click (empfohlen)

Einfach nur diese eine Datei per Doppelklick starten:

```cmd
START_HERE.cmd
```

Das Skript:
- fragt deinen Token ab
- richtet Autostart ein
- startet den Agent sofort
- oeffnet Port 5000 in der Firewall

Danach musst du nichts mehr manuell starten.

Wenn der Agent-Ordner schon lokal auf dem Geraet liegt, reicht wirklich nur:

```cmd
START_HERE.cmd
```

## One-Click von Git (Install + spaeter Update)

Wenn du alles ueber Git verteilen willst, nutze auf dem Ziel-PC nur:

```cmd
INSTALL_OR_UPDATE_FROM_GIT.cmd
```

Wichtig:
- In dieser Datei einmal `REPO_URL` auf dein GitHub Repo setzen.
- Danach kannst du fuer Updates immer nur diese Datei erneut starten.

## Start

```powershell
powershell -ExecutionPolicy Bypass -File .\agent.ps1 -Port 5000 -Token "DEIN_TOKEN"
```

Oder als Python-Agent:

```powershell
py .\agent.py --port 5000 --token "DEIN_TOKEN"
```

## Autostart nach Reboot (Python)

Einmal ausfuehren:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1 -Port 5000 -Token "DEIN_TOKEN"
```

Dann startet der Agent automatisch bei jedem Windows-Start.

## Endpunkte

- `GET /health`
- `POST /program/start` mit Body `{ "name": "notepad.exe" }`
- `POST /program/stop` mit Body `{ "name": "notepad" }`
- `POST /monitor/off`

## Sicherheit

- Nutze immer `-Token`, wenn der Agent im Netzwerk erreichbar ist.
- Programme werden nur aus `allowed-programs.txt` gestartet.
