@echo off
setlocal
cd /d "%~dp0"

set "REPO_URL=https://github.com/ju53648/home-command-center.git"
set "BRANCH=main"

echo =========================================
echo Windows Agent - Schnell Push
echo =========================================
echo.

where git >nul 2>nul
if errorlevel 1 (
  echo Git ist nicht installiert oder nicht im PATH.
  pause
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo Dieser Ordner ist noch kein Git-Repository.
  pause
  exit /b 1
)

git remote get-url origin >nul 2>nul
if errorlevel 1 (
  git remote add origin "%REPO_URL%"
) else (
  git remote set-url origin "%REPO_URL%"
)

git add agents/windows-agent README.md
git commit -m "update windows agent" >nul 2>nul
git branch -M "%BRANCH%"
git push -u origin "%BRANCH%"
if errorlevel 1 (
  echo Push fehlgeschlagen. Falls GitHub Login fragt, bestaetigen und erneut starten.
  pause
  exit /b 1
)

echo.
echo Fertig.
pause
