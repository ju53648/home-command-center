@echo off
setlocal
cd /d "%~dp0"

set "TASK_NAME=HomeCommandCenterAgent"
set "PORT=5000"
set "AGENT_FILE=%~dp0agent.ps1"
set "ALLOW_FILE=%~dp0allowed-programs.txt"

echo =========================================
echo Home Command Center - One Click Setup
echo =========================================
echo.

set /p TOKEN=Token eingeben (leer = ohne Token): 

set "AGENT_CMD=powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""%AGENT_FILE%"" -Port %PORT% -Token ""%TOKEN%"" -AllowedProgramsFile ""%ALLOW_FILE%"""

echo.
echo [1/3] Autostart-Task wird erstellt/aktualisiert...
schtasks /Create /TN "%TASK_NAME%" /TR "%AGENT_CMD%" /SC ONSTART /RL HIGHEST /F >nul
if errorlevel 1 (
  echo Fehler beim Anlegen der Aufgabe. Starte diese Datei als Administrator.
  pause
  exit /b 1
)

echo [2/3] Agent wird sofort gestartet...
schtasks /Run /TN "%TASK_NAME%" >nul

echo [3/3] Firewall-Regel fuer Port %PORT% wird gesetzt...
netsh advfirewall firewall add rule name="HCC Agent %PORT%" dir=in action=allow protocol=TCP localport=%PORT% >nul 2>nul

echo.
echo Fertig. Ab jetzt startet der Agent automatisch nach jedem Windows-Neustart.
echo Test im Browser auf dem Zielgeraet: http://localhost:%PORT%/health
echo.
pause
