@echo off
title Game Portal
cd /d "%~dp0"
echo Starting Game Portal...  (keep this window open while people use the website)
echo.
node server\server.js
echo.
echo The portal stopped. Press any key to close.
pause >nul
