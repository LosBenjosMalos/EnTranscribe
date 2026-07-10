import type { ModelDefinition } from "./models";

type BootstrapMessage = {
  type: "bootstrap";
  runtimeUrl: string;
};

type LoadModelMessage = {
  type: "load-model";
  model: ModelDefinition;
};

type TranscribeMessage = {
  type: "transcribe";
  requestId: string;
  audio: Float32Array;
  language: string;
  threads: number;
};

type WorkerRequest = BootstrapMessage | LoadModelMessage | TranscribeMessage;

export type WhisperWorkerEvent =
  | { type: "runtime-ready"; systemInfo: string }
  | { type: "model-progress"; stage: string; loaded: number; total: number }
  | { type: "model-ready"; modelId: string; cached: boolean; systemInfo: string }
  | { type: "result"; requestId: string; text: string; elapsedMs: number; audioSeconds: number; rtf: number }
  | { type: "error"; message: string; operation?: string };

export class WhisperClient {
  private readonly worker: Worker;
  private listeners = new Set<(event: WhisperWorkerEvent) => void>();
  private pendingResults = new Map<
    string,
    { resolve: (event: Extract<WhisperWorkerEvent, { type: "result" }>) => void; reject: (error: Error) => void }
  >();

  constructor(runtimeUrl: string) {
    this.worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (message: MessageEvent<WhisperWorkerEvent>) => {
      const event = message.data;
      if (event.type === "result") {
        const pending = this.pendingResults.get(event.requestId);
        if (pending) {
          pending.resolve(event);
          this.pendingResults.delete(event.requestId);
        }
      } else if (event.type === "error") {
        for (const pending of this.pendingResults.values()) pending.reject(new Error(event.message));
        this.pendingResults.clear();
      }
      for (const listener of this.listeners) listener(event);
    });
    this.post({ type: "bootstrap", runtimeUrl });
  }

  onEvent(listener: (event: WhisperWorkerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  loadModel(model: ModelDefinition): void {
    this.post({ type: "load-model", model });
  }

  transcribe(audio: Float32Array, language: string, threads: number): Promise<Extract<WhisperWorkerEvent, { type: "result" }>> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pendingResults.set(requestId, { resolve, reject });
      const message: TranscribeMessage = { type: "transcribe", requestId, audio, language, threads };
      this.worker.postMessage(message, [audio.buffer]);
    });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private post(message: WorkerRequest): void {
    this.worker.postMessage(message);
  }
}
