const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");

const SUSTAINED_MS = 2000;
const LISTENER_RETRY_MS = 10000;
const STOP_TIMEOUT_MS = 2000;
const CALL_APPS = new Map([
  ["us.zoom.xos", "Zoom"],
  ["com.microsoft.teams", "Microsoft Teams"],
  ["com.microsoft.teams2", "Microsoft Teams"],
  ["com.cisco.webexmeetingsapp", "Webex"],
  ["com.apple.facetime", "FaceTime"],
  ["com.apple.avconferenced", "FaceTime"],
  ["com.apple.safari", "Safari"],
  ["com.apple.webkit.gpu", "Safari"],
  ["com.google.chrome", "Chrome"],
  ["com.microsoft.edgemac", "Microsoft Edge"],
  ["org.mozilla.firefox", "Firefox"],
  ["com.brave.browser", "Brave"],
  ["company.thebrowser.browser", "Arc"],
  ["com.tinyspeck.slackmacgap", "Slack"],
  ["com.hnc.discord", "Discord"],
]);

function findListener() {
  if (process.platform !== "darwin") return null;
  const candidates = [path.join(__dirname, "../../resources/bin/macos-mic-listener")];
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "bin/macos-mic-listener"));
  return candidates.find((filename) => fs.existsSync(filename)) ?? null;
}

function callApp(bundle) {
  for (const [prefix, label] of CALL_APPS) {
    if (bundle === prefix || bundle.startsWith(`${prefix}.`)) return label;
  }
  return null;
}

function isOwnProcess(pid) {
  if (pid === process.pid) return true;
  if (!process.versions.electron) return false;
  const { app } = require("electron");
  return app.getAppMetrics().some((metric) => metric.pid === pid);
}

function createCallDetection({ canPrompt, onDetected }, resolveBinary = findListener) {
  let child = null;
  let running = false;
  let retry = null;
  let timer = null;
  let pidMode = false;
  let prompted = false;
  const captures = new Map();

  function reset() {
    clearTimeout(timer);
    timer = null;
    prompted = false;
    captures.clear();
  }

  function arm() {
    if (!captures.size || prompted || timer) return;
    timer = setTimeout(() => {
      timer = null;
      const label = captures.values().next().value;
      if (!label || !running) return;
      // A call already active during recording should not prompt after it is saved.
      prompted = true;
      if (canPrompt()) onDetected(`${label} interview`);
    }, SUSTAINED_MS);
  }

  function listen(binary) {
    const listener = spawn(binary, [], { stdio: ["pipe", "pipe", "ignore"] });
    child = listener;
    listener.stdin.on("error", () => {});
    listener.on("error", () => {});
    listener.on("close", () => {
      if (child !== listener) return;
      child = null;
      pidMode = false;
      reset();
      if (running) retry = setTimeout(() => listen(binary), LISTENER_RETRY_MS);
    });
    const output = readline.createInterface({ input: listener.stdout });
    output.on("line", (line) => {
      if (child !== listener) return;
      if (line === "CAPABILITY PID" || line === "CAPABILITY AGGREGATE") {
        pidMode = line === "CAPABILITY PID";
        reset();
        return;
      }
      if (!pidMode) return;
      const [event, rawPid, bundle = ""] = line.split(" ", 3);
      const pid = Number(rawPid);
      if (!Number.isSafeInteger(pid) || pid <= 0 || pid === listener.pid) return;
      if (event === "MIC_START") {
        const label = callApp(bundle.toLowerCase());
        if (label && !isOwnProcess(pid)) captures.set(pid, label);
        arm();
      } else if (event === "MIC_STOP" && captures.delete(pid) && !captures.size) {
        reset();
      }
    });
  }

  function start() {
    if (running) return;
    const binary = resolveBinary();
    if (!binary) return;
    running = true;
    listen(binary);
  }

  function stop() {
    running = false;
    clearTimeout(retry);
    retry = null;
    pidMode = false;
    reset();
    const listener = child;
    child = null;
    if (listener && listener.exitCode === null && listener.signalCode === null) {
      listener.stdin.end();
      listener.kill("SIGTERM");
      const timeout = setTimeout(() => listener.kill("SIGKILL"), STOP_TIMEOUT_MS);
      listener.once("close", () => clearTimeout(timeout));
    }
  }

  return { start, stop };
}

module.exports = { createCallDetection };
