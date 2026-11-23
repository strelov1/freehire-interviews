const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  const title = new URLSearchParams(location.search).get("title");
  if (title) document.querySelector("#source").textContent = title;
  for (const action of ["accept", "dismiss"]) {
    document.querySelector("#" + action).addEventListener("click", () => {
      ipcRenderer.send("call-prompt-" + action);
    });
  }
});
