const path = require("node:path");
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  session,
  shell,
  systemPreferences,
  Tray,
} = require("electron");
const {
  registerFreehireInterviews,
} = require("./src/helpers/freehireInterviews");
const {
  recoverRecordings,
} = require("./src/helpers/freehireInterviewRecording");
const { playbackScheme } = require("./src/helpers/freehirePlayback");
const InterviewRecordingIndicator = require("./src/helpers/interviewRecordingIndicator");
const { createCapture } = require("./src/helpers/capture");
const { createCallDetection } = require("./src/helpers/callDetection");
const { createCallPrompt } = require("./src/helpers/callPrompt");

const name = "Freehire Interviews";
const mac = process.platform === "darwin";
const asset = (filename) => path.join(__dirname, "src/assets", filename);
const renderer = path.join(__dirname, "src/dist/index.html");
app.setName(name);
app.setPath(
  "userData",
  (!app.isPackaged && process.env.FREEHIRE_INTERVIEW_PROFILE) ||
    path.join(
      app.getPath("appData"),
      app.isPackaged ? name : name + "-development",
    ),
);
protocol.registerSchemesAsPrivileged([
  {
    scheme: playbackScheme,
    privileges: { standard: true, secure: true, stream: true },
  },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app
    .whenReady()
    .then(launch)
    .catch((error) => {
      console.error("Freehire Interviews could not start.", error);
      app.exit(1);
    });
}

function launch() {
  let panel;
  let tray;
  let quitting = false;
  let exitReady = false;
  let promptsEnabled = false;
  const root = path.join(app.getPath("userData"), "freehire-interviews");
  const canUse = (event) =>
    panel &&
    !panel.isDestroyed() &&
    event.sender === panel.webContents &&
    event.senderFrame === panel.webContents.mainFrame;
  const send = (channel, ...args) => {
    if (panel && !panel.isDestroyed()) panel.webContents.send(channel, ...args);
  };

  recoverRecordings(root);
  app.dock?.setIcon(asset("freehire-dock.png"));
  const indicator = new InterviewRecordingIndicator({
    BrowserWindow,
    screen,
    onOpen: showPanel,
  });
  const capture = createCapture({
    getRoot: () => root,
    onLevel(source, level) {
      if (source === "system") send("freehire-interview-system-level", level);
      indicator.updateLevel(level);
    },
    onSaved(recording) {
      send("freehire-interview-saved", recording.id);
    },
    onStarted(startedAt) {
      prompt.close();
      updateMenus();
      void indicator.show(startedAt).catch(() => {});
    },
    onStopped() {
      indicator.hide();
      send("freehire-interview-stopped");
      updateMenus();
    },
    onError(message) {
      send("freehire-interview-error", message);
    },
    onSystemWarning(message) {
      send("freehire-interview-system-warning", message);
    },
  });
  const signedIn = registerFreehireInterviews({
    ipcMain,
    app,
    shell,
    canUse,
    canSend: () => !quitting,
    getRoot: () => root,
    canSignOut: () => !capture.isRecording(),
    onSignedIn: showPanel,
    onSessionChanged() {
      if (!signedIn()) prompt.close();
      updateMenus();
    },
  });
  const canPrompt = () =>
    !quitting && promptsEnabled && signedIn() && !capture.isRecording();
  const prompt = createCallPrompt({
    BrowserWindow,
    screen,
    onAccept: requestRecording,
  });
  const callDetection = createCallDetection({
    canPrompt,
    onDetected(title) {
      if (canPrompt()) void prompt.show(title).catch(() => {});
    },
  });

  function showPanel() {
    if (!panel || panel.isDestroyed() || quitting) return;
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
  }

  function requestRecording(title = "Interview") {
    if (quitting || !signedIn() || capture.isRecording()) return;
    showPanel();
    send("freehire-interview-record-requested", title);
  }

  function openSettings() {
    showPanel();
    send("freehire-interview-settings");
  }

  function updateMenus() {
    const record = {
      label: "Record Interview",
      accelerator: "CommandOrControl+Shift+R",
      enabled: signedIn() && !capture.isRecording(),
      click: () => requestRecording(),
    };
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: name,
          submenu: [
            { role: "about" },
            {
              label: "Settings…",
              accelerator: "CommandOrControl+,",
              click: openSettings,
            },
            { type: "separator" },
            record,
            { type: "separator" },
            { role: "quit" },
          ],
        },
        { role: "editMenu" },
        { role: "windowMenu" },
      ]),
    );
    tray?.setTitle(capture.isRecording() ? "REC" : "");
    tray?.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Open Freehire Interviews", click: showPanel },
        { ...record, accelerator: undefined },
        { label: "Settings…", click: openSettings },
        { type: "separator" },
        { role: "quit" },
      ]),
    );
  }

  const microphoneStatus = () => {
    const status = mac
      ? systemPreferences.getMediaAccessStatus("microphone")
      : "unsupported";
    return { status, granted: status === "granted" };
  };

  const canUsePermission = (contents, details) =>
    contents === panel?.webContents &&
    details.isMainFrame &&
    (!details.requestingUrl ||
      details.requestingUrl === panel.webContents.getURL()) &&
    signedIn();
  // The local main frame needs microphone input and explicit transcript copy.
  // No other window has access to either of those permissions.
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      Boolean(
        canUsePermission(contents, details) &&
        (permission === "clipboard-sanitized-write" ||
          (permission === "media" && details.mediaType === "audio")),
      ),
  );
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        Boolean(
          canUsePermission(contents, details) &&
          (permission === "clipboard-sanitized-write" ||
            (permission === "media" &&
              details.mediaTypes?.length === 1 &&
              details.mediaTypes[0] === "audio")),
        ),
      ),
  );

  function handle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      if (canUse(event) && !quitting) return handler(...args);
      return { error: "This operation is unavailable." };
    });
  }

  function captureAction(action) {
    return async (...args) => {
      try {
        return { data: await action(...args) };
      } catch (error) {
        return { error: error?.message || "Could not record this interview." };
      }
    };
  }

  handle(
    "interview:start",
    captureAction((title) => {
      if (!signedIn())
        throw new Error("Sign in to Freehire to start recording.");
      return capture.start(
        typeof title === "string" ? title.trim().slice(0, 200) : "",
      );
    }),
  );
  handle(
    "interview:stop",
    captureAction(() => capture.stop()),
  );
  ipcMain.on("interview:mic", (event, audio) => {
    if (
      canUse(event) &&
      !quitting &&
      audio instanceof ArrayBuffer &&
      audio.byteLength <= 192000
    ) {
      capture.writeMic(audio);
    }
  });
  handle("interview:prompts", (enabled) => {
    promptsEnabled = enabled === true;
    if (!promptsEnabled) prompt.close();
    return { success: true };
  });
  handle("interview:mic-access", microphoneStatus);
  handle("interview:request-mic-access", async () => {
    if (mac && signedIn())
      await systemPreferences.askForMediaAccess("microphone");
    return microphoneStatus();
  });
  handle("interview:system-access", () => capture.checkSystemAudioAccess());
  handle("interview:request-system-access", () =>
    signedIn()
      ? capture.requestSystemAudioAccess()
      : { error: "Sign in to Freehire first." },
  );
  for (const [source, pane] of [
    ["mic", "Microphone"],
    ["system", "ScreenCapture"],
  ]) {
    handle("interview:open-" + source + "-settings", async () => {
      if (!mac) return { success: false };
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_" +
          pane,
      );
      return { success: true };
    });
  }

  panel = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 470,
    minHeight: 380,
    title: name,
    show: false,
    ...(mac && {
      frame: false,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 20, y: 20 },
      backgroundColor: "#00000000",
      transparent: true,
      vibrancy: "under-window",
    }),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      sandbox: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  panel.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  panel.webContents.on("will-navigate", (event) => event.preventDefault());
  panel.webContents.on("render-process-gone", (_event, details) => {
    void capture.stop().catch(() => {});
    if (!quitting && details.reason !== "clean-exit")
      void panel.loadFile(renderer).catch(console.error);
  });
  panel.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    panel.hide();
  });

  const trayIcon = nativeImage.createFromPath(asset("freehireTemplate@3x.png"));
  trayIcon.setTemplateImage(true);
  tray = new Tray(trayIcon);
  tray.setToolTip(name);
  updateMenus();

  app.on("activate", showPanel);
  app.on("second-instance", showPanel);
  app.on("before-quit", (event) => {
    if (exitReady) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    callDetection.stop();
    prompt.close();
    void Promise.resolve()
      .then(() => capture.stop())
      .catch((error) =>
        console.error("Could not finalize the interview.", error),
      )
      .finally(() => {
        indicator.hide();
        exitReady = true;
        app.quit();
      });
  });

  panel.once("ready-to-show", showPanel);
  void panel.loadFile(renderer).catch((error) => {
    console.error("Could not open Freehire Interviews.", error);
    app.quit();
  });
  callDetection.start();
}
