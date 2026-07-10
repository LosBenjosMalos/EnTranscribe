#include "whisper.h"

#include <emscripten/bind.h>

#include <algorithm>
#include <cctype>
#include <string>
#include <thread>
#include <vector>

namespace {

whisper_context * g_context = nullptr;

std::string trim(const std::string & value) {
    auto start = std::find_if_not(value.begin(), value.end(), [](unsigned char character) {
        return std::isspace(character);
    });
    auto end = std::find_if_not(value.rbegin(), value.rend(), [](unsigned char character) {
        return std::isspace(character);
    }).base();
    return start < end ? std::string(start, end) : std::string();
}

int load_model(const std::string & path) {
    if (g_context != nullptr) {
        whisper_free(g_context);
        g_context = nullptr;
    }

    whisper_context_params context_params = whisper_context_default_params();
    context_params.use_gpu = false;
    context_params.flash_attn = false;
    g_context = whisper_init_from_file_with_params(path.c_str(), context_params);
    return g_context == nullptr ? 1 : 0;
}

void unload_model() {
    if (g_context != nullptr) {
        whisper_free(g_context);
        g_context = nullptr;
    }
}

std::string transcribe(const emscripten::val & audio, const std::string & language, int requested_threads) {
    if (g_context == nullptr) {
        throw std::runtime_error("No Whisper model is loaded.");
    }

    const int sample_count = audio["length"].as<int>();
    if (sample_count < WHISPER_SAMPLE_RATE / 4) {
        return "";
    }

    std::vector<float> samples(sample_count);
    emscripten::val heap = emscripten::val::module_property("HEAPU8");
    emscripten::val memory = heap["buffer"];
    emscripten::val view = audio["constructor"].new_(
        memory,
        reinterpret_cast<uintptr_t>(samples.data()),
        sample_count
    );
    view.call<void>("set", audio);

    whisper_full_params params = whisper_full_default_params(WHISPER_SAMPLING_GREEDY);
    params.print_realtime = false;
    params.print_progress = false;
    params.print_timestamps = false;
    params.print_special = false;
    params.translate = false;
    params.no_context = true;
    params.single_segment = false;
    params.suppress_blank = true;
    params.suppress_nst = true;
    params.temperature = 0.0f;
    params.no_speech_thold = 0.6f;
    params.language = language.empty() ? "auto" : language.c_str();
    params.n_threads = std::clamp(requested_threads, 1, 6);

    if (!whisper_is_multilingual(g_context)) {
        params.language = "en";
    }

    const int result = whisper_full(g_context, params, samples.data(), sample_count);
    if (result != 0) {
        throw std::runtime_error("Local transcription failed with code " + std::to_string(result) + ".");
    }

    std::string output;
    const int segment_count = whisper_full_n_segments(g_context);
    for (int index = 0; index < segment_count; ++index) {
        const char * segment = whisper_full_get_segment_text(g_context, index);
        if (segment == nullptr) {
            continue;
        }
        const std::string cleaned = trim(segment);
        if (cleaned.empty()) {
            continue;
        }
        if (!output.empty()) {
            output += ' ';
        }
        output += cleaned;
    }
    return trim(output);
}

std::string system_info() {
    return std::string("EnTranscribe Web 0.1.0\nwhisper.cpp 1.9.1\n") + whisper_print_system_info();
}

} // namespace

EMSCRIPTEN_BINDINGS(entranscribe) {
    emscripten::function("load_model", &load_model);
    emscripten::function("unload_model", &unload_model);
    emscripten::function("transcribe", &transcribe);
    emscripten::function("system_info", &system_info);
}
