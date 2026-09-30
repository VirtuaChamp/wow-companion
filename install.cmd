@echo off
cd /d "%~dp0"
echo WoW Companion installer
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
set "INSTALL_EXIT=%ERRORLEVEL%"
echo.
if "%INSTALL_EXIT%"=="0" goto done
echo The install stopped before it finished. Read the message above, fix it, and run install.cmd again.
goto end
:done
echo The install finished.
:end
echo.
pause
exit /b %INSTALL_EXIT%
