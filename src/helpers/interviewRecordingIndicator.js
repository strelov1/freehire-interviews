const path = require("node:path");
const { clampedBounds } = require("./windowBounds");

const width = 100;
const height = 34;
const edgeInset = 16;
const displayEvents = ["display-metrics-changed", "display-removed"];

class InterviewRecordingIndicator {
  constructor({ BrowserWindow, screen, onOpen = () => {} }) {
    this.BrowserWindow = BrowserWindow;
    this.screen = screen;
    this.onOpen = onOpen;
    this.window = null;
    this.ready = false;
    this.lastPosition = null;
  }

  async show(startedAt = Date.now()) {
    if (this.window) return;

    const fit = (position) => {
      const { workArea } = this.screen.getDisplayNearestPoint(
        position ?? this.screen.getCursorScreenPoint()
      );
      const { x, y } = position ?? {
        x: workArea.x + workArea.width - width - edgeInset,
        y: workArea.y + workArea.height - height - edgeInset,
      };
      return clampedBounds({ x, y, width, height }, workArea);
    };
    const win = new this.BrowserWindow({
      ...fit(this.lastPosition),
      frame: false,
      type: "panel",
      transparent: true,
      show: false,
      focusable: false,
      acceptFirstMouse: true,
      movable: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: false,
      title: "Freehire recording",
      webPreferences: {
        preload: path.join(__dirname, "interviewRecordingIndicatorPreload.js"),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    this.window = win;

    const refit = () => {
      const [currentX, currentY] = win.getPosition();
      const { x, y } = fit({ x: currentX, y: currentY });
      if (x !== currentX || y !== currentY) win.setPosition(x, y);
    };
    for (const event of displayEvents) this.screen.on(event, refit);
    win.once("closed", () => {
      for (const event of displayEvents) this.screen.removeListener(event, refit);
      if (this.window === win) {
        this.window = null;
        this.ready = false;
      }
    });
    win.webContents.ipc.on("interview-recording-open", () => {
      if (this.window === win && this.ready) this.onOpen();
    });
    win.webContents.once("render-process-gone", () => {
      if (this.window === win) this.hide();
    });

    try {
      win.setContentProtection(true);
      win.setAlwaysOnTop(true, "floating");
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      await win.loadFile(path.join(__dirname, "interviewRecordingIndicator.html"), {
        query: { startedAt: String(startedAt) },
      });
      if (this.window !== win) return;
      this.ready = true;
      win.showInactive();
    } catch (error) {
      if (this.window !== win) return;
      this.hide();
      throw error;
    }
  }

  updateLevel(level) {
    if (!this.ready || this.window.webContents.isDestroyed()) return;
    this.window.webContents.send("interview-recording-level", level);
  }

  hide() {
    const win = this.window;
    if (this.ready && win && !win.isDestroyed()) {
      const [x, y] = win.getPosition();
      this.lastPosition = { x, y };
    }
    this.window = null;
    this.ready = false;
    if (win && !win.isDestroyed()) win.destroy();
  }
}

module.exports = InterviewRecordingIndicator;
