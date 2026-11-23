const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const { Readable } = require("node:stream");

const playbackScheme = "freehire-audio";

function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end
    ? { start, end }
    : null;
}

function createPlayback(protocol, isSignedIn) {
  let selected;
  protocol.handle(playbackScheme, async (request) => {
    const recording = selected;
    if (!recording || request.url !== recording.url || !isSignedIn())
      return new Response(null, { status: 404 });
    if (request.method !== "GET" && request.method !== "HEAD")
      return new Response(null, { status: 405 });

    const stat = await fs.promises.stat(recording.file).catch(() => null);
    if (!stat?.isFile() || !stat.size || recording !== selected || !isSignedIn())
      return new Response(null, { status: 404 });
    const { size } = stat;
    const range = request.headers.get("range");
    const bytes = byteRange(range, size);
    if (!bytes) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const { start, end } = bytes;
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "Content-Type": "audio/wav",
      "Content-Length": String(end - start + 1),
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
    const body =
      request.method === "HEAD"
        ? null
        : Readable.toWeb(fs.createReadStream(recording.file, { start, end }));
    return new Response(body, { status: range ? 206 : 200, headers });
  });

  return {
    select(id, file) {
      if (selected?.id !== id)
        selected = { id, file, url: `${playbackScheme}://local/${randomUUID()}.wav` };
      return selected.url;
    },
    clear(id) {
      if (id === undefined || selected?.id === id) selected = undefined;
    },
  };
}

module.exports = { createPlayback, playbackScheme };
