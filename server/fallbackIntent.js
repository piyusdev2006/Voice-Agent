// fallbackIntent.js
// Small local models (like llama3.2:3b) don't always reliably emit a
// tool_call for simple, common commands. Rather than depend on the model
// for every device-control phrase, we match the obvious ones with regex
// first and only fall through to the LLM for anything more open-ended
// (general chat questions). This makes the assistant's core commands feel
// instant and near-100% reliable regardless of model size.
//
// Returns { name, args } if matched, otherwise null.

const { knownSites } = require("./tools");

function extractTarget(text) {
  if (/\ball devices?\b/i.test(text) || /\beveryone\b/i.test(text)) return "all";
  const m = text.match(/\bon (?:my |the )?([a-z0-9 ]+?)(?:\s*$|\s+and\b)/i);
  if (m) return m[1].trim();
  return "primary";
}

function matchFallbackIntent(transcript) {
  const text = transcript.trim().toLowerCase();

  // "how many devices are connected" / "what devices are online" / "list devices"
  if (/\b(how many|which|list)\b.*\bdevices?\b/.test(text) || /\bdevices? (are )?connected\b/.test(text)) {
    return { name: "list_devices", args: {} };
  }

  // "open <site>" where <site> is a known site keyword (youtube, gmail, etc.)
  for (const site of Object.keys(knownSites)) {
    const re = new RegExp(`\\bopen\\s+${site}\\b`, "i");
    if (re.test(text)) {
      return { name: "open_url", args: { url: knownSites[site], target: extractTarget(text) } };
    }
  }

  // "open <app>" for a generic app name - let the caller's whitelist decide if it's valid.
  const openAppMatch = text.match(/\bopen\s+([a-z0-9 ]+?)(?:\s+on\b|\s*$)/i);
  if (openAppMatch) {
    const appName = openAppMatch[1].trim();
    // Skip if it accidentally matched a known site (already handled above) or a phone/device word.
    if (!knownSites[appName] && !/^(all|primary|devices?)$/.test(appName)) {
      return { name: "open_app", args: { app_name: appName, target: extractTarget(text) } };
    }
  }

  // "wake up my pc" / "wake all devices"
  if (/\bwake\b/.test(text) && /\b(pc|laptop|phone|device|devices|screen)\b/.test(text)) {
    return { name: "wake_device", args: { target: extractTarget(text) } };
  }

  return null;
}

module.exports = { matchFallbackIntent };
