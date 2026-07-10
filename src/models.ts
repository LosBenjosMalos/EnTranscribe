export type ModelDefinition = {
  id: "tiny" | "tiny.en" | "base" | "base.en";
  label: string;
  fileName: string;
  url: string;
  bytes: number;
  sha1: string;
  multilingual: boolean;
};

const MODEL_ROOT = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

export const MODELS: Record<ModelDefinition["id"], ModelDefinition> = {
  tiny: {
    id: "tiny",
    label: "Tiny · Multilingual",
    fileName: "ggml-tiny.bin",
    url: `${MODEL_ROOT}/ggml-tiny.bin?download=true`,
    bytes: 75 * 1024 * 1024,
    sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
    multilingual: true,
  },
  "tiny.en": {
    id: "tiny.en",
    label: "Tiny · English",
    fileName: "ggml-tiny.en.bin",
    url: `${MODEL_ROOT}/ggml-tiny.en.bin?download=true`,
    bytes: 75 * 1024 * 1024,
    sha1: "c78c86eb1a8faa21b369bcd33207cc90d64ae9df",
    multilingual: false,
  },
  base: {
    id: "base",
    label: "Base · Multilingual",
    fileName: "ggml-base.bin",
    url: `${MODEL_ROOT}/ggml-base.bin?download=true`,
    bytes: 142 * 1024 * 1024,
    sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
    multilingual: true,
  },
  "base.en": {
    id: "base.en",
    label: "Base · English",
    fileName: "ggml-base.en.bin",
    url: `${MODEL_ROOT}/ggml-base.en.bin?download=true`,
    bytes: 142 * 1024 * 1024,
    sha1: "137c40403d78fd54d454da0f9bd998f78703390c",
    multilingual: false,
  },
};

export function getModel(id: string): ModelDefinition {
  if (!(id in MODELS)) {
    throw new Error(`Unknown model: ${id}`);
  }
  return MODELS[id as ModelDefinition["id"]];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
