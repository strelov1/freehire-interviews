import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Mic, Monitor, Settings2, Sun, UserCircle } from "lucide-react";

type Access = { granted: boolean; status: string };
export type Theme = "auto" | "light" | "dark";

type Pane = "recording" | "appearance" | "account";

function accessLabel(access: Access | null) {
  if (!access) return "Status unavailable";
  if (access.granted) return "Allowed";
  if (access.status === "denied" || access.status === "restricted") return "Access blocked";
  if (access.status === "unsupported") return "Unavailable";
  if (access.status === "not-determined") return "Permission needed";
  return "Permission unverified";
}

function Row({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="fh-setting-row">
      <div>
        <strong>{title}</strong>
        <div className="fh-muted">{children}</div>
      </div>
      {action}
    </div>
  );
}

export default function FreehireInterviewSettings({
  pane,
  onPane,
  onSignOut,
  signOutDisabled,
  captureActive,
  theme,
  onTheme,
  promptsEnabled,
  onPrompts,
}: {
  pane: Pane;
  onPane: (pane: Pane) => void;
  onSignOut: () => void;
  signOutDisabled: boolean;
  captureActive: boolean;
  theme: Theme;
  onTheme: (theme: Theme) => void;
  promptsEnabled: boolean;
  onPrompts: (enabled: boolean) => Promise<void>;
}) {
  const api = window.electronAPI;
  const [mic, setMic] = useState<Access | null>(null);
  const [system, setSystem] = useState<Access | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const mac = api.getPlatform() === "darwin";

  const checkPermissions = useCallback(async () => {
    const results = await Promise.allSettled([
      api.checkMicrophoneAccess(),
      api.checkSystemAudioAccess(),
    ]);
    setMic(results[0].status === "fulfilled" ? (results[0].value ?? null) : null);
    setSystem(results[1].status === "fulfilled" ? (results[1].value ?? null) : null);
    setRefreshing(false);
  }, [api]);

  useEffect(() => {
    if (pane !== "recording") return;
    const refresh = () => void checkPermissions();
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [pane, checkPermissions]);

  async function update(label: string, operation: () => Promise<void>) {
    setPending(label);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this setting.");
    } finally {
      setPending("");
    }
  }

  function changePrompts(enabled: boolean) {
    void update("Updating call prompts…", async () => {
      await onPrompts(enabled);
    });
  }

  function permissionAction(channel: "microphone" | "system") {
    void update("Checking access…", async () => {
      if (channel === "microphone" && mic?.status === "not-determined") {
        await api.requestMicrophoneAccess();
      } else if (channel === "system" && !captureActive) {
        const result = await api.requestSystemAudioAccess();
        if (result.error) throw new Error(result.error);
      } else {
        const result = await (channel === "microphone"
          ? api.openMicrophoneSettings()
          : api.openSystemAudioSettings());
        if (!result?.success) throw new Error("Could not open System Settings.");
      }
      await checkPermissions();
    });
  }

  return (
    <main className="fh-settings" id="fh-settings">
      <div className="fh-settings-panel">
        <h1 tabIndex={-1}>Settings</h1>
        <nav className="fh-segment" aria-label="Settings sections">
          <button
            aria-current={pane === "recording" ? "page" : undefined}
            onClick={() => onPane("recording")}
          >
            <Settings2 /> Recording
          </button>
          <button
            aria-current={pane === "appearance" ? "page" : undefined}
            onClick={() => onPane("appearance")}
          >
            <Sun /> Appearance
          </button>
          <button
            aria-current={pane === "account" ? "page" : undefined}
            onClick={() => onPane("account")}
          >
            <UserCircle /> Account
          </button>
        </nav>
        {pane === "recording" ? (
          <>
            <section aria-labelledby="fh-prompt-heading">
              <h2 id="fh-prompt-heading">During Calls</h2>
              <div className="fh-setting-group">
                <Row
                  title={<label htmlFor="fh-call-prompts">Call prompts</label>}
                  action={
                    <input
                      id="fh-call-prompts"
                      className="fh-switch"
                      type="checkbox"
                      role="switch"
                      checked={promptsEnabled}
                      disabled={Boolean(pending)}
                      onChange={(event) => changePrompts(event.target.checked)}
                    />
                  }
                >
                  Offer to record when a call is detected. Recording starts when you choose Record
                  Interview.
                </Row>
              </div>
            </section>
            <section aria-labelledby="fh-permissions-heading">
              <h2 id="fh-permissions-heading">Audio Access</h2>
              <div className="fh-setting-group">
                <Row
                  title={
                    <>
                      <Mic /> Microphone
                    </>
                  }
                  action={
                    mac && !mic?.granted && mic?.status !== "unsupported" && !refreshing ? (
                      <button
                        className="fh-button"
                        disabled={Boolean(pending)}
                        onClick={() => permissionAction("microphone")}
                      >
                        {mic?.status === "not-determined"
                          ? "Allow Microphone"
                          : "Open System Settings"}
                      </button>
                    ) : undefined
                  }
                >
                  {refreshing ? "Checking access…" : accessLabel(mic)}{" "}
                  <span aria-hidden="true">·</span> Records your voice
                </Row>
                <Row
                  title={
                    <>
                      <Monitor /> System audio
                    </>
                  }
                  action={
                    mac && !system?.granted && system?.status !== "unsupported" && !refreshing ? (
                      <button
                        className="fh-button"
                        disabled={Boolean(pending)}
                        onClick={() => permissionAction("system")}
                      >
                        {captureActive ? "Open System Settings" : "Check Access"}
                      </button>
                    ) : undefined
                  }
                >
                  {refreshing
                    ? "Checking access…"
                    : system
                      ? `Last check: ${accessLabel(system)}`
                      : accessLabel(system)}{" "}
                  <span aria-hidden="true">·</span> Records sound from the call
                </Row>
              </div>
              {mac && (
                <p className="fh-muted">
                  If macOS asks you to reopen the app, wait until your recording is saved.
                </p>
              )}
            </section>
          </>
        ) : pane === "appearance" ? (
          <section aria-labelledby="fh-appearance-heading">
            <h2 id="fh-appearance-heading">Appearance</h2>
            <div className="fh-setting-group">
              <Row
                title={<label htmlFor="fh-appearance-theme">Theme</label>}
                action={
                  <select
                    id="fh-appearance-theme"
                    value={theme}
                    onChange={({ currentTarget: { value } }) => {
                      if (value === "light" || value === "dark" || value === "auto") onTheme(value);
                    }}
                  >
                    <option value="auto">System</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                }
              >
                Choose a theme or follow your system appearance.
              </Row>
            </div>
          </section>
        ) : (
          <>
            <section aria-labelledby="fh-account-heading">
              <h2 id="fh-account-heading">Freehire Account</h2>
              <div className="fh-setting-group">
                <Row
                  title={
                    <>
                      <UserCircle /> Signed in to Freehire
                    </>
                  }
                  action={
                    <button className="fh-button" disabled={signOutDisabled} onClick={onSignOut}>
                      Sign Out
                    </button>
                  }
                >
                  {signOutDisabled
                    ? "Finish the current operation before signing out."
                    : "Signing out keeps your recordings on this Mac."}
                </Row>
              </div>
            </section>
            <section aria-labelledby="fh-data-heading">
              <h2 id="fh-data-heading">Recording Data</h2>
              <div className="fh-setting-group">
                <Row title="Audio files">
                  Stored on this device. Freehire receives the audio when you request a transcript.
                </Row>
                <Row title="Private tracker">
                  When you save to an application, Freehire receives the transcript and recording
                  details.
                </Row>
              </div>
            </section>
          </>
        )}
        {pending && (
          <p role="status" className="fh-muted">
            {pending}
          </p>
        )}
        {error && (
          <p role="alert" className="fh-alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
