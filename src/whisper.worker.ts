/// <reference lib="webworker" />

import type { ModelDefinition } from "./models";

declare const self: DedicatedWorkerGlobalScope;

type EmscriptenModule = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
    unlink(path: string): void;
  };
  load_model(path: string): number;
  unload_model(): void;
  transcribe(audio: Float32Array, language: string, threads: number): string;
  system_info(): string;
};

type WorkerMessage =
  | { type: "bootstrap"; runtimeUrl: string }
  | { type: "load-model"; model: ModelDefinition }
  | { type: "transcribe"; requestId: string; audio: Float32Array; language: string; threads: number };

const MODEL_CACHE = "entranscribe-models-v1";
let modulePromise: Promise<EmscriptenModule> | null = null;
let moduleInstance: EmscriptenModule | null = null;
let loadedModelPath: string | null = null;

self.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
  void handleMessage(event.data);
});

async function handleMessage(message: WorkerMessage): Promise<void> {
  try {
    if (message.type === "bootstrap") {
      modulePromise = initializeRuntime(message.runtimeUrl);
      moduleInstance = await modulePromise;
      post({ type: "runtime-ready", systemInfo: moduleInstance.system_info() });
      return;
    }

    const module = moduleInstance ?? (await modulePromise);
    if (!module) throw new Error("The local transcription runtime has not started.");

    if (message.type === "load-model") {
      await loadModel(module, message.model);
      return;
    }

    if (message.type === "transcribe") {
      if (!loadedModelPath) throw new Error("Prepare a local model before transcribing.");
      const started = performance.now();
      const audioSeconds = message.audio.length / 16_000;
      const text = module.transcribe(message.audio, message.language, message.threads);
      const elapsedMs = performance.now() - started;
      post({
        type: "result",
        requestId: message.requestId,
        text,
        elapsedMs,
        audioSeconds,
        rtf: audioSeconds > 0 ? elapsedMs / 1000 / audioSeconds : 0,
      });
    }
  } catch (error) {
    post({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
      operation: message.type,
    });
  }
}

async function initializeRuntime(runtimeUrl: string): Promise<EmscriptenModule> {
  if (!self.crossOriginIsolated) {
    throw new Error("Threaded WebAssembly is unavailable. Reload the page after the offline worker is installed.");
  }
  const runtime = (await import(/* @vite-ignore */ runtimeUrl)) as {
    default: (options: Record<string, unknown>) => Promise<EmscriptenModule>;
  };
  return runtime.default({
    noInitialRun: true,
    print: (line: string) => console.info(`[whisper.cpp] ${line}`),
    printErr: (line: string) => console.warn(`[whisper.cpp] ${line}`),
  });
}

async function loadModel(module: EmscriptenModule, model: ModelDefinition): Promise<void> {
  const cache = await caches.open(MODEL_CACHE);
  const cacheKey = new Request(new URL(`__models/${model.id}/${model.sha1}`, self.location.origin));
  const cachedResponse = await cache.match(cacheKey);
  let bytes: Uint8Array;
  let cached = false;

  if (cachedResponse) {
    cached = true;
    post({ type: "model-progress", stage: "Loading cached model", loaded: model.bytes, total: model.bytes });
    bytes = new Uint8Array(await cachedResponse.arrayBuffer());
  } else {
    bytes = await downloadModel(model);
    post({ type: "model-progress", stage: "Verifying download", loaded: model.bytes, total: model.bytes });
    const digest = await sha1(bytes);
    if (digest !== model.sha1) {
      throw new Error(`Model integrity check failed. Expected ${model.sha1}, received ${digest}.`);
    }
    await cache.put(
      cacheKey,
      new Response(bytes.slice().buffer, {
        headers: {
          "Content-Type": "application/octet-stream",
          "X-EnTranscribe-Model": model.id,
          "X-EnTranscribe-SHA1": model.sha1,
        },
      }),
    );
  }

  if (loadedModelPath) {
    module.unload_model();
    try {
      module.FS.unlink(loadedModelPath);
    } catch {
      // The previous in-memory model may already have been removed.
    }
  }

  module.FS.mkdirTree("/models");
  const modelPath = `/models/${model.fileName}`;
  post({ type: "model-progress", stage: "Starting local model", loaded: model.bytes, total: model.bytes });
  module.FS.writeFile(modelPath, bytes);
  const result = module.load_model(modelPath);
  if (result !== 0) throw new Error(`whisper.cpp could not load the ${model.label} model (code ${result}).`);
  loadedModelPath = modelPath;
  post({ type: "model-ready", modelId: model.id, cached, systemInfo: module.system_info() });
}

async function downloadModel(model: ModelDefinition): Promise<Uint8Array> {
  const response = await fetch(model.url, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`Model download failed (${response.status} ${response.statusText}).`);
  if (!response.body) return new Uint8Array(await response.arrayBuffer());

  const expected = Number(response.headers.get("Content-Length")) || model.bytes;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    post({ type: "model-progress", stage: "Downloading model", loaded, total: expected });
  }

  const result = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function sha1(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await crypto.subtle.digest("SHA-1", digestInput.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function post(message: Record<string, unknown>): void {
  self.postMessage(message);
}

export {};
