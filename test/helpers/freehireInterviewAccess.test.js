const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const http = require("node:http");
const Module = require("node:module");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("Freehire sign-in unlocks recorder operations and signing out locks them again", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "freehire-access-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url.endsWith("/register")) {
      response.end(JSON.stringify({ client_id: "client" }));
    } else {
      response.end(JSON.stringify({ access_token: "fixture", expires_in: 600 }));
    }
  });
  t.after(() => server.close());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const oldOrigin = process.env.FREEHIRE_INTERVIEW_API_ORIGIN;
  process.env.FREEHIRE_INTERVIEW_API_ORIGIN = origin;
  t.after(() => {
    if (oldOrigin === undefined) delete process.env.FREEHIRE_INTERVIEW_API_ORIGIN;
    else process.env.FREEHIRE_INTERVIEW_API_ORIGIN = oldOrigin;
  });
  const load = Module._load;
  Module._load = function (request, ...args) {
    if (request === "electron")
      return { safeStorage: { isEncryptionAvailable: () => false }, protocol: { handle() {} } };
    return load.call(this, request, ...args);
  };
  let registerFreehireInterviews;
  try {
    ({ registerFreehireInterviews } = require("../../src/helpers/freehireInterviews"));
  } finally {
    Module._load = load;
  }
  const handlers = new Map();
  let callbackResponse;
  const isSignedIn = registerFreehireInterviews({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    app: { isPackaged: false, getPath: () => root },
    shell: {
      openExternal: async (url) => {
        const params = new URL(url).searchParams;
        const callback = new URL(params.get("redirect_uri"));
        callback.search = new URLSearchParams({ code: "code", state: params.get("state") });
        callbackResponse = fetch(callback);
      },
    },
    canUse: () => true,
    canSend: () => true,
    getRoot: () => root,
    onSignedIn() {},
  });
  const invoke = (name, ...params) => handlers.get("freehire-interviews:" + name)({}, ...params);
  assert.match((await invoke("list")).error, /Sign in/);
  assert.equal(isSignedIn(), false);
  assert.equal((await invoke("sign-in")).data, true);
  assert.equal((await callbackResponse).status, 200);
  assert.equal(isSignedIn(), true);
  assert.deepEqual((await invoke("list")).data, []);
  assert.equal((await invoke("sign-out")).data, false);
  assert.equal(isSignedIn(), false);
  assert.match((await invoke("list")).error, /Sign in/);
});
