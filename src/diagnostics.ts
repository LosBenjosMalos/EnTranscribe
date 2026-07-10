import { formatMilliseconds } from "./format";

export type DiagnosticsState = {
  browser: string;
  online: boolean;
  secureContext: boolean;
  wasm: boolean;
  isolated: boolean;
  threads: number;
  microphone: "Not checked" | "Allowed" | "Blocked" | "Unavailable";
  runtime: "Starting" | "Ready" | "Unavailable";
  model: string;
  modelCached: boolean;
  offlineReady: boolean;
  audioSeconds?: number;
  inferenceMs?: number;
  rtf?: number;
  systemInfo?: string;
};

export function detectBrowser(): string {
  const ua = navigator.userAgent;
  const edge = ua.match(/Edg\/([\d.]+)/);
  if (edge) return `Microsoft Edge ${edge[1]}`;
  const chrome = ua.match(/Chrome\/([\d.]+)/);
  if (chrome) return `Google Chrome ${chrome[1]}`;
  const safari = ua.match(/Version\/([\d.]+).*Safari/);
  if (safari) return `Safari ${safari[1]}`;
  const userAgentData = (navigator as Navigator & {
    userAgentData?: { brands?: Array<{ brand: string; version: string }> };
  }).userAgentData;
  return userAgentData?.brands?.map((brand) => `${brand.brand} ${brand.version}`).join(", ") || "Unknown browser";
}

export function createInitialDiagnostics(): DiagnosticsState {
  return {
    browser: detectBrowser(),
    online: navigator.onLine,
    secureContext: window.isSecureContext,
    wasm: (globalThis as typeof globalThis & { WebAssembly?: unknown }).WebAssembly !== undefined,
    isolated: window.crossOriginIsolated,
    threads: navigator.hardwareConcurrency || 1,
    microphone: (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices ? "Not checked" : "Unavailable",
    runtime: "Starting",
    model: "Not loaded",
    modelCached: false,
    offlineReady: false,
  };
}

type DiagnosticItem = { label: string; value: string; ok: boolean | null };

export function diagnosticItems(state: DiagnosticsState): DiagnosticItem[] {
  return [
    { label: "Browser", value: state.browser, ok: null },
    { label: "Secure page", value: state.secureContext ? "Yes" : "No", ok: state.secureContext },
    { label: "WebAssembly", value: state.wasm ? "Supported" : "Blocked", ok: state.wasm },
    { label: "Threaded runtime", value: state.isolated ? "Available" : "Unavailable", ok: state.isolated },
    { label: "Logical CPU threads", value: String(state.threads), ok: state.threads >= 2 },
    { label: "Microphone", value: state.microphone, ok: state.microphone === "Not checked" ? null : state.microphone === "Allowed" },
    { label: "Local runtime", value: state.runtime, ok: state.runtime === "Starting" ? null : state.runtime === "Ready" },
    { label: "Model", value: state.model, ok: state.model === "Not loaded" ? null : true },
    { label: "Offline ready", value: state.offlineReady ? "Yes" : "Not yet", ok: state.offlineReady ? true : null },
    {
      label: "Last inference",
      value: state.inferenceMs === undefined ? "Not run" : `${formatMilliseconds(state.inferenceMs)} · RTF ${state.rtf?.toFixed(2)}`,
      ok: state.rtf === undefined ? null : state.rtf <= 0.5,
    },
  ];
}

export function diagnosticsReport(state: DiagnosticsState): string {
  const lines = [
    "EnTranscribe diagnostics",
    `Generated: ${new Date().toISOString()}`,
    `Browser: ${state.browser}`,
    `Online: ${state.online}`,
    `Secure context: ${state.secureContext}`,
    `WebAssembly: ${state.wasm}`,
    `Cross-origin isolated: ${state.isolated}`,
    `Logical CPU threads: ${state.threads}`,
    `Microphone: ${state.microphone}`,
    `Runtime: ${state.runtime}`,
    `Model: ${state.model}`,
    `Model cached: ${state.modelCached}`,
    `Offline ready: ${state.offlineReady}`,
  ];

  if (state.audioSeconds !== undefined) lines.push(`Last audio: ${state.audioSeconds.toFixed(2)} s`);
  if (state.inferenceMs !== undefined) lines.push(`Last inference: ${state.inferenceMs.toFixed(0)} ms`);
  if (state.rtf !== undefined) lines.push(`Real-time factor: ${state.rtf.toFixed(3)}`);
  if (state.systemInfo) lines.push("", state.systemInfo);
  return lines.join("\n");
}
