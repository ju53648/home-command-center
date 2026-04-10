@echo off
setlocal

rem === Anpassen: deine Repo URL ===
set "REPO_URL=https://github.com/DEIN_USER/DEIN_REPO.git"
set "BRANCH=main"
set "TARGET_DIR=%ProgramData%\HomeCommandCenterAgent"

echo =========================================
echo HCC Agent - Install oder Update von Git
echo =========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git wurde nicht gefunden. Bitte Git installieren:
  echo https://git-scm.com/download/win
  pause
  exit /b 1
)

if "%REPO_URL%"=="https://github.com/DEIN_USER/DEIN_REPO.git" (
  echo Bitte zuerst oben in dieser Datei REPO_URL anpassen.
  pause
  exit /b 1
)

if not exist "%TARGET_DIR%" (
  echo [1/3] Clone nach "%TARGET_DIR%"...
  git clone --branch "%BRANCH%" "%REPO_URL%" "%TARGET_DIR%"
  if errorlevel 1 (
    echo Clone fehlgeschlagen.
    pause
    exit /b 1
  )
) else (
  echo [1/3] Update in "%TARGET_DIR%"...
  pushd "%TARGET_DIR%"
  git fetch --all --prune
  git checkout "%BRANCH%"
  git pull --ff-only origin "%BRANCH%"
  if errorlevel 1 (
    popd
    echo Update fehlgeschlagen.
    pause
    exit /b 1
  )
  popd
)

echo [2/3] Agent Setup starten...
if exist "%TARGET_DIR%\agents\windows-agent\START_HERE.cmd" (
  call "%TARGET_DIR%\agents\windows-agent\START_HERE.cmd"
) else (
  echo START_HERE.cmd nicht gefunden unter:
  echo %TARGET_DIR%\agents\windows-agent\START_HERE.cmd
  pause
  exit /b 1
)

echo [3/3] Fertig. Fuer spaetere Updates einfach diese Datei erneut starten.
echo.
pause
