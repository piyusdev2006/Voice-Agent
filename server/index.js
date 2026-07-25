// index.js
// JARVIS backend.
// 1. Serves a simple frontend (public/) with mic input.
// 2. POST /api/command receives a voice transcript, sends it to local Ollama
//    with tool definitions, and either answers directly (chat) or executes
//    a tool call by dispatching it to connected device agents.
// 3. WebSocket endpoint /agent-ws is where PC/phone agents connect in and
//    register themselves so they can be commanded.

require("dotenv").config();
const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const fetch = require("node-fetch");
const crypto = require("crypto");

const registry = require("./deviceRegistry");
const { tools, knownSites } = require("./tools");
const { matchFallbackIntent } = require("./fallbackIntent");

const PORT = process.env.PORT || 4000;
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "llama3.2:3b";
const AGENT_TOKEN = process.env.AGENT_TOKEN; // shared secret, required

if (!AGENT_TOKEN) {
  console.error(
    "FATAL: AGENT_TOKEN is not set. Create server/.env from .env.example and set a secret token."
  );
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/agent-ws" });

// ---- Device agent connections ----
wss.on("connection", (ws, req) => {
  let registered = false;
  let deviceId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // First message from an agent must be a "register" handshake with the token.
    if (msg.type === "register") {
      if (msg.token !== AGENT_TOKEN) {
        ws.send(JSON.stringify({ type: "error", message: "invalid token" }));
        ws.close();
        return;
      }
      deviceId = crypto.randomUUID();
      registered = true;
      registry.registerDevice(deviceId, ws, msg.name || "unnamed-device", msg.deviceType || "generic");
      ws.send(JSON.stringify({ type: "registered", deviceId }));
      return;
    }

    if (!registered) {
      ws.close();
      return;
    }

    // Agents can send back command results / logs.
    if (msg.type === "result") {
      console.log(`[agent result] ${deviceId}:`, msg.payload);
    }
  });

  ws.on("close", () => {
    if (deviceId) registry.removeDevice(deviceId);
  });
});

function sendToDevice(device, command) {
  return new Promise((resolve) => {
    if (device.ws.readyState !== device.ws.OPEN) return resolve({ ok: false, reason: "not connected" });
    device.ws.send(JSON.stringify({ type: "command", command }));
    resolve({ ok: true });
  });
}

// Resolve a "target" string from the model into a list of actual connected devices.
function resolveTargets(target) {
  const all = registry.getAllDevices();
  if (!target || target === "primary") {
    // Primary = first device registered as type "pc", falling back to the first device overall.
    const pc = all.find((d) => d.type === "pc");
    return pc ? [pc] : all.slice(0, 1);
  }
  if (target === "all") return all;
  return registry.findDevices({ name: target });
}

// ---- Tool execution ----
async function executeTool(name, args) {
  switch (name) {
    case "list_devices": {
      const devices = registry.listDevices();
      if (devices.length === 0) return "No devices are currently connected.";
      const names = devices.map((d) => `${d.name} (${d.type})`).join(", ");
      return `${devices.length} device(s) connected: ${names}.`;
    }

    case "open_app": {
      const targets = resolveTargets(args.target);
      if (targets.length === 0) return "No matching connected device found.";
      await Promise.all(
        targets.map((d) => sendToDevice(d, { action: "open_app", app_name: args.app_name }))
      );
      return `Opening ${args.app_name} on ${targets.map((t) => t.name).join(", ")}.`;
    }

    case "open_url": {
      let url = args.url;
      // If the model passed a bare keyword instead of a URL, try the known-sites map.
      const key = (url || "").toLowerCase().replace(/^https?:\/\//, "");
      if (knownSites[url] ) url = knownSites[url];
      const targets = resolveTargets(args.target);
      if (targets.length === 0) return "No matching connected device found.";
      await Promise.all(targets.map((d) => sendToDevice(d, { action: "open_url", url })));
      return `Opening ${url} on ${targets.map((t) => t.name).join(", ")}.`;
    }

    case "wake_device": {
      const targets = resolveTargets(args.target);
      if (targets.length === 0) return "No matching connected device found.";
      await Promise.all(targets.map((d) => sendToDevice(d, { action: "wake_device" })));
      return `Waking ${targets.map((t) => t.name).join(", ")}. Note: this only wakes the screen — actual unlock relies on your device's own trusted-device auto-unlock being set up.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

// ---- Main command endpoint ----
app.post("/api/command", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: "transcript is required" });

  // Fast-path: try to match a common device-control command directly with
  // regex before involving the LLM at all. This is what makes things work
  // reliably even on a small model like llama3.2:3b - the model is only
  // needed for genuinely open-ended chat, not for "open notepad" style commands.
  const fastMatch = matchFallbackIntent(transcript);
  if (fastMatch) {
    const result = await executeTool(fastMatch.name, fastMatch.args);
    return res.json({ reply: result });
  }

  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are JARVIS, a personal voice assistant that controls the user's own devices. " +
              "If the user's message maps to one of the available tools, call it. " +
              "If it's a normal question, just answer directly in plain text, briefly.",
          },
          { role: "user", content: transcript },
        ],
        tools,
        stream: false,
      }),
    });

    if (!ollamaRes.ok) {
      const text = await ollamaRes.text();
      throw new Error(`Ollama error ${ollamaRes.status}: ${text}`);
    }

    const data = await ollamaRes.json();
    const message = data.message || {};

    if (message.tool_calls && message.tool_calls.length > 0) {
      const results = [];
      for (const call of message.tool_calls) {
        const fnName = call.function.name;
        const args = call.function.arguments || {};
        const result = await executeTool(fnName, args);
        results.push(result);
      }
      return res.json({ reply: results.join(" ") });
    }

    // No tool call -> plain chat answer.
    return res.json({ reply: message.content || "I didn't get that." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/devices", (req, res) => {
  res.json(registry.listDevices());
});

server.listen(PORT, () => {
  console.log(`JARVIS backend listening on http://localhost:${PORT}`);
  console.log(`Agent WebSocket endpoint: ws://localhost:${PORT}/agent-ws`);
});
