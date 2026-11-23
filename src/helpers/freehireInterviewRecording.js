const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const INPUT_RATE = 24000;
const OUTPUT_RATE = 16000;
const SEGMENT_SECONDS = 60;
const RECORDING_LIMIT_MS = 120 * 60 * 1000;
const MAX_INPUT_BYTES = (RECORDING_LIMIT_MS / 1000) * INPUT_RATE * 2;
const CHANNELS = ["mic", "system"];
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PENDING_MANIFEST = "recording.pending.json";
const MANIFEST = "recording.json";

function recordingDirectory(root, id) {
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("Invalid recording ID");
  return path.join(root, id);
}

function writeJSON(dir, name, value) {
  const filename = path.join(dir, name);
  fs.writeFileSync(filename + ".tmp", JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(filename + ".tmp", filename);
}

function createRecording(root, startedAt = Date.now(), title = "") {
  const id = crypto.randomUUID();
  const dir = recordingDirectory(root, id);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const metadata = { id, startedAt, title };
  writeJSON(dir, PENDING_MANIFEST, metadata);
  const channels = new Map();
  let closed = false;

  return {
    write(source, pcm, capturedAt) {
      if (closed || !CHANNELS.includes(source) || !pcm.length || pcm.length % 2 !== 0) return;
      let channel = channels.get(source);
      const clockOffset =
        Math.max(0, Math.round(((capturedAt - startedAt) * INPUT_RATE) / 1000)) * 2;
      if (clockOffset >= MAX_INPUT_BYTES) return;
      if (!channel) {
        channel = {
          fd: fs.openSync(path.join(dir, source + ".pcm"), "wx", 0o600),
          offset: clockOffset,
        };
        channels.set(source, channel);
      }
      // Ordinary delivery jitter should not introduce gaps. A source that was
      // absent for longer resumes at its wall-clock position in the recording.
      if (clockOffset - channel.offset > INPUT_RATE) channel.offset = clockOffset;
      const bytes = Math.min(pcm.length, MAX_INPUT_BYTES - channel.offset);
      if (bytes > 0) channel.offset += fs.writeSync(channel.fd, pcm, 0, bytes, channel.offset);
    },
    finish() {
      if (closed) return null;
      closed = true;
      for (const channel of channels.values()) fs.closeSync(channel.fd);
      const bytes = Math.max(0, ...Array.from(channels.values(), (channel) => channel.offset));
      if (!bytes) {
        fs.rmSync(dir, { recursive: true, force: true });
        return null;
      }
      return completeRecording(dir, metadata, bytes);
    },
  };
}

function completeRecording(dir, metadata, bytes) {
  const completed = { ...metadata, durationSeconds: bytes / (INPUT_RATE * 2) };
  writeJSON(dir, MANIFEST, completed);
  fs.rmSync(path.join(dir, PENDING_MANIFEST), { force: true });
  return completed;
}

function recordingEntries(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && UUID.test(entry.name)
  );
}

function readManifest(dir, id, filename) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8"));
    if (
      metadata?.id === id &&
      Number.isSafeInteger(metadata.startedAt) &&
      Math.abs(metadata.startedAt) <= 8.64e15 &&
      typeof metadata.title === "string"
    ) {
      return metadata;
    }
  } catch {
    // A missing or unreadable manifest only affects its own recording.
  }
  return null;
}

function recoverRecordings(root) {
  for (const { name: id } of recordingEntries(root)) {
    const dir = recordingDirectory(root, id);
    if (fs.existsSync(path.join(dir, MANIFEST))) continue;
    const metadata = readManifest(dir, id, PENDING_MANIFEST);
    if (!metadata) continue;
    try {
      let bytes = 0;
      for (const source of CHANNELS) {
        const filename = path.join(dir, source + ".pcm");
        const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
        if (!stat) continue;
        if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) {
          throw new Error("Invalid recording audio");
        }
        const alignedBytes = stat.size - (stat.size % 2);
        // A restart can find a partially written 16-bit sample.
        if (alignedBytes !== stat.size) fs.truncateSync(filename, alignedBytes);
        bytes = Math.max(bytes, alignedBytes);
      }
      if (bytes > 0) completeRecording(dir, metadata, bytes);
    } catch {
      // Leave the journal and audio in place if recovery cannot finish.
    }
  }
}

function readRecording(dir, id) {
  const metadata = readManifest(dir, id, MANIFEST);
  if (
    !metadata ||
    !Number.isFinite(metadata.durationSeconds) ||
    metadata.durationSeconds <= 0 ||
    metadata.durationSeconds > RECORDING_LIMIT_MS / 1000
  ) {
    return null;
  }
  return metadata;
}

function listRecordings(root) {
  return recordingEntries(root)
    .map(({ name: id }) => readRecording(recordingDirectory(root, id), id))
    .filter(Boolean)
    .sort((a, b) => b.startedAt - a.startedAt);
}

function waveHeader(size, rate) {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(size + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(size, 40);
  return header;
}

function pcmWave(pcm) {
  return Buffer.concat([waveHeader(pcm.length, OUTPUT_RATE), pcm]);
}

async function createPlaybackWave(dir, output) {
  const tracks = [];
  const temp = output + ".tmp";
  try {
    for (const source of CHANNELS) {
      const file = await fs.promises
        .open(path.join(dir, source + ".pcm"), "r")
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return null;
        });
      if (!file) continue;
      const track = { file, size: 0 };
      tracks.push(track);
      track.size = Math.min(MAX_INPUT_BYTES, (await file.stat()).size) & ~1;
    }
    const bytes = Math.max(0, ...tracks.map((track) => track.size));
    if (!bytes) throw new Error("This recording has no audio to play.");

    async function* wave() {
      yield waveHeader(bytes, INPUT_RATE);
      for (let offset = 0; offset < bytes; offset += 65536) {
        const size = Math.min(65536, bytes - offset);
        const chunks = await Promise.all(
          tracks.map(async ({ file, size: length }) => {
            const data = Buffer.alloc(
              Math.max(0, Math.min(size, length - offset)),
            );
            let read = 0;
            while (read < data.length) {
              const { bytesRead } = await file.read(
                data,
                read,
                data.length - read,
                offset + read,
              );
              if (!bytesRead) break;
              read += bytesRead;
            }
            return data.subarray(0, read & ~1);
          }),
        );
        const mixed = Buffer.alloc(size);
        for (let i = 0; i < size; i += 2) {
          let total = 0;
          let count = 0;
          for (const chunk of chunks) {
            if (i >= chunk.length) continue;
            total += chunk.readInt16LE(i);
            count++;
          }
          if (count) mixed.writeInt16LE(Math.round(total / count), i);
        }
        yield mixed;
      }
    }

    await pipeline(
      Readable.from(wave()),
      fs.createWriteStream(temp, { mode: 0o600 }),
    );
    await fs.promises.rename(temp, output);
  } finally {
    await Promise.allSettled(tracks.map(({ file }) => file.close()));
    await fs.promises.rm(temp, { force: true });
  }
}

function readChannel(dir, source, offset, size) {
  const filename = path.join(dir, source + ".pcm");
  if (!fs.existsSync(filename)) return null;
  const fd = fs.openSync(filename, "r");
  try {
    const buffer = Buffer.alloc(size);
    fs.readSync(fd, buffer, 0, size, offset);
    return buffer;
  } finally {
    fs.closeSync(fd);
  }
}

function readInterviewSegment(dir, index, durationSeconds) {
  const offset = index * SEGMENT_SECONDS * INPUT_RATE * 2;
  const samples = Math.min(
    SEGMENT_SECONDS * INPUT_RATE,
    Math.round(durationSeconds * INPUT_RATE) - offset / 2
  );
  const channels = CHANNELS.map((source) => readChannel(dir, source, offset, samples * 2)).filter(
    Boolean
  );
  const pcm = Buffer.alloc(Math.ceil((samples * 2) / 3) * 2);
  const sampleAt = (i) =>
    i >= samples
      ? 0
      : channels.reduce((sum, audio) => sum + audio.readInt16LE(i * 2), 0) / channels.length;
  // Average source samples over each 1.5-sample output interval.
  for (let input = 0, output = 0; input < samples; input += 3, output += 4) {
    const a = sampleAt(input);
    const b = sampleAt(input + 1);
    const c = sampleAt(input + 2);
    pcm.writeInt16LE(Math.round((2 * a + b) / 3), output);
    if (output + 2 < pcm.length) pcm.writeInt16LE(Math.round((b + 2 * c) / 3), output + 2);
  }
  return pcmWave(pcm);
}

module.exports = {
  createPlaybackWave,
  createRecording,
  listRecordings,
  pcmWave,
  readRecording,
  readInterviewSegment,
  recoverRecordings,
  recordingDirectory,
  writeJSON,
  RECORDING_LIMIT_MS,
  SEGMENT_SECONDS,
};
