cmake_minimum_required(VERSION 3.20)
project(entranscribe-wasm LANGUAGES C CXX)

if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "This target must be configured with emcmake.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)

add_subdirectory(vendor/whisper.cpp)

add_executable(entranscribe wasm/entranscribe.cpp)
target_link_libraries(entranscribe PRIVATE whisper)
target_include_directories(entranscribe PRIVATE vendor/whisper.cpp/include)
target_compile_options(entranscribe PRIVATE "-pthread")

set_target_properties(entranscribe PROPERTIES
  OUTPUT_NAME "entranscribe"
  SUFFIX ".js"
)

target_link_options(entranscribe PRIVATE
  "--bind"
  "-sMODULARIZE=1"
  "-sEXPORT_ES6=1"
  "-sEXPORT_NAME=createEnTranscribeModule"
  "-sENVIRONMENT=web,worker"
  "-sUSE_PTHREADS=1"
  "-pthread"
  "-sPTHREAD_POOL_SIZE=6"
  "-sPTHREAD_POOL_SIZE_STRICT=0"
  "-sINITIAL_MEMORY=512MB"
  "-sSTACK_SIZE=5MB"
  "-sMAXIMUM_MEMORY=2000MB"
  "-sALLOW_MEMORY_GROWTH=1"
  "-sFORCE_FILESYSTEM=1"
  "-sEXPORTED_RUNTIME_METHODS=['FS','HEAPU8']"
  "-sSINGLE_FILE=1"
  "-sASSERTIONS=0"
  "-sFILESYSTEM=1"
)
