// deviceRegistry.js
// Keeps track of connected device agents (PC, phone via Tasker bridge, etc.)
// Each device registers itself with a name + type when its WebSocket connects.

const devices = new Map(); // deviceId -> { ws, name, type, connectedAt }

function registerDevice(deviceId, ws, name, type) {
  devices.set(deviceId, { ws, name, type, connectedAt: new Date() });
  console.log(`[registry] device connected: ${name} (${type}) id=${deviceId}`);
}

function removeDevice(deviceId) {
  const d = devices.get(deviceId);
  if (d) {
    console.log(`[registry] device disconnected: ${d.name}`);
    devices.delete(deviceId);
  }
}

function listDevices() {
  return Array.from(devices.entries()).map(([id, d]) => ({
    id,
    name: d.name,
    type: d.type,
    connectedSince: d.connectedAt,
  }));
}

function getDevice(deviceId) {
  return devices.get(deviceId);
}

// Find devices by name (case-insensitive) or type. Used for "primary" vs "all".
function findDevices({ name, type } = {}) {
  return Array.from(devices.values()).filter((d) => {
    if (name && d.name.toLowerCase() !== name.toLowerCase()) return false;
    if (type && d.type !== type) return false;
    return true;
  });
}

function getAllDevices() {
  return Array.from(devices.values());
}

module.exports = {
  registerDevice,
  removeDevice,
  listDevices,
  getDevice,
  findDevices,
  getAllDevices,
};
