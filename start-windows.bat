@echo off
REM AI Meeting Room - one-click launcher for Windows.
REM Double-click this file. First run installs dependencies and builds the UI.
chcp 65001 >nul
cd /d "%~dp0"

echo ===============================================
echo         AI Meeting Room  -  Starting
echo ===============================================

REM --- 1. Node.js check (needs >= 22.5 for the built-in SQLite) ---------------
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Error] Node.js not found.
  echo Please install Node.js 22.5 or newer: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a>22||(a===22&&b>=5))?0:1)"
if errorlevel 1 (
  echo.
  echo [Error] Your Node.js is too old. Version 22.5 or newer is required.
  echo Please upgrade: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

REM --- 2. Chrome check (the app drives your installed Chrome) -----------------
if not exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  if not exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    if not exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
      echo.
      echo [Note] Google Chrome was not found in the usual locations.
      echo This app needs Chrome or Edge to drive the web AIs. Install Chrome:
      echo https://www.google.com/chrome/
      echo.
      pause
    )
  )
)

REM --- 3. Install dependencies on first run -----------------------------------
if not exist "node_modules" (
  echo.
  echo [1/2] First run: installing dependencies ^(this may take a few minutes^)...
  call npm install
  if errorlevel 1 ( echo [Error] npm install failed. & pause & exit /b 1 )
)

REM --- 4. Build the web UI ----------------------------------------------------
REM Always rebuild: web\dist is git-ignored, so after pulling new code the old
REM build would otherwise be served. The build is quick.
echo.
echo [2/2] Building the web UI (ensuring it matches the latest code)...
call npm run build
if errorlevel 1 ( echo [Error] UI build failed. & pause & exit /b 1 )

REM --- 5. Start ----------------------------------------------------------------
echo.
echo Starting. A controlled Chrome window will open shortly:
echo   - On first use, log into the AIs you want (ChatGPT / Gemini / DeepSeek ...)
echo   - Then create a meeting in the page that opens automatically.
echo Close this window to stop the program.
echo -----------------------------------------------
call npm start
pause
