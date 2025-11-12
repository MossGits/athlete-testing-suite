@echo off
setlocal EnableExtensions

:: ----------------- USER SETTINGS (edit if needed) -----------------
set "APP_PORT=8080"
:: If ngrok.exe is NOT on your PATH, set its full path here:
:: set "NGROK_EXE=C:\Program Files\ngrok\ngrok.exe"

:: OPTIONAL: paste your ngrok auth token to auto-configure (leave blank if already configured)
:: set "NGROK_AUTHTOKEN=YOUR_NGROK_AUTHTOKEN_HERE"
:: ------------------------------------------------------------------

:: Elevate to Administrator if not already
>nul 2>&1 net session
if %errorlevel% neq 0 (
  echo Requesting Administrator privileges...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

title ngrok tunnel (Admin)

:: Locate ngrok.exe
if not defined NGROK_EXE (
  where ngrok.exe >nul 2>&1
  if %errorlevel%==0 (
    for /f "delims=" %%P in ('where ngrok.exe') do set "NGROK_EXE=%%P"
  ) else (
    if exist "C:\Program Files\ngrok\ngrok.exe" (
      set "NGROK_EXE=C:\Program Files\ngrok\ngrok.exe"
    ) else if exist "%USERPROFILE%\AppData\Local\Programs\ngrok\ngrok.exe" (
      set "NGROK_EXE=%USERPROFILE%\AppData\Local\Programs\ngrok\ngrok.exe"
    ) else (
      echo [ERROR] ngrok.exe not found in PATH or common install locations.
      echo Download/Install from https://ngrok.com/download and try again.
      pause
      exit /b 1
    )
  )
)

:: Optionally configure auth token (safe to run repeatedly)
if defined NGROK_AUTHTOKEN (
  echo Configuring ngrok auth token...
  "%NGROK_EXE%" config add-authtoken %NGROK_AUTHTOKEN%
)

echo.
echo Starting ngrok tunnel to http://localhost:%APP_PORT% ...
echo (Keep this window open; press Ctrl+C to stop.)
echo.

:: Open ngrok local dashboard (optional)
start "" "http://127.0.0.1:4040"

:: Run the tunnel in this Admin console
"%NGROK_EXE%" http %APP_PORT%

endlocal
