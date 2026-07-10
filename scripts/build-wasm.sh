#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build-wasm"
OUTPUT_DIR="${ROOT_DIR}/public/wasm"

if ! command -v emcmake >/dev/null 2>&1; then
  echo "emcmake was not found. Install the Emscripten SDK before building." >&2
  exit 1
fi

emcmake cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DWHISPER_ALL_WARNINGS=OFF \
  -DGGML_ALL_WARNINGS=OFF

cmake --build "${BUILD_DIR}" --target entranscribe --config Release -j 4
mkdir -p "${OUTPUT_DIR}"
cp "${BUILD_DIR}/bin/entranscribe.js" "${OUTPUT_DIR}/entranscribe.js"

echo "Built ${OUTPUT_DIR}/entranscribe.js"
