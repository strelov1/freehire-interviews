const { contextBridge, ipcRenderer } = require("electron");

const invoke =
  (channel) =>
  (...args) =>
    ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const listener = (_event, ...args) => callback(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld("electronAPI", {
  getPlatform: () => process.platform,
  startInterview: invoke("interview:start"),
  stopInterview: invoke("interview:stop"),
  writeInterviewMic: (audio) => ipcRenderer.send("interview:mic", audio),
  setCallPrompts: invoke("interview:prompts"),
  onShowSettings: listen("freehire-interview-settings"),
  onInterviewError: listen("freehire-interview-error"),
  onInterviewStopped: listen("freehire-interview-stopped"),
  onInterviewSystemWarning: listen("freehire-interview-system-warning"),
  checkMicrophoneAccess: invoke("interview:mic-access"),
  requestMicrophoneAccess: invoke("interview:request-mic-access"),
  checkSystemAudioAccess: invoke("interview:system-access"),
  requestSystemAudioAccess: invoke("interview:request-system-access"),
  openMicrophoneSettings: invoke("interview:open-mic-settings"),
  openSystemAudioSettings: invoke("interview:open-system-settings"),
  freehireInterviews: {
    session: invoke("freehire-interviews:session"),
    signIn: invoke("freehire-interviews:sign-in"),
    signOut: invoke("freehire-interviews:sign-out"),
    list: invoke("freehire-interviews:list"),
    play: invoke("freehire-interviews:play"),
    delete: invoke("freehire-interviews:delete"),
    transcribe: invoke("freehire-interviews:transcribe"),
    targets: invoke("freehire-interviews:targets"),
    save: invoke("freehire-interviews:save"),
    onSystemLevel: listen("freehire-interview-system-level"),
    onSaved: listen("freehire-interview-saved"),
    onRecordRequested: listen("freehire-interview-record-requested"),
  },
});
