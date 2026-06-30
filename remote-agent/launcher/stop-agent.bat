@echo off
echo Stopping NAT Agent...
for /f "tokens=2" %%a in ('wmic process where "CommandLine like '%%agent.cjs%%' and Name='node.exe'" get ProcessId /value 2^>nul ^| find "="') do (
    echo Killing PID %%a
    taskkill /f /pid %%a >nul 2>&1
)
echo Done.
timeout /t 2 >nul
