const { createHash, randomBytes } = require("node:crypto");
const { once } = require("node:events");
const http = require("node:http");
const { sendOAuthPage } = require("./freehireOAuthPage");

const loginTimeout = 5 * 60 * 1000;

async function signIn(origin, openBrowser, call, signal = AbortSignal.timeout(loginTimeout)) {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  let redirect;
  let callback;
  let complete;
  const result = new Promise((resolve) => {
    complete = resolve;
  });

  const server = http.createServer({ requestTimeout: 5000 }, (req, res) => {
    const url = URL.parse(req.url, redirect);
    const code = url?.searchParams.get("code");
    const denied = url?.searchParams.has("error");
    if (
      req.method !== "GET" ||
      req.headers.host !== redirect.host ||
      url?.origin !== redirect.origin ||
      url.pathname !== "/callback" ||
      url.searchParams.get("state") !== state ||
      (!code && !denied)
    ) {
      sendOAuthPage(res, 400, "invalid");
      return;
    }
    if (callback) {
      sendOAuthPage(res, 409, "invalid");
      return;
    }
    callback = res;
    complete({ code, denied });
  });
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening", { signal });
    redirect = new URL(`http://127.0.0.1:${server.address().port}/callback`);
    const { client_id: clientId } = await call(
      "/register",
      {
        client_name: "Freehire Interviews",
        redirect_uris: [redirect.href],
      },
      signal
    );
    if (typeof clientId !== "string" || !clientId)
      throw new Error("Freehire returned an invalid client ID.");
    const authorize = new URL("/api/v1/oauth/authorize", origin);
    authorize.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirect.href,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();

    await openBrowser(authorize.href);
    const { code, denied } = signal.aborted
      ? { denied: true }
      : await new Promise((resolve, reject) => {
          const abort = () => reject(new Error("Freehire sign-in did not finish."));
          signal.addEventListener("abort", abort, { once: true });
          result.then((value) => {
            signal.removeEventListener("abort", abort);
            resolve(value);
          });
        });
    if (denied) {
      if (callback) sendOAuthPage(callback, 200, "declined");
      throw new Error("Freehire sign-in was cancelled.");
    }
    const token = await call(
      "/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: redirect.href,
        code_verifier: verifier,
      }),
      signal
    );
    if (
      typeof token.access_token !== "string" ||
      !token.access_token ||
      !Number.isSafeInteger(token.expires_in) ||
      token.expires_in <= 0
    ) {
      throw new Error("Freehire returned an invalid session.");
    }
    sendOAuthPage(callback, 200, "success");
    return { token: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 };
  } catch (error) {
    if (callback && !callback.writableEnded) sendOAuthPage(callback, 502, "failed");
    throw error;
  } finally {
    server.close();
  }
}

module.exports = { signIn };
