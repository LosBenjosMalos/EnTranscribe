# EnTranscribe Web

EnTranscribe is a private, browser-based speech-to-text MVP powered by
[whisper.cpp](https://github.com/ggml-org/whisper.cpp). It works in current desktop versions of
Chrome and Edge on Windows and macOS. Audio is recorded into memory and transcribed locally in a
Web Worker; it is never uploaded to an EnTranscribe server.

Live app: **https://losbenjosmalos.github.io/EnTranscribe/**

## Product flow

1. Open the web app and prepare a local Whisper model.
2. The model is downloaded, verified against the checksum published by whisper.cpp, and cached in
   the browser.
3. Press the microphone button or `Alt + R`, speak, and stop manually or after silence.
4. whisper.cpp transcribes the completed recording locally.
5. Copy the transcript into the application where it is needed.

The page includes a known audio sample and a diagnostic report so managed Windows machines can be
tested without installing executables or running PowerShell scripts.

## Privacy properties

- No account, API key, analytics, or cloud transcription service.
- Audio is held in memory only and discarded after transcription.
- Transcript history is not stored.
- The model is fetched only after an explicit button press and cached by the browser.
- After the app shell and model are cached, transcription works without a network connection.
- The complete source and pinned whisper.cpp revision are public.

The optional **Copy automatically** setting writes the finished transcript to the system clipboard.
Clipboard handling is provided by the browser and operating system and may be subject to workplace
data-loss-prevention policies.

## Supported models

| Model | Use case | Approximate download |
| --- | --- | ---: |
| `base` | Recommended multilingual model | 142 MB |
| `base.en` | Recommended English-only model | 142 MB |
| `tiny` | Lower-resource multilingual fallback | 75 MB |
| `tiny.en` | Lower-resource English fallback | 75 MB |

Model files come from the model repository referenced by whisper.cpp and are checked against the
published SHA-1 model hashes. SHA-1 is used here only as an upstream file-integrity identifier, not
for authentication or password security.

## Local development

Requirements:

- Node.js 22+
- CMake
- Emscripten SDK

```bash
git clone --recurse-submodules https://github.com/LosBenjosMalos/EnTranscribe.git
cd EnTranscribe
npm install
npm run build:wasm
npm run dev
```

The development server supplies the COOP/COEP headers required for threaded WebAssembly. Production
uses `public/sw.js` to provide those headers on GitHub Pages and to cache same-origin application
resources.

## Validation

```bash
npm test
npm run build
```

The included audio test runs `public/samples/jfk.wav` through the same decoding, resampling, Web
Worker, and whisper.cpp path as microphone recordings.

## Architecture

- `wasm/entranscribe.cpp` — narrow Emscripten binding around whisper.cpp.
- `src/whisper.worker.ts` — model download, verification, cache, and inference worker.
- `src/audio.ts` — microphone capture and resampling to 16 kHz mono.
- `src/main.ts` — product state, UI, diagnostics, and clipboard interaction.
- `public/sw.js` — offline shell cache and cross-origin isolation headers.
- `vendor/whisper.cpp` — pinned upstream Git submodule.

## Limitations of this MVP

- The web page cannot type directly into other desktop applications; the transcript must be copied.
- The browser tab must remain open while recording and transcribing.
- Managed browser policy can block microphone access, WebAssembly, or the service worker used for
  threaded inference.
- Short utterances, names, and specialist vocabulary can be less accurate than longer natural speech.

## Licenses

EnTranscribe is MIT licensed. whisper.cpp is included as an MIT-licensed Git submodule; its license
and notices remain in `vendor/whisper.cpp`.
