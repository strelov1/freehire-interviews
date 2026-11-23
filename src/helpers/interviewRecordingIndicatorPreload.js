const { ipcRenderer } = require("electron");

window.addEventListener("DOMContentLoaded", () => {
  document.querySelector("button").addEventListener("click", () => {
    ipcRenderer.send("interview-recording-open");
  });
  const timer = document.querySelector("time");
  const startedAt = Number(new URLSearchParams(window.location.search).get("startedAt"));
  const bars = [...document.querySelectorAll(".wave > i")];
  const samples = bars.map(() => 0);
  let lastLevelAt = 0;
  const drawWave = () => {
    bars.forEach((bar, index) => {
      bar.style.setProperty("--scale", String(0.2 + samples[index] * 0.8));
    });
  };

  const updateTime = () => {
    const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    const minutes = String(Math.floor(seconds / 60)).padStart(2, "0");
    timer.textContent = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
    if (lastLevelAt && Date.now() - lastLevelAt > 500) {
      lastLevelAt = 0;
      samples.fill(0);
      drawWave();
    }
  };
  updateTime();
  setInterval(updateTime, 250);

  ipcRenderer.on("interview-recording-level", (_event, level) => {
    lastLevelAt = Date.now();
    samples.shift();
    samples.push(Math.max(0, Math.min(1, level * 6)));
    drawWave();
  });
});
