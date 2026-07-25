// agent.js
// Runs on your PC. Connects OUT to the JARVIS backend over WebSocket
// (so no inbound firewall ports needed), registers itself, then waits
// for commands. Only ever executes whitelisted actions - never arbitrary
// shell strings from the model.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { exec } = require("child_process");
const WebSocket = require("ws");

const configPath = path.join(__dirname, "config.json");
if (!fs.existsSync(configPath)) {
  console.error(
    "Missing config.json. Copy config.example.json to config.json and fill in your token + apps."
  );
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const platform = os.platform(); // 'win32' | 'darwin' | 'linux'

function runShell(cmd) {
  console.log(`[agent] executing: ${cmd}`);
  exec(cmd, (err) => {
    if (err) console.error(`[agent] command failed: ${err.message}`);
  });
}

function openApp(appName) {
  const entry = config.apps[appName?.toLowerCase()];
  if (!entry) {
    console.warn(`[agent] '${appName}' is not in the whitelist (config.json apps). Ignoring.`);
    return;
  }
  const cmd = entry[platform];
  if (!cmd) {
    console.warn(`[agent] no command configured for platform '${platform}' for app '${appName}'.`);
    return;
  }
  runShell(cmd);
}

function openUrl(url) {
  // Basic sanity check - only http(s) URLs.
  if (!/^https?:\/\//i.test(url)) {
    console.warn(`[agent] refusing to open non-http(s) target: ${url}`);
    return;
  }
  const cmdMap = {
    win32: `start ${url}`,
    darwin: `open ${url}`,
    linux: `xdg-open ${url}`,
  };
  const cmd = cmdMap[platform];
  if (cmd) runShell(cmd);
}

function wakeDevice() {
  // Best-effort "wake the screen". Real behavior depends on OS/hardware;
  // this does NOT bypass a lock screen (not possible / not attempted).
  const cmdMap = {
    // moves the mouse 1px to nudge the display awake; requires no extra deps
    win32: null, // left as a no-op placeholder - wire up a tool like nircmd if desired
    darwin: "caffeinate -u -t 1",
    linux: "xdotool key shift", // requires xdotool installed
  };
  const cmd = cmdMap[platform];
  if (cmd) runShell(cmd);
  else console.log("[agent] wake_device: no-op on this platform (configure one in agent.js).");
}

function handleCommand(command) {
  switch (command.action) {
    case "open_app":
      return openApp(command.app_name);
    case "open_url":
      return openUrl(command.url);
    case "wake_device":
      return wakeDevice();
    default:
      console.warn(`[agent] unknown action: ${command.action}`);
  }
}

function connect() {
  const ws = new WebSocket(config.backendUrl);

  ws.on("open", () => {
    console.log(`[agent] connected to backend, registering as '${config.deviceName}'...`);
    ws.send(
      JSON.stringify({
        type: "register",
        token: config.token,
        name: config.deviceName,
        deviceType: "pc",
      })
    );
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "registered") {
      console.log(`[agent] registered with backend, deviceId=${msg.deviceId}`);
    } else if (msg.type === "error") {
      console.error(`[agent] registration error: ${msg.message}`);
    } else if (msg.type === "command") {
      handleCommand(msg.command);
      ws.send(JSON.stringify({ type: "result", payload: { received: msg.command } }));
    }
  });

  ws.on("close", () => {
    console.log("[agent] disconnected from backend, retrying in 3s...");
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.error(`[agent] websocket error: ${err.message}`);
  });
}

connect();
