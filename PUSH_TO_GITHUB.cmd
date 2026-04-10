@echo off
setlocal
cd /d "%~dp0"

echo =========================================
echo Home Command Center - Push zu GitHub
echo =========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git ist nicht installiert oder nicht im PATH.
  echo Installiere Git: https://git-scm.com/download/win
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo Dieser Ordner ist noch kein Git-Repository.
  git init
)

set /p REMOTE_URL=GitHub Repo URL (z. B. https://github.com/USER/REPO.git): 
if "%REMOTE_URL%"=="" (
  echo Keine URL angegeben.
  pause
  exit /b 1
)

set /p BRANCH=Branch-Name [main]: 
if "%BRANCH%"=="" set "BRANCH=main"

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REMOTE_URL%"
) else (
  git remote set-url origin "%REMOTE_URL%"
)

git add -A

set /p MSG=Commit-Message [update]: 
if "%MSG%"=="" set "MSG=update"

git commit -m "%MSG%" >nul 2>nul
git branch -M "%BRANCH%"

echo.
echo Pushe nach origin/%BRANCH% ...
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo Push fehlgeschlagen. Eventuell Login/Token in GitHub erforderlich.
  pause
  exit /b 1
)

echo.
echo Fertig: Code ist auf GitHub.
pause
