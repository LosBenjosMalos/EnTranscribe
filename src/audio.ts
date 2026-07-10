const TARGET_SAMPLE_RATE = 16_000;

export type MeterSample = {
  level: number;
  elapsedMs: number;
};

export class AudioRecorder {
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private silentOutput: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meterFrame = 0;
  private startedAt = 0;
  private onMeter: ((sample: MeterSample) => void) | null = null;
  private recording = false;

  get isRecording(): boolean {
    return this.recording;
  }

  async start(onMeter: (sample: MeterSample) => void): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone recording is not available in this browser.");
    }

    try {
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
      await this.audioContext.resume();
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.68;
      this.source.connect(this.analyser);

      // Capture raw PCM instead of a MediaRecorder blob. Browser codec support
      // varies by OS and microphone (notably Continuity microphones on macOS),
      // while whisper.cpp ultimately needs uncompressed samples anyway.
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      this.processor.onaudioprocess = (event) => {
        if (!this.recording) return;
        this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      this.silentOutput = this.audioContext.createGain();
      this.silentOutput.gain.value = 0;
      this.source.connect(this.processor);
      this.processor.connect(this.silentOutput);
      this.silentOutput.connect(this.audioContext.destination);

      this.startedAt = performance.now();
      this.recording = true;
      this.readMeter();
    } catch (error) {
      this.cancel();
      throw error;
    }
  }

  async stop(): Promise<Float32Array> {
    if (!this.recording || !this.audioContext) {
      throw new Error("No recording is active.");
    }

    this.recording = false;
    cancelAnimationFrame(this.meterFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.disconnectNodes();

    const context = this.audioContext;
    const samples = mergePcmChunks(this.chunks);
    try {
      return await resamplePcm(samples, context.sampleRate);
    } finally {
      await context.close().catch(() => undefined);
      this.reset();
    }
  }

  cancel(): void {
    this.recording = false;
    cancelAnimationFrame(this.meterFrame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.disconnectNodes();
    void this.audioContext?.close();
    this.reset();
  }

  private disconnectNodes(): void {
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.processor?.disconnect();
    this.silentOutput?.disconnect();
  }

  private reset(): void {
    this.stream = null;
    this.source = null;
    this.processor = null;
    this.silentOutput = null;
    this.audioContext = null;
    this.analyser = null;
    this.chunks = [];
    this.onMeter = null;
    this.recording = false;
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

export function mergePcmChunks(chunks: readonly Float32Array[]): Float32Array {
  const sampleCount = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Float32Array(sampleCount);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function resamplePcm(samples: Float32Array, inputSampleRate: number): Promise<Float32Array> {
  if (samples.length === 0 || inputSampleRate === TARGET_SAMPLE_RATE) return new Float32Array(samples);
  const frameCount = Math.max(1, Math.ceil((samples.length * TARGET_SAMPLE_RATE) / inputSampleRate));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const buffer = offline.createBuffer(1, samples.length, inputSampleRate);
  const ownedSamples = new Float32Array(samples.length);
  ownedSamples.set(samples);
  buffer.copyToChannel(ownedSamples, 0);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
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
