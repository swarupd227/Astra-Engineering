@echo off
setlocal EnableDelayedExpansion
title NAT 2.0 Remote Agent
cd /d "%~dp0"

echo ============================================
echo   NAT 2.0 Remote Playwright Execution Agent
echo ============================================
echo.
echo Working dir : %cd%
echo Node binary : node\node.exe
echo Agent script: app\agent.cjs
echo Config      : config.json
echo.

REM ── Pre-flight checks ──────────────────────────────────────────────────────
REM Without these, a missing file or wrong CWD causes node to error silently
REM and the user sees only the banner + "Agent stopped". Surface the problem
REM up front so the tester can act on it instead of guessing.
if not exist "node\node.exe" (
  echo [ERROR] node\node.exe not found.
  echo The agent ZIP appears to be incomplete or extracted into the wrong folder.
  echo Re-download the agent from DevX Settings, extract to a path without
  echo spaces or OneDrive sync (e.g. C:\NAT-Agent), and try again.
  echo.
  goto :end
)
if not exist "app\agent.cjs" (
  echo [ERROR] app\agent.cjs not found.
  echo The agent bundle is incomplete. Re-download the agent ZIP.
  echo.
  goto :end
)
if not exist "config.json" (
  echo [WARNING] config.json not found.
  echo The agent will use defaults (ws://localhost:4000/ws/execution-agent).
  echo On AWS deployments this will fail to connect. Create config.json with
  echo your serverUrl before continuing.
  echo.
)

echo ---- Node version ----
node\node.exe -v
if errorlevel 1 (
  echo [ERROR] node\node.exe failed to launch ^(exit code !errorlevel!^).
  echo This usually means a 32-bit/64-bit mismatch or antivirus is blocking it.
  goto :end
)

if exist "config.json" (
  echo ---- config.json ----
  type config.json
  echo.
)

echo ---- Agent log ^(Ctrl+C to stop^) --------------------------------------
echo.

REM Merge stderr into stdout so require() failures, uncaught exceptions, and
REM WebSocket errors are visible. Without 2^>^&1, errors went to a separate
REM stream that the cmd window often hid behind buffered stdout.
node\node.exe app\agent.cjs 2>&1
set "AGENT_EXIT=!errorlevel!"

echo.
echo ============================================
if "!AGENT_EXIT!"=="0" (
  echo Agent stopped normally.
) else (
  echo Agent exited with code !AGENT_EXIT!
  echo See messages above for the cause. Common issues:
  echo   * Cannot find module ws / playwright   - the ZIP is missing node_modules
  echo   * ECONNREFUSED / ENOTFOUND             - serverUrl in config.json is wrong
  echo   * 401 Unauthorized                     - token in config.json is wrong
  echo   * Path contains spaces                 - extract to a path without spaces
)
echo ============================================

:end
echo.
echo Press any key to close this window.
pause >nul
endlocal
