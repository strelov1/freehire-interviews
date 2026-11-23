import { useCallback, useEffect, useRef, useState } from "react";
import { startMicrophone } from "../microphone";

type Capture = {
  microphone?: Awaited<ReturnType<typeof startMicrophone>>;
  started: boolean;
  cancelled: boolean;
  finishing: boolean;
};

async function closeMicrophone(capture: Capture) {
  const cleanup = capture.microphone;
  capture.microphone = undefined;
  await cleanup?.();
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function useInterviewCapture() {
  const bridge = window.electronAPI;
  const current = useRef<Capture | null>(null);
  const mounted = useRef(false);
  const [phase, setPhase] = useState<"idle" | "starting" | "recording" | "saving">("idle");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [systemLevel, setSystemLevel] = useState(0);
  const [systemWarning, setSystemWarning] = useState("");
  const [captureError, setCaptureError] = useState("");
  const [now, setNow] = useState(Date.now);

  const reset = useCallback((capture: Capture) => {
    if (current.current !== capture) return;
    current.current = null;
    if (!mounted.current) return;
    setPhase("idle");
    setStartedAt(null);
    setMicLevel(0);
    setSystemLevel(0);
    setSystemWarning("");
  }, []);

  const saveCapture = useCallback(
    async (capture: Capture) => {
      capture.finishing = true;
      if (mounted.current) setPhase("saving");
      try {
        await closeMicrophone(capture);
      } catch (cause) {
        if (mounted.current) {
          setCaptureError(errorMessage(cause, "Could not close the microphone cleanly."));
        }
      }
      try {
        if (capture.started) {
          const result = await bridge.stopInterview();
          if (result.error !== undefined) throw new Error(result.error);
        }
      } catch (cause) {
        if (mounted.current) {
          setCaptureError(errorMessage(cause, "Could not finish the recording."));
        }
      } finally {
        reset(capture);
      }
    },
    [bridge, reset]
  );

  const start = useCallback(
    async (title: string) => {
      if (current.current) return;
      const capture: Capture = { started: false, cancelled: false, finishing: false };
      current.current = capture;
      setPhase("starting");
      setCaptureError("");
      try {
        capture.microphone = await startMicrophone(
          (chunk) => {
            if (capture.started) bridge.writeInterviewMic(chunk);
          },
          (level) => {
            if (capture.started && mounted.current) setMicLevel(level);
          }
        );
        if (current.current !== capture) {
          await closeMicrophone(capture);
          return;
        }
        if (!capture.cancelled) {
          const result = await bridge.startInterview(title);
          if (result.error !== undefined) throw new Error(result.error);
          // A main-process stop can arrive before the start response.
          if (current.current !== capture) return;
          capture.started = true;
          if (!capture.cancelled && mounted.current) {
            const { startedAt, systemAvailable } = result.data;
            setStartedAt(startedAt);
            setNow(Date.now());
            if (!systemAvailable) {
              setSystemWarning((warning) => warning || "Audio from the call may be missing.");
            }
            setPhase("recording");
            return;
          }
        }
      } catch (cause) {
        if (mounted.current && !capture.cancelled) {
          setCaptureError(errorMessage(cause, "Could not start recording."));
        }
      }
      if (current.current === capture) await saveCapture(capture);
    },
    [bridge, saveCapture]
  );

  const stop = useCallback(() => {
    const capture = current.current;
    if (!capture || capture.finishing) return;
    if (capture.started) {
      void saveCapture(capture);
    } else {
      capture.cancelled = true;
      setPhase("saving");
    }
  }, [saveCapture]);

  useEffect(() => {
    mounted.current = true;
    const cleanups = [
      bridge.freehireInterviews.onSystemLevel((level) => {
        if (current.current) setSystemLevel(level);
      }),
      bridge.onInterviewSystemWarning((message) => {
        if (current.current) setSystemWarning(message);
      }),
      bridge.onInterviewError(setCaptureError),
      bridge.onInterviewStopped(() => {
        const capture = current.current;
        if (!capture) return;
        capture.started = false;
        capture.cancelled = true;
        if (!capture.finishing) {
          void closeMicrophone(capture)
            .catch(() => {})
            .finally(() => reset(capture));
        }
      }),
    ];
    return () => {
      mounted.current = false;
      for (const cleanup of cleanups) cleanup();
      const capture = current.current;
      if (!capture) return;
      capture.cancelled = true;
      if (capture.started && !capture.finishing) void saveCapture(capture);
    };
  }, [bridge, reset, saveCapture]);

  useEffect(() => {
    if (phase !== "recording") return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [phase]);

  return {
    start,
    stop,
    startedAt,
    now,
    micLevel,
    systemLevel,
    systemWarning,
    captureError,
    isRecording: phase === "starting" || phase === "recording",
    finishing: phase === "saving",
  };
}
