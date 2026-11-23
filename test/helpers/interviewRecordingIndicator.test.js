const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const InterviewRecordingIndicator = require("../../src/helpers/interviewRecordingIndicator");

function fixture() {
  const windows = [];
  const opens = [];
  const screen = Object.assign(new EventEmitter(), {
    getCursorScreenPoint: () => ({ x: 900, y: 500 }),
    getDisplayNearestPoint: () => screen.displays[0],
    displays: [{ id: 2, workArea: { x: 800, y: 20, width: 1000, height: 760 } }],
  });
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.position = [options.x, options.y];
      this.webContents = Object.assign(new EventEmitter(), { ipc: new EventEmitter() });
      windows.push(this);
    }
    setIgnoreMouseEvents(value) {
      this.clickThrough = value;
    }
    setContentProtection() {}
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    setPosition(x, y) {
      this.position = [x, y];
    }
    getPosition() {
      return this.position;
    }
    loadFile() {
      return new Promise((resolve, reject) => {
        this.finishLoad = resolve;
        this.failLoad = reject;
      });
    }
    showInactive() {
      this.shown = true;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    isDestroyed() {
      return Boolean(this.destroyed);
    }
  }
  const indicator = new InterviewRecordingIndicator({
    BrowserWindow,
    screen,
    onOpen: () => opens.push("open"),
  });
  return { windows, screen, indicator, opens };
}

test("opens bottom-right and keeps the window on-screen when a display is removed", async () => {
  const { windows, screen, indicator } = fixture();
  const show = indicator.show();
  await indicator.show();
  const [win] = windows;
  assert.equal(windows.length, 1);
  assert.equal(win.options.focusable, false);
  assert.ok(win.options.width <= 100);
  assert.equal(win.options.movable, true);
  assert.equal(win.clickThrough, undefined);
  assert.equal(win.shown, undefined);
  win.finishLoad();
  await show;
  assert.equal(win.shown, true);
  assert.deepEqual(win.position, [1684, 730]);
  screen.displays = [{ id: 3, workArea: { x: 0, y: 30, width: 1200, height: 800 } }];
  screen.emit("display-removed");
  assert.deepEqual(win.position, [1100, 730]);
  indicator.hide();
  assert.equal(win.destroyed, true);
  assert.equal(screen.listenerCount("display-removed"), 0);
});

test("keeps the moved position for the next recording", async () => {
  const { windows, indicator } = fixture();
  const first = indicator.show();
  windows[0].finishLoad();
  await first;
  windows[0].setPosition(1100, 450);
  indicator.hide();

  const second = indicator.show();
  windows[1].finishLoad();
  await second;
  assert.deepEqual(windows[1].position, [1100, 450]);
  indicator.hide();
});

test("opens Freehire only from the active indicator", async () => {
  const { windows, indicator, opens } = fixture();
  const shown = indicator.show();
  const [win] = windows;
  win.webContents.ipc.emit("interview-recording-open");
  assert.equal(opens.length, 0);
  win.finishLoad();
  await shown;
  win.webContents.ipc.emit("interview-recording-open");
  assert.equal(opens.length, 1);
  indicator.hide();
  win.webContents.ipc.emit("interview-recording-open");
  assert.equal(opens.length, 1);
});

test("stopping during loading never reveals the old window or closes its replacement", async () => {
  const { windows, indicator } = fixture();
  const first = indicator.show();
  indicator.hide();
  const second = indicator.show();
  windows[0].failLoad(new Error("Load interrupted"));
  await first;
  windows[1].finishLoad();
  await second;
  assert.equal(windows[0].shown, undefined);
  assert.equal(windows[1].shown, true);
  indicator.hide();
});

test("cleans up a failed load so the next interview can show its own indicator", async () => {
  const { windows, screen, indicator } = fixture();
  const attempted = indicator.show();
  windows[0].failLoad(new Error("Missing indicator page"));
  await assert.rejects(attempted, /Missing indicator page/);
  assert.equal(windows[0].destroyed, true);
  assert.equal(screen.listenerCount("display-removed"), 0);
  const next = indicator.show();
  windows[1].finishLoad();
  await next;
  assert.equal(windows[1].shown, true);
  indicator.hide();
});
