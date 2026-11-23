const CHUNK_FRAMES = 2048;

class InterviewPcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new DataView(new ArrayBuffer(CHUNK_FRAMES * 2));
    this.frames = 0;
    this.sumSquares = 0;
    this.flushed = false;
    this.port.onmessage = ({ data }) => {
      if (data !== "flush") return;
      this.flushed = true;
      this.flushChunk();
      this.port.postMessage("flushed");
    };
  }

  flushChunk() {
    if (this.frames === 0) return;
    const pcm = this.frames === CHUNK_FRAMES
      ? this.chunk.buffer
      : this.chunk.buffer.slice(0, this.frames * 2);
    this.port.postMessage({ pcm, rms: Math.sqrt(this.sumSquares / this.frames) }, [pcm]);
    this.chunk = new DataView(new ArrayBuffer(CHUNK_FRAMES * 2));
    this.frames = 0;
    this.sumSquares = 0;
  }

  process(inputs) {
    const mono = inputs[0]?.[0];
    if (this.flushed || !mono) return true;
    for (const sample of mono) {
      const value = Math.max(-1, Math.min(1, sample));
      this.chunk.setInt16(this.frames * 2, Math.min(32767, Math.round(value * 32768)), true);
      this.frames++;
      this.sumSquares += value * value;
      if (this.frames === CHUNK_FRAMES) this.flushChunk();
    }
    return true;
  }
}

registerProcessor("interview-pcm", InterviewPcmProcessor);
