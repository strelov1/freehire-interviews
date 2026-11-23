const { createHash } = require("node:crypto");
const { protocol, safeStorage } = require("electron");
const { createPlayback } = require("./freehirePlayback");
const { signIn } = require("./freehireOAuth");
const fs = require("node:fs");
const path = require("node:path");
const {
  createPlaybackWave,
  listRecordings,
  readInterviewSegment,
  readRecording,
  recordingDirectory,
  writeJSON,
  SEGMENT_SECONDS,
} = require("./freehireInterviewRecording");

function freehireOrigin(app) {
  const override = !app.isPackaged && process.env.FREEHIRE_INTERVIEW_API_ORIGIN;
  const url = new URL(override || "https://freehire.me");
  if (
    url.protocol !== "https:" &&
    !(
      override &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )
  ) {
    throw new Error("Freehire requires HTTPS");
  }
  return url.origin;
}

async function oauthRequest(origin, endpoint, body, signal) {
  const form = body instanceof URLSearchParams;
  const response = await fetch(origin + "/api/v1/oauth" + endpoint, {
    method: "POST",
    headers: { "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json" },
    body: form ? body : JSON.stringify(body),
    redirect: "error",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Freehire sign-in failed (HTTP ${response.status}).`);
  return response.json();
}

function applicationPath(ref) {
  if (typeof ref !== "string" || !ref || ref.length > 512)
    throw new Error("Choose an application.");
  return "/me/interviews/application/" + encodeURIComponent(ref);
}

function registerFreehireInterviews({
  ipcMain,
  app,
  shell,
  canUse,
  canSend,
  getRoot,
  onSignedIn,
  canSignOut = () => true,
  onSessionChanged = () => {},
}) {
  const origin = freehireOrigin(app);
  const originKey = createHash("sha256").update(origin).digest("hex").slice(0, 16);
  const sessionFile = () => path.join(app.getPath("userData"), `freehire-session-${originKey}.enc`);
  const encryptionAvailable = () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  let session;
  let verifiedSession;
  let verification;
  let login;

  function activeSession() {
    if (session === undefined) {
      session = null;
      try {
        if (encryptionAvailable()) {
          session = JSON.parse(safeStorage.decryptString(fs.readFileSync(sessionFile())));
        }
      } catch {
        // Missing or unreadable encrypted credentials require a new browser sign-in.
      }
    }
    return session?.expiresAt > Date.now() ? session : null;
  }

  function clearSession() {
    fs.rmSync(sessionFile(), { force: true });
    session = null;
    verifiedSession = undefined;
    playback.clear();
    onSessionChanged();
  }

  const isSignedIn = () => Boolean(verifiedSession && activeSession() === verifiedSession);
  const playback = createPlayback(protocol, isSignedIn);

  async function verifySession() {
    const credential = activeSession();
    if (!credential) return false;
    if (isSignedIn()) return true;
    if (!verification) {
      verification = request("/auth/me", { signal: AbortSignal.timeout(8000) })
        .then(() => {
          if (credential !== activeSession()) return false;
          verifiedSession = credential;
          onSessionChanged();
          return true;
        })
        .catch(() => {
          if (credential !== activeSession()) return false;
          throw new Error(
            "Could not verify your Freehire session. Check your connection and try again."
          );
        })
        .finally(() => {
          verification = null;
        });
    }
    return verification;
  }

  async function request(endpoint, options = {}) {
    const credential = activeSession();
    if (!credential) throw new Error("Sign in to Freehire to continue.");
    const response = await fetch(origin + "/api/v1" + endpoint, {
      ...options,
      redirect: "error",
      cache: "no-store",
      headers: { Authorization: "Bearer " + credential.token, ...options.headers },
      signal: options.signal ?? AbortSignal.timeout(125_000),
    });
    if (response.ok) return (await response.json()).data;
    if (response.status === 401 && session === credential) clearSession();
    const messages = {
      401: "Your Freehire session expired. Sign in again.",
      402: "Interview transcription requires a Freehire plan with AI access.",
      403: "Freehire denied access to this operation.",
      404: "This application or interview could not be found.",
      409: "This interview already has a transcript. Choose a new interview to keep both.",
      429: "Freehire’s transcription limit was reached. Try again later to resume.",
    };
    throw new Error(
      messages[response.status] || `Freehire request failed (HTTP ${response.status}).`
    );
  }

  const inUse = new Set();
  function handle(channel, action, { sends = false, allowSignedOut = false } = {}) {
    ipcMain.handle("freehire-interviews:" + channel, async (event, ...args) => {
      try {
        if (!canUse(event) || (sends && !canSend()))
          throw new Error("This operation is unavailable.");
        if (!allowSignedOut && !isSignedIn()) throw new Error("Sign in to Freehire to continue.");
        return { data: await action(...args) };
      } catch (error) {
        return { error: error?.message || "The interview operation failed." };
      }
    });
  }

  async function withRecording(id, operation) {
    if (inUse.has(id)) throw new Error("This recording is busy.");
    const dir = recordingDirectory(getRoot(), id);
    const metadata = readRecording(dir, id);
    if (!metadata) throw new Error("Recording not found.");
    inUse.add(id);
    try {
      return await operation(dir, metadata);
    } finally {
      inUse.delete(id);
    }
  }

  handle("session", verifySession, { allowSignedOut: true });
  handle(
    "sign-in",
    async () => {
      if (login) throw new Error("Finish the Freehire sign-in in your browser.");
      try {
        login = signIn(
          origin,
          (url) => shell.openExternal(url),
          (endpoint, body, signal) => oauthRequest(origin, endpoint, body, signal)
        );
        const signedIn = await login;
        if (encryptionAvailable()) {
          const filename = sessionFile();
          fs.writeFileSync(filename + ".tmp", safeStorage.encryptString(JSON.stringify(signedIn)), {
            mode: 0o600,
          });
          fs.renameSync(filename + ".tmp", filename);
        }
        session = signedIn;
        verifiedSession = signedIn;
        onSessionChanged();
        onSignedIn();
        return true;
      } finally {
        login = null;
      }
    },
    { sends: true, allowSignedOut: true }
  );
  handle(
    "sign-out",
    () => {
      if (login) throw new Error("Finish the Freehire sign-in in your browser.");
      if (!canSignOut()) throw new Error("Stop your recording before signing out.");
      clearSession();
      return false;
    },
    { allowSignedOut: true }
  );
  handle("list", () => listRecordings(getRoot()));
  handle("delete", (id) =>
    withRecording(id, (dir) => {
      playback.clear(id);
      fs.rmSync(dir, { recursive: true });
      return true;
    })
  );
  handle("play", (id) =>
    withRecording(id, async (dir) => {
      const output = path.join(dir, "playback.wav");
      if (!fs.existsSync(output)) await createPlaybackWave(dir, output);
      return playback.select(id, output);
    })
  );

  handle(
    "transcribe",
    (id) =>
      withRecording(id, async (dir, { durationSeconds }) => {
        if (!activeSession()) throw new Error("Sign in to Freehire to continue.");
        const total = Math.ceil(durationSeconds / SEGMENT_SECONDS);
        const cachePath = path.join(dir, "transcription.json");
        const chunks = fs.existsSync(cachePath)
          ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
          : [];
        for (let i = chunks.length; i < total; i++) {
          if (!canSend()) throw new Error("Freehire transcription is unavailable.");
          const audio = readInterviewSegment(dir, i, durationSeconds);
          const form = new FormData();
          form.set("file", new Blob([audio], { type: "audio/wav" }), "interview.wav");
          const result = await request("/me/interviews/transcriptions", {
            method: "POST",
            body: form,
          });
          chunks.push(result.text.trim());
          writeJSON(dir, "transcription.json", chunks);
        }
        return chunks.filter(Boolean).join("\n\n");
      }),
    { sends: true }
  );

  handle(
    "targets",
    async (startedAt) => {
      const from = new Date(startedAt - 2 * 60 * 60_000).toISOString();
      const to = new Date(startedAt + 2 * 60 * 60_000).toISOString();
      const [applications, scheduled] = await Promise.all([
        request("/me/tracking?filter=board&compact=1&limit=500"),
        request("/me/interviews?" + new URLSearchParams({ from, to })),
      ]);
      return {
        applications: applications
          .filter(({ id, stage, applied_at }) => stage || applied_at || /^a[0-9]+$/.test(id))
          .map(({ id, company_slug, role_title, stage }) => ({
            id,
            label: [role_title, company_slug].filter(Boolean).join(" · ") || id,
            stage,
          })),
        scheduled: scheduled
          .filter((interview) => interview.status !== "cancelled")
          .map((interview) => ({
            id: interview.id,
            application: interview.job_slug || "a" + interview.application_id,
            label:
              interview.title ||
              [interview.role_title, interview.company_slug].filter(Boolean).join(" · "),
            startsAt: interview.starts_at,
          })),
      };
    },
    { sends: true }
  );

  handle(
    "save",
    (id, ref, interviewId, transcript) =>
      withRecording(id, async (_dir, { startedAt }) => {
        return request(applicationPath(ref), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            interview_id: interviewId,
            recording_id: id,
            recorded_at: new Date(startedAt).toISOString(),
            transcript,
          }),
        });
      }),
    { sends: true }
  );
  return isSignedIn;
}

module.exports = { registerFreehireInterviews };
