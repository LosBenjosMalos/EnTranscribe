const TARGET_SAMPLE_RATE = 16_000;

export type MeterSample = {
  level: number;
  elapsedMs: number;
};

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterFrame = 0;
  private startedAt = 0;
  private onMeter: ((sample: MeterSample) => void) | null = null;

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(onMeter: (sample: MeterSample) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is not available in this browser.");
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.chunks = [];
    this.onMeter = onMeter;
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.68;
    source.connect(this.analyser);

    const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    this.mediaRecorder = preferredType
      ? new MediaRecorder(this.stream, { mimeType: preferredType })
      : new MediaRecorder(this.stream);
    this.mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.startedAt = performance.now();
    this.mediaRecorder.start(250);
    this.readMeter();
  }

  async stop(): Promise<Float32Array> {
    const recorder = this.mediaRecorder;
    if (!recorder || recorder.state === "inactive") {
      throw new Error("No recording is active.");
    }

    const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
    recorder.stop();
    await stopped;
    cancelAnimationFrame(this.meterFrame);
    this.stream?.getTracks().forEach((track) => track.stop());

    const blob = new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" });
    const samples = await decodeAndResample(blob, this.audioContext ?? undefined);
    await this.audioContext?.close();
    this.reset();
    return samples;
  }

  cancel(): void {
    if (this.mediaRecorder?.state === "recording") this.mediaRecorder.stop();
    cancelAnimationFrame(this.meterFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.audioContext?.close();
    this.reset();
  }

  private reset(): void {
    this.stream = null;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.chunks = [];
    this.onMeter = null;
  }

  private readMeter = (): void => {
    if (!this.analyser || !this.onMeter || !this.isRecording) return;
    const data = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (const value of data) sum += value * value;
    const rms = Math.sqrt(sum / data.length);
    this.onMeter({
      level: Math.min(1, rms * 8),
      elapsedMs: performance.now() - this.startedAt,
    });
    this.meterFrame = requestAnimationFrame(this.readMeter);
  };
}

export async function decodeAndResample(blob: Blob, existingContext?: AudioContext): Promise<Float32Array> {
  const context = existingContext ?? new AudioContext();
  const encoded = await blob.arrayBuffer();
  const decoded = await context.decodeAudioData(encoded.slice(0));
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  const result = new Float32Array(rendered.getChannelData(0));
  if (!existingContext) await context.close();
  return result;
}

export async function loadSampleAudio(url: string): Promise<Float32Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the test audio (${response.status}).`);
  return decodeAndResample(await response.blob());
}
