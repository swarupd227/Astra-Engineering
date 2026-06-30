NAT 2.0 Remote Playwright Execution Agent
==========================================

SETUP
-----
1. Extract this ZIP to a local folder (e.g., C:\NAT-Agent).
   IMPORTANT: Do NOT extract into OneDrive or a folder with spaces in the path.

2. Edit config.json:
   - serverUrl : Your NAT 2.0 server URL.
                  Raw WebSocket   : wss://your-server.com/ws/execution-agent
                  Socket.IO       : https://your-server.com
                  (use Socket.IO when the network only allows /socket.io/* through a proxy)
   - agentId   : A unique name for this agent (e.g., "build-agent-01")
   - token     : The Bearer token provided by your admin (leave empty for local dev)
   - transport : Optional. "ws" or "socket.io". If omitted the agent infers
                  from the URL scheme: http(s):// → socket.io, ws(s):// → ws.

3. Double-click start-agent.bat to start with a visible console.
   Or double-click start-agent.vbs to start silently in the background.

4. To stop: double-click stop-agent.bat, or close the console window.

TROUBLESHOOTING
---------------
- If the agent can't connect, verify the serverUrl in config.json.
- If you see "401 Unauthorized", check your token value.
- The agent auto-reconnects if the server restarts.
- For verbose logs, run from cmd: node\node.exe app\agent.cjs
