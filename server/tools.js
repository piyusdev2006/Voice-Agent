// tools.js
// Tool (function) definitions sent to Ollama so the model can turn a voice
// transcript into a structured action instead of just chatting.
// Format follows Ollama's /api/chat "tools" field (OpenAI-style function schema).

const tools = [
  {
    type: "function",
    function: {
      name: "list_devices",
      description:
        "List how many / which devices are currently connected to JARVIS. Use this when the user asks things like 'how many devices are connected' or 'what devices are online'.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "open_app",
      description:
        "Open an application on a target device (e.g. notepad, calculator, chrome).",
      parameters: {
        type: "object",
        properties: {
          app_name: {
            type: "string",
            description: "Name of the application to open, e.g. 'notepad', 'chrome', 'calculator'.",
          },
          target: {
            type: "string",
            description:
              "Which device(s) to run this on: 'primary' (the main/default device), 'all' (every connected device), or a specific device name.",
          },
        },
        required: ["app_name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_url",
      description:
        "Open a website/URL in the default browser on a target device. Use this for things like 'open youtube', 'open gmail'.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Full URL to open, e.g. https://youtube.com",
          },
          target: {
            type: "string",
            description:
              "Which device(s): 'primary', 'all', or a specific device name.",
          },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "wake_device",
      description:
        "Wake the screen / bring a device out of sleep on a target device. Does NOT bypass a PIN/biometric lock (not technically possible) - relies on the device's own trusted-device auto-unlock (Smart Lock / Dynamic Lock) being configured beforehand.",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "'primary', 'all', or a specific device name.",
          },
        },
        required: [],
      },
    },
  },
];

// Simple keyword -> URL map so "open youtube" doesn't need the model to know URLs.
const knownSites = {
  youtube: "https://youtube.com",
  gmail: "https://mail.google.com",
  whatsapp: "https://web.whatsapp.com",
  github: "https://github.com",
  google: "https://google.com",
};

module.exports = { tools, knownSites };
