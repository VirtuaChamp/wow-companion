@echo off
cd /d "%~dp0"
if not exist "config.json" goto noconfig
if not exist "data\questie.sqlite" goto nodb
if not exist "node_modules" goto noinstall
echo Starting the WoW Companion. Keep this window open while you play.
echo Press Ctrl+C to stop it.
echo.
call pnpm start
set "START_EXIT=%ERRORLEVEL%"
echo.
echo The WoW Companion stopped.
goto end
:noconfig
echo config.json was not found. Run install.cmd first: it creates config.json and sets everything up.
set "START_EXIT=1"
goto end
:nodb
echo The world database data\questie.sqlite was not found. Run install.cmd first: it builds the database from your QuestieDB checkout.
set "START_EXIT=1"
goto end
:noinstall
echo The project packages are not installed. Run install.cmd first.
set "START_EXIT=1"
:end
echo.
pause
exit /b %START_EXIT%
