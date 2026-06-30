@echo off
echo 🚀 Starting DevX Server...
echo.

REM Kill any existing node processes
echo ⚡ Cleaning up existing processes...
taskkill /f /im node.exe >nul 2>&1
taskkill /f /im tsx.exe >nul 2>&1
timeout /t 2 >nul

REM Check if port 4000 is available, otherwise use 5000
echo 🔍 Checking port availability...
netstat -ano | findstr :4000 >nul
if %ERRORLEVEL% == 0 (
    echo ⚠️  Port 4000 is in use, switching to port 5000
    set PORT=5000
) else (
    echo ✅ Port 4000 is available
    set PORT=4000
)

echo.
echo 🌟 Starting server on port %PORT%...
echo.

npm run dev