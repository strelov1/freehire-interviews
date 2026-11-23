import { useCallback, useEffect, useRef, useState } from "react";
import FreehireInterviewSettings, { type Theme } from "./FreehireInterviewSettings";
import FreehireMark from "./FreehireMark";
import {
  ArrowLeft,
  AudioLines,
  Copy,
  ExternalLink,
  FileText,
  HardDrive,
  Mic,
  Monitor,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useInterviewCapture } from "./useInterviewCapture";
import type { FreehireRecording } from "../renderer-api";
import "../styles/freehire-interviews.css";

function elapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const name = (recording: FreehireRecording) => recording.title || "Interview";
type Interviews = NonNullable<typeof window.electronAPI.freehireInterviews>;
type Targets = NonNullable<Awaited<ReturnType<Interviews["targets"]>>["data"]>;

function AudioMeter({
  label,
  level,
  unavailable,
}: {
  label: string;
  level: number;
  unavailable?: boolean;
}) {
  const percent = unavailable ? 0 : Math.round(Math.min(1, Math.max(0, level * 5)) * 100);
  return (
    <div className="fh-channel">
      <span>
        {label === "Microphone" ? <Mic /> : <Monitor />}
        {label}
      </span>
      <meter aria-label={label + " level"} min={0} max={100} value={percent} />
      <small aria-hidden="true">
        {unavailable ? "Unavailable" : percent > 0 ? "Signal" : "Quiet"}
      </small>
    </div>
  );
}

function LiveCapture({
  starting,
  time,
  micLevel,
  systemLevel,
  systemWarning,
  onSettings,
}: {
  starting: boolean;
  time: string;
  micLevel: number;
  systemLevel: number;
  systemWarning: string;
  onSettings: () => void;
}) {
  return (
    <section className="fh-live" aria-labelledby="fh-live-title">
      <div className="fh-live-top">
        <div>
          <h1 id="fh-live-title" role="status">
            <i className="fh-record-dot" />
            {starting ? "Preparing to record…" : "Recording"}
          </h1>
          <p className="fh-muted">
            {starting
              ? "Allow audio access if your system asks."
              : "Audio is being recorded on this device."}
          </p>
        </div>
        {!starting && (
          <time className="fh-live-time" aria-label="Elapsed recording time">
            {time}
          </time>
        )}
      </div>
      {!starting && (
        <div className="fh-channels">
          <AudioMeter label="Microphone" level={micLevel} />
          <AudioMeter
            label="System audio"
            level={systemLevel}
            unavailable={Boolean(systemWarning) && !systemLevel}
          />
        </div>
      )}
      {systemWarning && (
        <div className="fh-live-warning">
          <p role="status">{systemWarning}</p>
          <button className="fh-button" onClick={onSettings}>
            Audio Access
          </button>
        </div>
      )}
    </section>
  );
}

export default function FreehireInterviewRecorder() {
  const bridge = window.electronAPI;
  const api = bridge.freehireInterviews;
  const mac = bridge.getPlatform() === "darwin";
  const capture = useInterviewCapture();
  const { start, stop, isRecording, startedAt, now, captureError, finishing } = capture;
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("theme");
    return saved === "dark" || saved === "light" ? saved : "auto";
  });
  const [promptsEnabled, setPromptsEnabled] = useState(
    () => localStorage.getItem("callPrompts") !== "false"
  );
  const [recordings, setRecordings] = useState<FreehireRecording[]>([]);
  const [id, setId] = useState("");
  const [compactDetail, setCompactDetail] = useState(false);
  const [search, setSearch] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [listing, setListing] = useState(true);
  const [listError, setListError] = useState("");
  const [listRevision, setListRevision] = useState(0);
  const [view, setView] = useState<"library" | "settings">("library");
  const [pane, setPane] = useState<"recording" | "appearance" | "account">("recording");
  const [drafts, setDrafts] = useState<
    Record<string, { text: string; saved?: boolean; edited?: boolean }>
  >({});
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [targets, setTargets] = useState<Targets>();
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lock = useRef(false);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const pendingSelection = useRef("");
  const searchInput = useRef<HTMLInputElement>(null);
  const detailTitle = useRef<HTMLHeadingElement>(null);
  const focusDestination = useRef<"detail" | "list" | null>(null);

  const recording = recordings.find((candidate) => candidate.id === id);
  const draft = drafts[id];
  const text = draft?.text ?? "";
  const filtered = recordings.filter((entry) =>
    `${name(entry)} ${date.format(entry.startedAt)}`
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase())
  );

  function select(next: string) {
    setId(next);
    setCompactDetail(Boolean(next));
    setPlaybackUrl("");
    setCopied(false);
    setTargets(undefined);
    setTarget("");
    setError("");
  }

  const beginRecording = useCallback(
    (title = "Interview") => {
      if (!signedIn || confirmDelete || lock.current) return;
      setError("");
      setPlaybackUrl("");
      setView("library");
      void start(title);
    },
    [confirmDelete, signedIn, start]
  );

  useEffect(
    () =>
      bridge.onShowSettings(() => {
        setPlaybackUrl("");
        setView("settings");
      }),
    [bridge]
  );

  useEffect(() => {
    const system = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "auto" && system.matches)
      );
    apply();
    localStorage.setItem("theme", theme);
    system.addEventListener("change", apply);
    return () => system.removeEventListener("change", apply);
  }, [theme]);

  useEffect(() => {
    let active = true;
    const preferred = localStorage.getItem("callPrompts") !== "false";
    void bridge
      .setCallPrompts(signedIn && preferred)
      .then((result) => {
        if (!result.success) throw new Error("Could not initialize call prompts.");
      })
      .catch(() => {
        if (active) setError("Could not initialize call prompts.");
      });
    return () => {
      active = false;
    };
  }, [bridge, signedIn]);

  async function changePrompts(enabled: boolean) {
    const result = await bridge.setCallPrompts(enabled);
    if (!result.success) throw new Error("Could not update call prompts. Try again.");
    localStorage.setItem("callPrompts", String(enabled));
    setPromptsEnabled(enabled);
  }

  useEffect(() => {
    const dialog = deleteDialog.current;
    if (!dialog) return;
    if (confirmDelete && !dialog.open) {
      dialog.showModal();
      cancelDelete.current?.focus();
    } else if (!confirmDelete && dialog.open) {
      dialog.close();
    }
  }, [confirmDelete]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const result = await api.session();
        if (!active) return;
        if (result.error !== undefined) setError(result.error);
        else setSignedIn(result.data);
      } catch {
        if (active) setError("Could not check your Freehire session. Try signing in again.");
      } finally {
        if (active) setCheckingSession(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!signedIn) return;
    let active = true;
    let revision = 0;
    const load = async (selected?: string) => {
      const request = ++revision;
      if (selected) pendingSelection.current = selected;
      try {
        const result = await api.list();
        if (!active || request !== revision) return;
        if (result.error !== undefined) throw new Error(result.error);
        setRecordings(result.data);
        setListError("");
        if (pendingSelection.current && !lock.current) {
          select(pendingSelection.current);
          pendingSelection.current = "";
        }
      } catch (cause) {
        if (active && request === revision)
          setListError(cause instanceof Error ? cause.message : "Could not load recordings.");
      } finally {
        if (active && request === revision) setListing(false);
      }
    };
    void load();
    const unsubscribeSaved = api.onSaved((selected) => void load(selected));
    return () => {
      active = false;
      unsubscribeSaved();
    };
  }, [api, signedIn, listRevision]);

  useEffect(() => {
    if (signedIn) return api.onRecordRequested(beginRecording);
  }, [api, beginRecording, signedIn]);

  useEffect(() => {
    if (view !== "library") return;
    if (focusDestination.current === "detail") detailTitle.current?.focus();
    if (focusDestination.current === "list") searchInput.current?.focus();
    focusDestination.current = null;
  }, [compactDetail, id, view]);

  async function run(label: string, operation: () => Promise<void>, checkSession = true) {
    if (lock.current) return;
    lock.current = true;
    setBusy(label);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The interview operation failed. Try again."
      );
      if (checkSession) {
        const session = await api.session().catch(() => undefined);
        if (session && session.error === undefined && !session.data) {
          setSignedIn(false);
          setTargets(undefined);
          setTarget("");
        }
      }
    } finally {
      lock.current = false;
      setBusy("");
      if (pendingSelection.current) {
        select(pendingSelection.current);
        pendingSelection.current = "";
      }
    }
  }

  function openAudioSettings() {
    setPlaybackUrl("");
    setPane("recording");
    setView("settings");
  }

  if (!signedIn && !isRecording && !finishing) {
    return (
      <div className="fh-shell fh-sign-in" data-translucent-titlebar={mac}>
        <div className="fh-titlebar" />
        <main className="fh-auth">
          <div className="fh-auth-content">
            <div className="fh-brand">
              <FreehireMark /> freehire
            </div>
            <h1>Sign in to record interviews</h1>
            <p>
              Use your Freehire account to record calls on this device and turn them into
              transcripts.
            </p>
            <button
              className="fh-button fh-primary"
              disabled={checkingSession || Boolean(busy)}
              onClick={() =>
                void run(
                  "Finish signing in in your browser…",
                  async () => {
                    const result = await api.signIn();
                    if (result.error !== undefined) throw new Error(result.error);
                    setListing(true);
                    setSignedIn(result.data);
                  },
                  false
                )
              }
            >
              Continue with Freehire <ExternalLink />
            </button>
            <div aria-live="polite" className="fh-auth-status">
              {checkingSession ? "Checking your session…" : busy}
              {error && (
                <p role="alert" className="fh-alert">
                  {error}
                </p>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  const time = elapsed(startedAt == null ? 0 : (now - startedAt) / 1000);
  const showError = error && !isRecording && !finishing;
  const compact = () => window.matchMedia("(max-width: 680px)").matches;

  return (
    <div className="fh-shell" data-translucent-titlebar={mac}>
      <header className="fh-titlebar">
        <div className="fh-capture-actions">
          <button
            className={`fh-button fh-capture-control ${isRecording ? "fh-danger" : "fh-primary"}`}
            data-mode={finishing ? "saving" : isRecording ? "recording" : "idle"}
            disabled={finishing || (!isRecording && (!signedIn || confirmDelete || Boolean(busy)))}
            aria-label={
              finishing
                ? "Finishing recording"
                : isRecording
                  ? startedAt == null
                    ? "Cancel Recording"
                    : "Stop Recording"
                  : "Record Interview"
            }
            title={!isRecording && !finishing ? "Record Interview" : undefined}
            onClick={() => (isRecording ? stop() : beginRecording())}
          >
            {finishing ? (
              <span role="status">Saving…</span>
            ) : isRecording ? (
              <>
                <i className="fh-stop-square" aria-hidden="true" />
                <span>{startedAt == null ? "Cancel" : "Stop"}</span>
              </>
            ) : (
              <span>Record Interview</span>
            )}
          </button>
        </div>
        <nav className="fh-nav" aria-label="Main navigation">
          <button
            aria-current={view === "library" ? "page" : undefined}
            onClick={() => setView("library")}
          >
            <AudioLines /> Recordings
          </button>
          <button
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => {
              setPlaybackUrl("");
              setView("settings");
            }}
          >
            <Settings /> Settings
          </button>
          {view === "settings" && isRecording && startedAt !== null && (
            <span className="fh-nav-live">
              <i className="fh-record-dot" /> Recording <time>{time}</time>
            </span>
          )}
        </nav>
      </header>
      {(showError || busy || captureError) && (
        <div className="fh-operation">
          {busy && (
            <p role="status" className="fh-muted">
              {busy}
            </p>
          )}
          {showError && (
            <p role="alert" className="fh-alert">
              {error}
            </p>
          )}
          {captureError && (
            <div className="fh-operation-row">
              <p role="alert" className="fh-alert">
                {captureError}
              </p>
              <button className="fh-button" onClick={openAudioSettings}>
                Audio Access
              </button>
            </div>
          )}
        </div>
      )}

      {view === "settings" ? (
        <FreehireInterviewSettings
          pane={pane}
          onPane={setPane}
          signOutDisabled={isRecording || finishing || Boolean(busy)}
          captureActive={isRecording || finishing}
          theme={theme}
          onTheme={setTheme}
          promptsEnabled={promptsEnabled}
          onPrompts={changePrompts}
          onSignOut={() =>
            void run(
              "Signing out…",
              async () => {
                const result = await api.signOut();
                if (result.error !== undefined) throw new Error(result.error);
                setSignedIn(result.data);
                setRecordings([]);
                setDrafts({});
                setSearch("");
                setView("library");
                pendingSelection.current = "";
                select("");
              },
              false
            )
          }
        />
      ) : (
        <div
          className="fh-workspace"
          data-detail={compactDetail || isRecording || finishing}
          data-empty={!listing && !listError && recordings.length === 0 && !search}
        >
          <aside className="fh-library" aria-label="Local recordings">
            <div className="fh-library-header">
              <h2>On This Device</h2>
              <div className="fh-search">
                <Search />
                <input
                  ref={searchInput}
                  type="search"
                  aria-label="Search recordings"
                  placeholder="Search recordings"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            {listing ? (
              <p className="fh-library-note" role="status">
                Loading recordings…
              </p>
            ) : listError ? (
              <div className="fh-library-note">
                <p role="alert" className="fh-alert">
                  {listError}
                </p>
                <button
                  className="fh-button"
                  onClick={() => {
                    setListing(true);
                    setListRevision((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <p className="fh-library-note">
                {search ? "No matching recordings." : "No recordings yet."}
              </p>
            ) : (
              <ul className="fh-recording-list">
                {filtered.map((entry) => (
                  <li key={entry.id}>
                    <button
                      aria-current={id === entry.id ? "true" : undefined}
                      disabled={Boolean(busy) || isRecording || finishing}
                      onClick={() => {
                        if (compact()) focusDestination.current = "detail";
                        select(entry.id);
                      }}
                    >
                      <span className="fh-row-icon">
                        <AudioLines />
                      </span>
                      <span className="fh-recording-label">
                        <strong>{name(entry)}</strong>
                        <small>{date.format(entry.startedAt)}</small>
                      </span>
                      <time>{elapsed(entry.durationSeconds)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <main className="fh-detail" aria-label="Recording details">
            <div className="fh-detail-content">
              {isRecording ? (
                <LiveCapture
                  starting={startedAt === null}
                  time={time}
                  micLevel={capture.micLevel}
                  systemLevel={capture.systemLevel}
                  systemWarning={capture.systemWarning}
                  onSettings={openAudioSettings}
                />
              ) : finishing ? (
                <p className="fh-muted" role="status">
                  Saving your recording on this device…
                </p>
              ) : recording ? (
                <>
                  <button
                    className="fh-button fh-back"
                    onClick={() => {
                      focusDestination.current = "list";
                      setCompactDetail(false);
                      setPlaybackUrl("");
                    }}
                  >
                    <ArrowLeft /> Recordings
                  </button>
                  <div className="fh-detail-heading">
                    <div>
                      <h1 ref={detailTitle} tabIndex={-1}>
                        {name(recording)}
                      </h1>
                      <p className="fh-muted">{date.format(recording.startedAt)}</p>
                    </div>
                    <button
                      ref={deleteButton}
                      className="fh-button fh-icon-button"
                      aria-label="Delete recording"
                      title="Delete recording"
                      disabled={Boolean(busy)}
                      onClick={() => setConfirmDelete(true)}
                    >
                      <Trash2 />
                    </button>
                  </div>

                  <section className="fh-player" aria-labelledby="fh-audio">
                    <AudioLines className="fh-player-icon" />
                    <div className="fh-player-content">
                      <h2 id="fh-audio">Interview Audio</h2>
                      {playbackUrl ? (
                        <audio
                          controls
                          autoPlay
                          aria-label="Interview audio"
                          src={playbackUrl}
                          onError={() => {
                            setPlaybackUrl("");
                            setError("Could not play this recording. Try again.");
                          }}
                        />
                      ) : (
                        <time className="fh-muted">{elapsed(recording.durationSeconds)}</time>
                      )}
                    </div>
                    {!playbackUrl && (
                      <button
                        className="fh-button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run("Preparing audio…", async () => {
                            const result = await api.play(id);
                            if (result.error !== undefined) throw new Error(result.error);
                            setPlaybackUrl(result.data);
                          })
                        }
                      >
                        <Play /> Play
                      </button>
                    )}
                  </section>

                  <section className="fh-detail-section" aria-labelledby="fh-transcript">
                    <h2 id="fh-transcript">
                      <FileText /> Transcript
                    </h2>
                    {draft ? (
                      <>
                        <label className="sr-only" htmlFor="fh-transcript-text">
                          Edit transcript
                        </label>
                        <textarea
                          id="fh-transcript-text"
                          rows={9}
                          value={text}
                          spellCheck
                          disabled={Boolean(busy)}
                          onChange={(event) => {
                            setCopied(false);
                            setDrafts((previous) => ({
                              ...previous,
                              [id]: { text: event.target.value, edited: true },
                            }));
                          }}
                        />
                        <p className="fh-muted">
                          {draft.edited
                            ? "Edits stay in this window until you save them to your tracker."
                            : "Review the transcript before sending it to your tracker."}
                        </p>
                        <div className="fh-operation-row">
                          <button
                            className="fh-button"
                            disabled={!text.trim() || Boolean(busy)}
                            onClick={() =>
                              void run(
                                "Copying transcript…",
                                async () => {
                                  await navigator.clipboard.writeText(text);
                                  setCopied(true);
                                },
                                false
                              )
                            }
                          >
                            <Copy /> Copy Transcript
                          </button>
                          {copied && (
                            <span role="status" className="fh-muted">
                              Copied to clipboard
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="fh-muted">
                          Freehire receives the audio when you request a transcript. You can review
                          and edit the result here.
                        </p>
                        <button
                          className="fh-button fh-primary"
                          disabled={Boolean(busy)}
                          onClick={() =>
                            void run("Transcribing audio…", async () => {
                              const result = await api.transcribe(id);
                              if (result.error !== undefined) throw new Error(result.error);
                              if (!result.data.trim())
                                throw new Error("No speech was detected in this recording.");
                              setDrafts((previous) => ({
                                ...previous,
                                [id]: { text: result.data },
                              }));
                            })
                          }
                        >
                          Generate Transcript
                        </button>
                      </>
                    )}
                  </section>

                  {draft && (
                    <section className="fh-detail-section" aria-labelledby="fh-tracker">
                      <h2 id="fh-tracker">
                        <ShieldCheck /> Private Tracker
                      </h2>
                      <p className="fh-muted">
                        Attach the transcript to an interview or application in your Freehire
                        tracker.
                      </p>
                      {!targets ? (
                        <button
                          className="fh-button"
                          disabled={!text.trim() || Boolean(busy)}
                          onClick={() =>
                            void run("Loading applications…", async () => {
                              const result = await api.targets(recording.startedAt);
                              if (result.error !== undefined) throw new Error(result.error);
                              setTargets(result.data);
                              const [only] = result.data.scheduled;
                              setTarget(
                                result.data.scheduled.length === 1 && only
                                  ? `interview:${only.id}`
                                  : ""
                              );
                            })
                          }
                        >
                          Find Applications
                        </button>
                      ) : targets.scheduled.length === 0 && targets.applications.length === 0 ? (
                        <p role="status" className="fh-muted">
                          No interviews or applications were found in your tracker.
                        </p>
                      ) : (
                        <div className="fh-target">
                          <label htmlFor="fh-target">Application or interview</label>
                          <select
                            id="fh-target"
                            value={target}
                            disabled={Boolean(busy)}
                            onChange={(event) => setTarget(event.target.value)}
                          >
                            <option value="">Choose a destination</option>
                            {targets.scheduled.length > 0 && (
                              <optgroup label="Scheduled interviews">
                                {targets.scheduled.map((item) => (
                                  <option key={item.id} value={`interview:${item.id}`}>
                                    {item.label} · {date.format(new Date(item.startsAt))}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {targets.applications.length > 0 && (
                              <optgroup label="Applications">
                                {targets.applications.map((item) => (
                                  <option key={item.id} value={`application:${item.id}`}>
                                    {item.label}
                                    {item.stage ? ` · ${item.stage}` : ""}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <button
                            className="fh-button"
                            disabled={!target || !text.trim() || Boolean(busy) || draft.saved}
                            onClick={() =>
                              void run("Saving to your tracker…", async () => {
                                const scheduled = targets.scheduled.find(
                                  (item) => target === `interview:${item.id}`
                                );
                                const ref =
                                  scheduled?.application ?? target.slice("application:".length);
                                const result = await api.save(id, ref, scheduled?.id, text);
                                if (result.error !== undefined)
                                  throw new Error(`Could not save the transcript. ${result.error}`);
                                if (typeof result.data?.id !== "number")
                                  throw new Error("Freehire did not confirm the save.");
                                setDrafts((previous) => ({
                                  ...previous,
                                  [id]: { text, saved: true },
                                }));
                              })
                            }
                          >
                            Save Transcript
                          </button>
                        </div>
                      )}
                      {draft.saved && (
                        <p role="status">Transcript saved to your private tracker.</p>
                      )}
                    </section>
                  )}
                </>
              ) : (
                <div className="fh-empty">
                  <div className="fh-empty-icon">
                    <AudioLines />
                  </div>
                  <h1>{recordings.length ? "Choose a recording" : "Record your next interview"}</h1>
                  <p className="fh-muted">
                    {recordings.length
                      ? "Select an interview to listen back and work on its transcript."
                      : "Play back the call and create a transcript when you need it."}
                  </p>
                  {!recordings.length && (
                    <span className="fh-local">
                      <HardDrive /> Audio stays on this device until you request a transcript.
                    </span>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      )}

      <dialog
        ref={deleteDialog}
        className="fh-dialog"
        aria-labelledby="fh-delete-heading"
        aria-describedby="fh-delete-description"
        onCancel={(event) => {
          event.preventDefault();
          setConfirmDelete(false);
        }}
        onClose={() => (deleteButton.current ?? searchInput.current)?.focus()}
      >
        <h2 id="fh-delete-heading">Delete this recording?</h2>
        <p id="fh-delete-description">
          This permanently removes the audio and its local transcript from this device. Any
          transcript previously saved to your tracker stays there.
        </p>
        <div className="fh-dialog-actions">
          <button className="fh-button" ref={cancelDelete} onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
          <button
            className="fh-button fh-danger"
            onClick={() => {
              setConfirmDelete(false);
              void run("Deleting recording…", async () => {
                const result = await api.delete(id);
                if (result.error !== undefined) throw new Error(result.error);
                setRecordings((rows) => rows.filter((row) => row.id !== id));
                setDrafts((previous) => {
                  const next = { ...previous };
                  delete next[id];
                  return next;
                });
                focusDestination.current = "list";
                select("");
              });
            }}
          >
            Delete Recording
          </button>
        </div>
      </dialog>
    </div>
  );
}
