# JARVIS — Implementation Notes

## What this is
A personal voice assistant: speak a command in the browser → local Ollama
model parses intent → backend dispatches the action to connected device
agents (currently: your PC). Fully local — no cloud LLM, no data leaving
your machine except calls to `localhost:11434` (Ollama).

## Architecture
```
Browser (public/index.html)
  - Web Speech API (STT) + SpeechSynthesis (TTS)
  - POSTs transcript to backend /api/command
        ↓
Backend (server/index.js)
  - Sends transcript + tool defs to Ollama (POST /api/chat)
  - If model returns a tool_call -> executes it (deviceRegistry lookup + dispatch)
  - If model returns plain text -> that's the chat answer
  - Hosts WebSocket at /agent-ws where device agents connect IN
        ↓
Device Agent (agent/agent.js)
  - Connects OUT to backend (no inbound firewall ports needed)
  - Registers with a name + shared secret token
  - Executes ONLY whitelisted actions (open_app from config.json, open_url, wake_device)
```

## Setup (in order)

### 1. Install Ollama + pull a tool-calling model
```
# Install from https://ollama.com if not already installed
ollama pull qwen2.5:7b
```
`qwen2.5`, `llama3.1`, `mistral-nemo`, and `hermes3` all support tool-calling
in Ollama. Start with `qwen2.5:7b` — good tool-use quality, runs on 8GB RAM.

### 2. Backend
```
cd server
cp .env.example .env
# edit .env: set AGENT_TOKEN to a random string, e.g.:
node -e "console.log(require('crypto').randomUUID())"
npm install
npm start
```
Runs on http://localhost:4000. Open that URL in Chrome/Edge for the mic UI.

### 3. PC Agent
```
cd agent
cp config.example.json config.json
# edit config.json: token MUST match server/.env AGENT_TOKEN exactly
npm install
npm start
```
Once connected, refresh the browser page — status line should show your
PC as a connected device.

### 4. Try it
Click the mic button and say:
- "How many devices are connected?"
- "Open notepad"
- "Open youtube"
- "Open youtube on all devices" (once you have more than one agent running)

## Adding more devices later
- **Phone (Android)**: don't write a custom app — use Tasker + AutoRemote
  (or MacroDroid's HTTP trigger). Have the backend's dispatch function send
  an HTTP request to Tasker's webhook instead of a WebSocket message, and
  register the phone in `deviceRegistry` the same way. This is a follow-up
  step, not built yet.
- **Smart home (lights/plugs)**: run Home Assistant, then add a tool
  (`control_smart_device`) in `server/tools.js` that calls Home Assistant's
  REST API instead of `sendToDevice`.

## Important limitation — "unlock devices"
True lock-screen bypass is not possible for any third-party app on Android
or Windows by OS design (that's the whole point of a lock screen). The
`wake_device` tool only wakes the display. To replicate the "auto-unlock"
effect from the demo you saw:
- **Android**: enable Smart Lock (Settings → Security → Smart Lock) and
  add your PC/watch as a trusted device, or trusted WiFi network.
- **Windows**: enable Dynamic Lock (Settings → Accounts → Sign-in options)
  paired with your phone's Bluetooth.
Once set up, the device just never locks while you're near it — no code
needed, and JARVIS doesn't need to "unlock" anything at all.

## Security notes (read before exposing this beyond localhost)
- `AGENT_TOKEN` is the only thing stopping a random device from registering
  and issuing commands to your PC — keep it secret, don't commit `.env` or
  `config.json`.
- The PC agent whitelist (`agent/config.json`) is intentionally the only
  thing the model can trigger — it never runs raw shell strings from the
  LLM output. Keep it that way; don't wire `open_app` to `exec(freeform_string)`.
- Everything currently binds to localhost. If you want phone control from
  outside your home WiFi, you'll need to either put the backend on a VPN
  (e.g. Tailscale) or add proper HTTPS + auth — don't port-forward this
  directly to the internet.

## Known gaps / next steps
- `open_app` whitelist is small (notepad, calculator, chrome, vscode) —
  add more entries in `agent/config.json` as needed.
- `wake_device` is a no-op on Windows by default — wire up a tool like
  `nircmd` if you want actual screen-wake behavior there.
- No conversation memory yet — each command is stateless. Add message
  history in `server/index.js` if you want follow-up questions to work.
