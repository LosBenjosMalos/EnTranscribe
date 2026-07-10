import "./style.css";
import { AudioRecorder, loadSampleAudio } from "./audio";
import { cleanTranscript, formatDuration } from "./format";
import {
  createInitialDiagnostics,
  diagnosticItems,
  diagnosticsReport,
  type DiagnosticsState,
} from "./diagnostics";
import { formatBytes, getModel } from "./models";
import { WhisperClient, type WhisperWorkerEvent } from "./whisper-client";

const SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 60_000;
const SPEECH_THRESHOLD = 0.045;
const SILENCE_STOP_MS = 1_400;

const elements = {
  statusBadge: getElement<HTMLSpanElement>("statusBadge"),
  recordHalo: getElement<HTMLDivElement>("recordHalo"),
  recordButton: getElement<HTMLButtonElement>("recordButton"),
  recorderHint: getElement<HTMLParagraphElement>("recorderHint"),
  recordingTime: getElement<HTMLParagraphElement>("recordingTime"),
  modelSelect: getElement<HTMLSelectElement>("modelSelect"),
  languageSelect: getElement<HTMLSelectElement>("languageSelect"),
  threadSelect: getElement<HTMLSelectElement>("threadSelect"),
  prepareButton: getElement<HTMLButtonElement>("prepareButton"),
  sampleButton: getElement<HTMLButtonElement>("sampleButton"),
  modelProgress: getElement<HTMLDivElement>("modelProgress"),
  progressBar: getElement<HTMLSpanElement>("progressBar"),
  progressLabel: getElement<HTMLSpanElement>("progressLabel"),
  progressValue: getElement<HTMLSpanElement>("progressValue"),
  autoStopToggle: getElement<HTMLInputElement>("autoStopToggle"),
  autoCopyToggle: getElement<HTMLInputElement>("autoCopyToggle"),
  transcript: getElement<HTMLTextAreaElement>("transcript"),
  characterCount: getElement<HTMLSpanElement>("characterCount"),
  copyButton: getElement<HTMLButtonElement>("copyButton"),
  clearButton: getElement<HTMLButtonElement>("clearButton"),
  diagnosticGrid: getElement<HTMLDivElement>("diagnosticGrid"),
  copyDiagnosticsButton: getElement<HTMLButtonElement>("copyDiagnosticsButton"),
  systemInfo: getElement<HTMLPreElement>("systemInfo"),
  toast: getElement<HTMLDivElement>("toast"),
  meterBars: Array.from(document.querySelectorAll<HTMLSpanElement>(".meter span")),
};

let diagnostics: DiagnosticsState = createInitialDiagnostics();
let whisper: WhisperClient | null = null;
let runtimeReady = false;
let modelReady = false;
let modelLoading = false;
let processing = false;
let stopping = false;
let speechSeen = false;
let lastSpeechAt = 0;
let toastTimer = 0;

const recorder = new AudioRecorder();

void initialize();

async function initialize(): Promise<void> {
  setStatus("Starting local runtime…", "neutral");
  renderDiagnostics();
  wireInteractions();
  setSuggestedThreadCount();
  updateOnlineState();

  if (!diagnostics.secureContext || !diagnostics.wasm) {
    diagnostics.runtime = "Unavailable";
    setStatus("Browser support is blocked", "danger");
    elements.recorderHint.textContent = "Use a current Chrome or Edge browser over HTTPS";
    renderDiagnostics();
    return;
  }

  if (import.meta.env.PROD) {
    const ready = await registerOfflineWorker();
    if (!ready) return;
    diagnostics.isolated = window.crossOriginIsolated;
  }

  if (!window.crossOriginIsolated) {
    diagnostics.runtime = "Unavailable";
    setStatus("Threaded WebAssembly unavailable", "danger");
    elements.recorderHint.textContent = "Reload once, or check your browser security policy";
    renderDiagnostics();
    return;
  }

  const runtimeUrl = new URL("wasm/entranscribe.js?v=6.0.2", document.baseURI).toString();
  whisper = new WhisperClient(runtimeUrl);
  whisper.onEvent(handleWorkerEvent);
  await checkMicrophonePermission();
}

function wireInteractions(): void {
  elements.prepareButton.addEventListener("click", prepareSelectedModel);
  elements.recordButton.addEventListener("click", () => void toggleRecording());
  elements.sampleButton.addEventListener("click", () => void runSample());
  elements.copyButton.addEventListener("click", () => void copyTranscript());
  elements.clearButton.addEventListener("click", clearTranscript);
  elements.copyDiagnosticsButton.addEventListener("click", () => void copyDiagnostics());
  elements.transcript.addEventListener("input", updateTranscriptMeta);
  elements.modelSelect.addEventListener("change", () => {
    modelReady = false;
    elements.recordButton.disabled = true;
    elements.sampleButton.disabled = true;
    elements.prepareButton.disabled = !runtimeReady;
    elements.prepareButton.textContent = "Prepare local model";
    elements.modelProgress.hidden = true;
    setStatus("Model changed", "neutral");
    elements.recorderHint.textContent = "Prepare the selected local model to begin";
  });
  window.addEventListener("online", updateOnlineState);
  window.addEventListener("offline", updateOnlineState);
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "KeyR" && !event.repeat) {
      event.preventDefault();
      void toggleRecording();
    }
  });
  window.addEventListener("beforeunload", () => {
    recorder.cancel();
    whisper?.terminate();
  });
}

function handleWorkerEvent(event: WhisperWorkerEvent): void {
  if (event.type === "runtime-ready") {
    runtimeReady = true;
    diagnostics.runtime = "Ready";
    diagnostics.systemInfo = event.systemInfo;
    elements.systemInfo.textContent = event.systemInfo;
    elements.prepareButton.disabled = false;
    setStatus("Runtime ready", "success");
    elements.recorderHint.textContent = "Prepare a local model once, then record";
  } else if (event.type === "model-progress") {
    const percent = Math.min(100, Math.round((event.loaded / Math.max(1, event.total)) * 100));
    elements.modelProgress.hidden = false;
    elements.progressBar.style.width = `${percent}%`;
    elements.progressLabel.textContent = event.stage;
    elements.progressValue.textContent = event.stage === "Downloading model"
      ? `${percent}% · ${formatBytes(event.loaded)}`
      : `${percent}%`;
  } else if (event.type === "model-ready") {
    modelReady = true;
    modelLoading = false;
    const model = getModel(event.modelId);
    diagnostics.model = model.label;
    diagnostics.modelCached = event.cached;
    diagnostics.offlineReady = Boolean(navigator.serviceWorker?.controller) && modelReady;
    diagnostics.systemInfo = event.systemInfo;
    elements.systemInfo.textContent = event.systemInfo;
    elements.prepareButton.disabled = false;
    elements.prepareButton.textContent = "Model ready";
    elements.recordButton.disabled = false;
    elements.sampleButton.disabled = false;
    elements.modelProgress.hidden = true;
    setStatus("Ready to record", "success");
    elements.recorderHint.textContent = "Press the microphone, then speak naturally";
    showToast(event.cached ? "Local model loaded from this device" : "Model verified and cached locally");
  } else if (event.type === "error") {
    modelLoading = false;
    processing = false;
    stopping = false;
    diagnostics.runtime = event.operation === "bootstrap" ? "Unavailable" : diagnostics.runtime;
    elements.prepareButton.disabled = !runtimeReady;
    elements.recordButton.disabled = !modelReady;
    elements.sampleButton.disabled = !modelReady;
    elements.modelProgress.hidden = true;
    setStatus("Something went wrong", "danger");
    elements.recorderHint.textContent = event.message;
    showToast(event.message, true);
  }
  renderDiagnostics();
}

function prepareSelectedModel(): void {
  if (!whisper || !runtimeReady || modelLoading || processing) return;
  const model = getModel(elements.modelSelect.value);
  modelLoading = true;
  modelReady = false;
  elements.prepareButton.disabled = true;
  elements.prepareButton.textContent = "Preparing…";
  elements.recordButton.disabled = true;
  elements.sampleButton.disabled = true;
  elements.modelProgress.hidden = false;
  elements.progressBar.style.width = "0%";
  elements.progressLabel.textContent = navigator.onLine ? "Checking local cache" : "Opening cached model";
  elements.progressValue.textContent = "0%";
  setStatus("Preparing model", "working");
  elements.recorderHint.textContent = "The model is downloaded once and then kept on this device";
  whisper.loadModel(model);
}

async function toggleRecording(): Promise<void> {
  if (recorder.isRecording) {
    await stopAndTranscribe();
  } else {
    await startRecording();
  }
}

async function startRecording(): Promise<void> {
  if (!modelReady || processing || modelLoading) {
    showToast(modelLoading ? "Wait for the local model to finish loading" : "Prepare a local model first", true);
    return;
  }

  try {
    speechSeen = false;
    lastSpeechAt = performance.now();
    await recorder.start(updateMeter);
    diagnostics.microphone = "Allowed";
    elements.recordHalo.dataset.state = "recording";
    elements.recordButton.setAttribute("aria-label", "Stop recording");
    elements.recordButton.disabled = false;
    elements.sampleButton.disabled = true;
    elements.prepareButton.disabled = true;
    setStatus("Listening", "recording");
    elements.recorderHint.textContent = "Speak now — press again when you are finished";
    renderDiagnostics();
  } catch (error) {
    diagnostics.microphone = "Blocked";
    setStatus("Microphone unavailable", "danger");
    const message = error instanceof Error ? error.message : String(error);
    elements.recorderHint.textContent = message;
    showToast("Allow microphone access in the browser, then try again", true);
    renderDiagnostics();
  }
}

function updateMeter({ level, elapsedMs }: { level: number; elapsedMs: number }): void {
  elements.recordingTime.textContent = formatDuration(elapsedMs / 1000);
  const activeBars = Math.max(1, Math.round(level * elements.meterBars.length));
  elements.meterBars.forEach((bar, index) => {
    const distanceFromCenter = Math.abs(index - Math.floor(elements.meterBars.length / 2));
    const height = index < activeBars ? 10 + Math.max(4, level * 34 - distanceFromCenter * 1.5) : 5;
    bar.style.height = `${height}px`;
    bar.dataset.active = index < activeBars ? "true" : "false";
  });

  if (level >= SPEECH_THRESHOLD) {
    speechSeen = true;
    lastSpeechAt = performance.now();
  }

  if (
    elements.autoStopToggle.checked &&
    speechSeen &&
    elapsedMs > 1_500 &&
    performance.now() - lastSpeechAt >= SILENCE_STOP_MS &&
    !stopping
  ) {
    void stopAndTranscribe();
  } else if (elapsedMs >= MAX_RECORDING_MS && !stopping) {
    void stopAndTranscribe();
  }
}

async function stopAndTranscribe(): Promise<void> {
  if (!recorder.isRecording || stopping) return;
  stopping = true;
  elements.recordButton.disabled = true;
  setStatus("Preparing audio", "working");
  elements.recorderHint.textContent = "Releasing the microphone…";
  elements.recordHalo.dataset.state = "processing";

  try {
    const audio = await recorder.stop();
    resetMeter();
    if (audio.length < SAMPLE_RATE * 0.35) throw new Error("That recording was too short. Try speaking for a little longer.");
    await transcribeAudio(audio);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("Could not transcribe", "danger");
    elements.recorderHint.textContent = message;
    showToast(message, true);
  } finally {
    stopping = false;
    processing = false;
    elements.recordHalo.dataset.state = "idle";
    elements.recordButton.setAttribute("aria-label", "Start recording");
    elements.recordButton.disabled = !modelReady;
    elements.sampleButton.disabled = !modelReady;
    elements.prepareButton.disabled = !runtimeReady;
    elements.recordingTime.textContent = "00:00";
  }
}

async function transcribeAudio(audio: Float32Array): Promise<void> {
  if (!whisper) throw new Error("The local transcription runtime is unavailable.");
  processing = true;
  elements.recordHalo.dataset.state = "processing";
  elements.recordButton.disabled = true;
  elements.sampleButton.disabled = true;
  elements.prepareButton.disabled = true;
  setStatus("Transcribing locally", "working");
  elements.recorderHint.textContent = "whisper.cpp is working on this device";

  const result = await whisper.transcribe(
    audio,
    elements.languageSelect.value,
    Number(elements.threadSelect.value),
  );
  const text = cleanTranscript(result.text);
  diagnostics.audioSeconds = result.audioSeconds;
  diagnostics.inferenceMs = result.elapsedMs;
  diagnostics.rtf = result.rtf;
  if (text) {
    elements.transcript.value = text;
    updateTranscriptMeta();
    setStatus("Transcript ready", "success");
    elements.recorderHint.textContent = `Finished locally in ${(result.elapsedMs / 1000).toFixed(2)} seconds`;
    if (elements.autoCopyToggle.checked) {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Transcript copied to the clipboard");
      } catch {
        showToast("Transcript ready — use the Copy text button");
      }
    }
  } else {
    setStatus("No speech detected", "neutral");
    elements.recorderHint.textContent = "No clear speech was found. Try again closer to the microphone.";
  }
  renderDiagnostics();
}

async function runSample(): Promise<void> {
  if (!modelReady || processing) return;
  elements.sampleButton.disabled = true;
  elements.recordButton.disabled = true;
  setStatus("Loading audio test", "working");
  elements.recorderHint.textContent = "Running a known sample through the same local pipeline";
  try {
    const sampleUrl = new URL("samples/jfk.wav", document.baseURI).toString();
    await transcribeAudio(await loadSampleAudio(sampleUrl));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("Audio test failed", "danger");
    elements.recorderHint.textContent = message;
    showToast(message, true);
  } finally {
    processing = false;
    elements.recordHalo.dataset.state = "idle";
    elements.sampleButton.disabled = !modelReady;
    elements.recordButton.disabled = !modelReady;
    elements.prepareButton.disabled = !runtimeReady;
  }
}

async function copyTranscript(): Promise<void> {
  const text = elements.transcript.value.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Transcript copied to the clipboard");
  } catch {
    elements.transcript.focus();
    elements.transcript.select();
    showToast("Text selected — press Ctrl/Cmd + C");
  }
}

function clearTranscript(): void {
  elements.transcript.value = "";
  updateTranscriptMeta();
  elements.transcript.focus();
}

async function copyDiagnostics(): Promise<void> {
  try {
    await navigator.clipboard.writeText(diagnosticsReport(diagnostics));
    showToast("Diagnostic report copied");
  } catch {
    showToast("Could not access the clipboard", true);
  }
}

function updateTranscriptMeta(): void {
  const count = elements.transcript.value.length;
  elements.characterCount.textContent = `${count} ${count === 1 ? "character" : "characters"}`;
  elements.copyButton.disabled = count === 0;
}

function renderDiagnostics(): void {
  elements.diagnosticGrid.replaceChildren(
    ...diagnosticItems(diagnostics).map((item) => {
      const row = document.createElement("div");
      row.className = "diagnostic-item";
      const label = document.createElement("span");
      label.textContent = item.label;
      const value = document.createElement("strong");
      value.textContent = item.value;
      value.dataset.state = item.ok === null ? "neutral" : item.ok ? "good" : "bad";
      row.append(label, value);
      return row;
    }),
  );
}

function setStatus(message: string, tone: "neutral" | "success" | "danger" | "working" | "recording"): void {
  elements.statusBadge.textContent = message;
  elements.statusBadge.dataset.tone = tone;
}

function resetMeter(): void {
  elements.meterBars.forEach((bar) => {
    bar.style.height = "5px";
    bar.dataset.active = "false";
  });
}

function showToast(message: string, danger = false): void {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = danger ? "danger" : "success";
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 3_600);
}

function setSuggestedThreadCount(): void {
  const cores = navigator.hardwareConcurrency || 2;
  elements.threadSelect.value = cores >= 6 ? "4" : "2";
}

function updateOnlineState(): void {
  diagnostics.online = navigator.onLine;
  renderDiagnostics();
}

async function checkMicrophonePermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    diagnostics.microphone = "Unavailable";
    renderDiagnostics();
    return;
  }
  try {
    const permission = await navigator.permissions?.query({ name: "microphone" as PermissionName });
    diagnostics.microphone = permission?.state === "granted" ? "Allowed" : permission?.state === "denied" ? "Blocked" : "Not checked";
    permission?.addEventListener("change", () => {
      diagnostics.microphone = permission.state === "granted" ? "Allowed" : permission.state === "denied" ? "Blocked" : "Not checked";
      renderDiagnostics();
    });
  } catch {
    diagnostics.microphone = "Not checked";
  }
  renderDiagnostics();
}

async function registerOfflineWorker(): Promise<boolean> {
  if (!("serviceWorker" in navigator)) return window.crossOriginIsolated;
  try {
    await navigator.serviceWorker.register(new URL("sw.js", document.baseURI), { scope: "./" });
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller || !window.crossOriginIsolated) {
      const reloadKey = "entranscribe-isolation-reload";
      if (!sessionStorage.getItem(reloadKey)) {
        sessionStorage.setItem(reloadKey, "1");
        window.location.reload();
        return false;
      }
    }
    sessionStorage.removeItem("entranscribe-isolation-reload");
    return window.crossOriginIsolated;
  } catch (error) {
    console.error("Service worker registration failed", error);
    return false;
  }
}

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}
