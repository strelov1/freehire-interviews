const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const { createRecording, RECORDING_LIMIT_MS } = require("./freehireInterviewRecording");

const BYTES_PER_MS = 48; // 24 kHz mono, 16-bit PCM.
const START_TIMEOUT_MS = 3000;
const ACCESS_TIMEOUT_MS = 60000;
const STOP_TIMEOUT_MS = 2000;

function findAudioTap() {
  if (process.platform !== "darwin") return null;
  const [major, minor] = (process.getSystemVersion?.() || "14.2").split(".").map(Number);
  if (major < 14 || (major === 14 && minor < 2)) return null;
  const candidates = [path.join(__dirname, "../../resources/bin/macos-audio-tap")];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "bin/macos-audio-tap"));
  return candidates.find((filename) => fs.existsSync(filename)) ?? null;
}

function permissionFile() {
  return process.versions.electron
    ? path.join(require("electron").app.getPath("userData"), ".system-audio-permission")
    : null;
}

function readPermissionStatus() {
  try {
    const filename = permissionFile();
    if (filename) {
      const value = fs.readFileSync(filename, "utf8").trim();
      if (value === "granted" || value === "denied") return value;
    }
  } catch {
    // The preference may not exist on a fresh install.
  }
  return "unknown";
}

function launchTap(binary, timeoutMs, onPcm, onWarning, onFailure) {
  const child = spawn(binary, ["--sample-rate", "24000", "--chunk-ms", "100"], {
    stdio: ["pipe", onPcm ? "pipe" : "ignore", "pipe"],
  });
  child.stdin.on("error", () => {});
  child.stdout?.on("data", onPcm);
  let stopping = false;
  let stopTimer;
  let started = false;
  let settle;
  const ready = new Promise((resolve) => { settle = resolve; });
  const startupTimer = setTimeout(() => {
    finish("unknown", "System audio did not start. Check System Audio Recording permissions.");
    void stop();
  }, timeoutMs);
  const closed = new Promise((resolve) => child.once("close", () => {
    clearTimeout(stopTimer);
    if (!stopping && started) onFailure?.("System audio recording ended unexpectedly.");
    finish("unknown", "System audio recording could not start.");
    resolve();
  }));

  function finish(status, error) {
    if (!settle) return;
    clearTimeout(startupTimer);
    settle({ granted: status === "granted", status, ...(error && { error }) });
    settle = null;
  }

  function stop() {
    if (!stopping && child.exitCode === null && child.signalCode === null) {
      stopping = true;
      child.stdin.end();
      child.kill("SIGTERM");
      stopTimer = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
    }
    return closed;
  }

  child.on("error", (error) => finish("unknown", error.message));
  const output = readline.createInterface({ input: child.stderr });
  output.on("line", (line) => {
    if (stopping) return;
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event?.type === "start") {
      started = true;
      finish("granted");
    } else if (event?.type === "warning") {
      onWarning?.(event.message);
    } else if (event?.type === "error") {
      const status = event.code === "permission_denied" ? "denied" : "unknown";
      const message = event.message || "System audio recording could not start.";
      if (started) onFailure?.(message);
      finish(status, message);
      void stop();
    }
  });
  return { ready, stop };
}

function rms(pcm) {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const value = pcm.readInt16LE(i) / 32768;
    sum += value * value;
  }
  return Math.sqrt(sum / (pcm.length / 2));
}

function createCapture({
  getRoot, onLevel, onSaved, onError, onStarted, onStopped, onSystemWarning,
}, resolveBinary = findAudioTap) {
  let active = null;
  let stopping = null;
  let probe = null;
  let permission = readPermissionStatus();

  function rememberPermission(result) {
    if (result.status === permission || result.status === "unknown") return;
    permission = result.status;
    try {
      const filename = permissionFile();
      if (filename) fs.writeFileSync(filename, permission, { mode: 0o600 });
    } catch {
      // Capture can proceed even if the system audio preference cannot be saved.
    }
  }

  function checkSystemAudioAccess() {
    const status = resolveBinary() ? permission : "unsupported";
    return { granted: status === "granted", status };
  }

  async function requestSystemAudioAccess() {
    const binary = resolveBinary();
    if (!binary || active) return checkSystemAudioAccess();
    if (probe) return probe.result;
    const tap = launchTap(binary, ACCESS_TIMEOUT_MS);
    const result = tap.ready.then(async (access) => {
      rememberPermission(access);
      await tap.stop();
      return access;
    }).finally(() => { probe = null; });
    probe = { result, tap };
    return result;
  }

  function write(session, source, pcm) {
    if (active !== session || pcm.length === 0) return;
    const receivedAt = Date.now();
    // Timestamp the first sample in the packet, allowing each source to start independently.
    const capturedAt = Math.max(session.startedAt, receivedAt - pcm.length / BYTES_PER_MS);
    try {
      session.recording.write(source, pcm, capturedAt);
    } catch (error) {
      if (!session.failed) {
        session.failed = true;
        onError?.(error.message);
        void stop().catch(() => {});
      }
      return;
    }
    if (receivedAt - (session.lastLevelAt[source] ?? 0) >= 80) {
      session.lastLevelAt[source] = receivedAt;
      onLevel?.(source, rms(pcm));
    }
  }

  async function start(title = "") {
    if (active || stopping) throw new Error("A recording is already in progress.");
    if (probe) void probe.tap.stop();
    const startedAt = Date.now();
    const recording = createRecording(getRoot(), startedAt, typeof title === "string" ? title.slice(0, 200) : "");
    const session = { startedAt, recording, lastLevelAt: {}, tap: null, ending: false, failed: false };
    active = session;
    session.limit = setTimeout(() => { void stop().catch(() => {}); }, RECORDING_LIMIT_MS);
    const binary = resolveBinary();
    let systemAvailable = false;
    if (binary) {
      let oddByte = null;
      session.tap = launchTap(binary, START_TIMEOUT_MS, (data) => {
        const pcm = oddByte ? Buffer.concat([oddByte, data]) : data;
        oddByte = pcm.length % 2 ? pcm.subarray(-1) : null;
        write(session, "system", oddByte ? pcm.subarray(0, -1) : pcm);
      }, onSystemWarning, onSystemWarning);
      const access = await session.tap.ready;
      rememberPermission(access);
      systemAvailable = access.granted;
      if (!session.ending && access.error) onSystemWarning?.(access.error);
    } else {
      onSystemWarning?.("System audio capture requires macOS 14.2 or later and the native audio helper.");
    }
    if (active !== session || session.ending) throw new Error("Recording was stopped during startup.");
    onStarted?.(startedAt);
    return { startedAt, systemAvailable };
  }

  function writeMic(chunk) {
    if (!active || active.ending || !(chunk instanceof ArrayBuffer) ||
        chunk.byteLength > 65536 || chunk.byteLength % 2) return;
    write(active, "mic", Buffer.from(chunk));
  }

  function stop() {
    if (stopping) return stopping;
    if (!active) return probe ? probe.tap.stop().then(() => null) : Promise.resolve(null);
    const session = active;
    session.ending = true;
    clearTimeout(session.limit);
    stopping = Promise.resolve().then(async () => {
      // `close` guarantees that the native helper's final PCM has reached stdout.
      await session.tap?.stop();
      const recording = session.recording.finish();
      if (recording) onSaved?.(recording);
      return recording;
    }).catch((error) => {
      onError?.(error.message);
      throw error;
    }).finally(() => {
      active = null;
      stopping = null;
      onStopped?.();
    });
    return stopping;
  }

  return { start, stop, writeMic, isRecording: () => active !== null, checkSystemAudioAccess, requestSystemAudioAccess };
}

module.exports = { createCapture };
