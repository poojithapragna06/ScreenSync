@echo off
rem ============================================================
rem ScreenSync TV launcher (Windows)
rem
rem Opens a TV page full screen with video AND sound starting on
rem their own - nobody has to click anything on the screen.
rem Run it on each laptop / PC that acts as a TV screen.
rem
rem   Double-click it and answer the questions, or run:
rem   launch-tv.bat <screensync-pc-name-or-ip> <lan|wifi> [screen-name]
rem   e.g. launch-tv.bat dept-pc wifi canteen_tv
rem   (prefer the PC name: YouTube blocks some videos on IP addresses)
rem
rem Close the TV window with Alt+F4.
rem ============================================================
setlocal

set "SERVER=%~1"
set "TYPE=%~2"
set "NAME=%~3"

if "%SERVER%"=="" set /p "SERVER=Name or IP address of the ScreenSync PC (e.g. dept-pc or 192.168.1.10): "
if "%SERVER%"=="" (
  echo No PC name or address given.
  pause
  exit /b 1
)
if "%TYPE%"=="" set /p "TYPE=Screen type, lan or wifi [wifi]: "
if "%TYPE%"=="" set "TYPE=wifi"
if "%NAME%"=="" if "%~1"=="" set /p "NAME=Screen name, e.g. lobby_tv (optional, press Enter to skip): "

rem TV pages are served by the ScreenSync server itself, on port 3000
set "PAGE=wifi"
if /i "%TYPE%"=="lan" set "PAGE=lan"

set "URL=http://%SERVER%:3000/tv/%PAGE%/?kiosk=1"
if not "%NAME%"=="" set "URL=%URL%&id=%NAME%"

rem Chrome first, Edge as a fallback (both understand the same options)
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
  echo Could not find Google Chrome or Microsoft Edge.
  pause
  exit /b 1
)

echo Opening "%URL%"

rem --autoplay-policy  : videos may start with sound without a click
rem --kiosk            : full screen, no address bar
rem --user-data-dir    : separate profile, so these options work even if
rem                      the browser is already open for normal browsing
start "" "%BROWSER%" ^
  --user-data-dir="%LocalAppData%\ScreenSyncTV" ^
  --kiosk ^
  --autoplay-policy=no-user-gesture-required ^
  --no-first-run ^
  --disable-session-crashed-bubble ^
  --noerrdialogs ^
  --disable-features=Translate ^
  "%URL%"

endlocal
