const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createPlayback } = require("../../src/helpers/freehirePlayback");

test("the in-app player can seek within the selected recording and requires a session", async (t) => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-playback-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const source = path.join(folder, "playback.wav");
  fs.writeFileSync(source, "0123456789");
  let signedIn = true;
  let handle;
  const player = createPlayback(
    {
      handle: (_scheme, handler) => {
        handle = handler;
      },
    },
    () => signedIn
  );
  const url = player.select("recording", source);
  const response = await handle(new Request(url, { headers: { Range: "bytes=2-5" } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(await response.text(), "2345");
  assert.equal((await handle(new Request(url, { headers: { Range: "bytes=10-" } }))).status, 416);
  signedIn = false;
  assert.equal((await handle(new Request(url))).status, 404);
  signedIn = true;
  player.clear("recording");
  assert.equal((await handle(new Request(url))).status, 404);
});
