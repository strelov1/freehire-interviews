const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const vm = require("node:vm");

const { createCapture } = require("../../src/helpers/capture");
const { createCallDetection } = require("../../src/helpers/callDetection");
const { recordingDirectory } = require("../../src/helpers/freehireInterviewRecording");

function temporaryHelper(t, script) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "interviews-audio-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, "helper");
  fs.writeFileSync(binary, `#!${process.execPath}\n${script}`, { mode: 0o700 });
  return { root, binary };
}

test("stopping a recording saves PCM drained from the system helper", async (t) => {
  const { root, binary } = temporaryHelper(t, `
    process.on('SIGTERM', () => {
      process.stdout.write(Buffer.from([4, 5]), () => process.exit(0));
    });
    process.stdout.write(Buffer.from([1, 2]));
    process.stdout.write(Buffer.from([3]));
    process.stderr.write('{"type":"start"}\\n');
    setInterval(() => {}, 1000);
  `);
  const reports = [];
  const capture = createCapture({
    getRoot: () => root,
    onSaved: (recording) => reports.push(recording.id),
    onStopped: () => reports.push("stopped"),
  }, () => binary);
  t.after(() => capture.stop());
  assert.equal((await capture.start("Technical interview")).systemAvailable, true);
  capture.writeMic(Uint8Array.from([6, 7]).buffer);
  const [recording, duplicate] = await Promise.all([capture.stop(), capture.stop()]);
  assert.equal(recording, duplicate);
  assert.equal(recording.title, "Technical interview");
  assert.deepEqual(reports, [recording.id, "stopped"]);
  const systemPcm = fs.readFileSync(path.join(recordingDirectory(root, recording.id), "system.pcm"));
  assert.deepEqual([...systemPcm.subarray(-4)], [1, 2, 3, 4]);
});

test("denied system access leaves microphone-only recording available", async (t) => {
  const { root, binary } = temporaryHelper(t, `
    process.stderr.write('{"type":"error","code":"permission_denied","message":"Permission denied"}\\n');
    process.exitCode = 1;
  `);
  const warnings = [];
  const capture = createCapture({ getRoot: () => root, onSystemWarning: (text) => warnings.push(text) }, () => binary);
  t.after(() => capture.stop());
  assert.equal((await capture.start("")).systemAvailable, false);
  assert.equal(capture.checkSystemAudioAccess().status, "denied");
  assert.deepEqual(warnings, ["Permission denied"]);
  capture.writeMic(Uint8Array.from([1, 2]).buffer);
  assert.ok(await capture.stop());
});

test("call detection requires sustained PID-attributed use and prompts once", async (t) => {
  const { binary } = temporaryHelper(t, `
    console.log('CAPABILITY AGGREGATE');
    console.log('MIC_ACTIVE');
    console.log('MIC_START 98761 com.apple.FaceTime');
    console.log('CAPABILITY PID');
    console.log('MIC_START ${process.pid} us.zoom.xos');
    console.log('MIC_START 98762 com.apple.Safari');
    console.log('MIC_START 98762 com.apple.Safari');
    setTimeout(() => {
      console.log('MIC_START 98763 com.apple.Safari');
      console.log('MIC_STOP 98762');
    }, 2250);
    setInterval(() => {}, 1000);
  `);
  const results = [];
  const detector = createCallDetection({ canPrompt: () => true, onDetected: (title) => results.push(title) }, () => binary);
  t.after(() => detector.stop());
  detector.start();
  await delay(1000);
  assert.deepEqual(results, []);
  await delay(1600);
  assert.deepEqual(results, ["Safari interview"]);
});

test("microphone worklet transfers signed little-endian PCM and flushes its tail", () => {
  const messages = [];
  let Worklet;
  const source = fs.readFileSync(path.join(__dirname, "../../src/microphoneWorklet.js"), "utf8");
  vm.runInNewContext(source, {
    AudioWorkletProcessor: class { port = { postMessage: (message) => messages.push(message) }; },
    registerProcessor: (_name, implementation) => { Worklet = implementation; },
  });
  const processor = new Worklet();
  processor.process([[Float32Array.from([-1, 1, 0.5])]]);
  processor.port.onmessage({ data: "flush" });
  assert.deepEqual([...Buffer.from(messages[0].pcm)], [0, 128, 255, 127, 0, 64]);
  assert.equal(messages[1], "flushed");
});
