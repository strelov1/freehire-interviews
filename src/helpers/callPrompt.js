const path = require("node:path");

function createCallPrompt({ BrowserWindow, screen, onAccept }) {
  let current;
  let dismissTimer;

  function close() {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
    const win = current;
    current = undefined;
    if (win && !win.isDestroyed()) win.destroy();
  }

  async function show(title) {
    if (current) return;
    const { workArea } = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const width = 352;
    const height = 148;
    const win = new BrowserWindow({
      x: workArea.x + workArea.width - width - 20,
      y: workArea.y + workArea.height - height - 20,
      width,
      height,
      type: "panel",
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      focusable: false,
      show: false,
      hasShadow: false,
      webPreferences: {
        preload: path.join(__dirname, "callPromptPreload.js"),
        contextIsolation: true,
        sandbox: true,
      },
    });
    current = win;
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    for (const action of ["accept", "dismiss"]) {
      win.webContents.ipc.on("call-prompt-" + action, (event) => {
        if (current !== win || event.senderFrame !== win.webContents.mainFrame)
          return;
        close();
        if (action === "accept") onAccept(title);
      });
    }

    win.once("closed", () => {
      if (current === win) close();
    });
    try {
      await win.loadFile(path.join(__dirname, "callPrompt.html"), {
        query: { title },
      });
      if (current === win) {
        win.showInactive();
        dismissTimer = setTimeout(close, 16000);
      }
    } catch (error) {
      if (current === win) {
        close();
        throw error;
      }
    }
  }

  return { show, close };
}

module.exports = { createCallPrompt };
