const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const {
  createRecording,
  listRecordings,
  pcmWave,
  readInterviewSegment,
  recoverRecordings,
} = require("../../src/helpers/freehireInterviewRecording");

test("keeps both channels on the same local recording timeline", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recording = createRecording(root, 1000);
  const samples = Buffer.alloc(2);
  samples.writeInt16LE(900);
  recording.write("mic", samples, 1000);
  recording.write("system", samples, 1001);
  assert.deepEqual(listRecordings(root), []);
  const saved = recording.finish();
  assert.equal(listRecordings(root)[0].id, saved.id);
  assert.equal(fs.readFileSync(path.join(root, saved.id, "mic.pcm")).readInt16LE(), 900);
  const system = fs.readFileSync(path.join(root, saved.id, "system.pcm"));
  assert.equal(system.readInt16LE(), 0);
  assert.equal(system.readInt16LE(48), 900);
});

test("wraps canonical inference PCM in a WAV header", () => {
  const wav = pcmWave(Buffer.from([1, 0, 2, 0]));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 4);
  assert.deepEqual(wav.subarray(44), Buffer.from([1, 0, 2, 0]));
});

test("mixes both tracks into segments that fit the Freehire upload limit", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const recording = createRecording(root, 1000);
  const samples = Buffer.alloc(6);
  for (let i = 0; i < samples.length; i += 2) samples.writeInt16LE(900, i);
  recording.write("mic", samples, 1000);
  recording.write("system", samples, 1000);
  recording.write("system", samples, 61000);
  const saved = recording.finish();
  const dir = path.join(root, saved.id);
  const first = readInterviewSegment(dir, 0, saved.durationSeconds);
  const second = readInterviewSegment(dir, 1, saved.durationSeconds);
  assert.equal(first.length, 44 + 60 * 32000);
  assert.equal(first.readInt16LE(44), 900);
  assert.equal(second.length, 48);
  assert.equal(second.readInt16LE(44), 450);
});

test("recovers audio and metadata after an interrupted recording", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-recovery-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const helper = require.resolve("../../src/helpers/freehireInterviewRecording");
  const child = spawnSync(
    process.execPath,
    ["-e", `
      const { createRecording } = require(process.argv[1]);
      createRecording(process.argv[2], 2000);
      const recording = createRecording(process.argv[2], 3000, "System design");
      recording.write("mic", Buffer.alloc(48000), 3000);
      recording.write("system", Buffer.alloc(48000), 3500);
    `, helper, root],
    { encoding: "utf8" }
  );
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(listRecordings(root), []);

  recoverRecordings(root);
  const [saved, ...others] = listRecordings(root);
  assert.equal(others.length, 0);
  assert.equal(saved.startedAt, 3000);
  assert.equal(saved.title, "System design");
  assert.equal(saved.durationSeconds, 1.5);
  assert.equal(fs.statSync(path.join(root, saved.id, "mic.pcm")).size, 48000);
  assert.equal(fs.statSync(path.join(root, saved.id, "system.pcm")).size, 72000);

  recoverRecordings(root);
  assert.deepEqual(listRecordings(root), [saved]);
});

test("skips a malformed manifest when listing completed recordings", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const broken = createRecording(root, 1000);
  broken.write("mic", Buffer.alloc(2), 1000);
  const brokenFile = path.join(root, broken.finish().id, "recording.json");
  fs.writeFileSync(brokenFile, "{");

  const working = createRecording(root, 2000);
  working.write("mic", Buffer.alloc(2), 2000);
  const saved = working.finish();
  assert.deepEqual(listRecordings(root), [saved]);
});
