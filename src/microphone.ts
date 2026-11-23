import workletUrl from "./microphoneWorklet.js?url&no-inline";

const PCM_SAMPLE_RATE = 24000;
const FLUSH_TIMEOUT_MS = 1000;

type MicrophoneChunk = { pcm: ArrayBuffer; rms: number };

export async function startMicrophone(
  onChunk: (chunk: ArrayBuffer) => void,
  onLevel?: (rms: number) => void,
): Promise<() => Promise<void>> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let worklet: AudioWorkletNode | undefined;
  let silence: GainNode | undefined;
  let cleanup: Promise<void> | undefined;
  let flushed: (() => void) | undefined;

  async function release() {
    for (const track of stream.getTracks()) track.stop();
    source?.disconnect();
    worklet?.disconnect();
    worklet?.port.close();
    silence?.disconnect();
    if (context && context.state !== "closed") await context.close();
  }

  try {
    // Web Audio resamples the capture device before the worklet sees its input.
    context = new AudioContext({ sampleRate: PCM_SAMPLE_RATE });
    await context.audioWorklet.addModule(workletUrl);
    source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "interview-pcm", {
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    worklet = node;
    silence = context.createGain();
    silence.gain.value = 0;
    node.port.onmessage = ({ data }: MessageEvent<MicrophoneChunk | "flushed">) => {
      if (data === "flushed") {
        flushed?.();
        return;
      }
      onChunk(data.pcm);
      onLevel?.(data.rms);
    };
    // Chromium needs a pulled graph. The muted path keeps the microphone inaudible.
    source.connect(node).connect(silence).connect(context.destination);
    await context.resume();
    return () => {
      cleanup ??= new Promise<void>((resolve) => {
        const timeout = window.setTimeout(resolve, FLUSH_TIMEOUT_MS);
        flushed = () => {
          window.clearTimeout(timeout);
          resolve();
        };
        node.port.postMessage("flush");
      }).finally(release);
      return cleanup;
    };
  } catch (error) {
    await release();
    throw error;
  }
}
