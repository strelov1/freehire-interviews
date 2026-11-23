const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { signIn } = require("../../src/helpers/freehireOAuth");

test("registers a loopback client and exchanges only the callback with matching state", async () => {
  let authorization;
  let callbackResponse;
  const requests = [];
  const call = async (endpoint, body) => {
    requests.push(endpoint);
    if (endpoint === "/register") {
      assert.equal(body.client_name, "Freehire Interviews");
      assert.match(body.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/);
      return { client_id: "fixture-client" };
    }
    assert.equal(body.get("code"), "fixture-code");
    assert.equal(body.get("redirect_uri"), authorization.get("redirect_uri"));
    assert.equal(
      createHash("sha256").update(body.get("code_verifier")).digest("base64url"),
      authorization.get("code_challenge")
    );
    return { access_token: "fixture-token", expires_in: 1800 };
  };
  const result = await signIn(
    "https://freehire.test",
    async (url) => {
      authorization = new URL(url).searchParams;
      const callback = new URL(authorization.get("redirect_uri"));
      callback.searchParams.set("code", "unsolicited-code");
      callback.searchParams.set("state", "wrong-state");
      assert.equal((await fetch(callback)).status, 400);
      callback.searchParams.set("state", authorization.get("state"));
      callback.searchParams.set("code", "fixture-code");
      callbackResponse = fetch(callback);
    },
    call
  );
  const response = await callbackResponse;
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const page = await response.text();
  assert.match(page, /You're signed in/);
  assert.match(page, /You can close this tab/);
  assert.doesNotMatch(page, /<button|window\.close/);
  assert.doesNotMatch(page, /fixture-code|fixture-token/);
  assert.equal(result.token, "fixture-token");
  assert.ok(result.expiresAt > Date.now());
  assert.deepEqual(requests, ["/register", "/token"]);
});

test("a failed token exchange shows a retry page instead of confirming sign-in", async () => {
  let callbackResponse;
  await assert.rejects(
    signIn(
      "https://freehire.test",
      (url) => {
        const params = new URL(url).searchParams;
        const callback = new URL(params.get("redirect_uri"));
        callback.search = new URLSearchParams({ state: params.get("state"), code: "fixture" });
        callbackResponse = fetch(callback);
      },
      async (endpoint) => {
        if (endpoint === "/register") return { client_id: "fixture-client" };
        throw new Error("The token exchange failed.");
      }
    ),
    /token exchange failed/
  );
  const response = await callbackResponse;
  assert.equal(response.status, 502);
  assert.match(await response.text(), /Sign-in couldn’t finish/);
});
