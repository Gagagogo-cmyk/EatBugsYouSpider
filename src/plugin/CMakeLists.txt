cmake_minimum_required(VERSION 3.22)
project(GnumbatPlugin VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

# ---- JUCE ---------------------------------------------------------------------------------------
# Either point at a checkout (-DGNUMBAT_JUCE_DIR=/path/to/JUCE) or let CMake fetch the pinned tag.
# LICENCE: JUCE is AGPLv3 / commercial. A plugin distributed to third parties must either be AGPL
# or use a JUCE commercial licence — decide before shipping (see docs/platform/CORE_ARCHITECTURE.md).
set(GNUMBAT_JUCE_DIR "" CACHE PATH "Path to a JUCE checkout (optional)")
if(GNUMBAT_JUCE_DIR)
  add_subdirectory(${GNUMBAT_JUCE_DIR} juce EXCLUDE_FROM_ALL)
else()
  include(FetchContent)
  FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.15 GIT_SHALLOW TRUE)
  FetchContent_MakeAvailable(juce)
endif()

option(GNUMBAT_BUILD_PLUGIN "Build the VST3/Standalone plugin" ON)
option(GNUMBAT_BUILD_TESTS "Build the test executables" ON)

# ---- shared, JUCE-GUI-free core (Library, notation, filters, jobs, capture ring) -----------------
set(GNUMBAT_CORE_SOURCES
  core/Ids.cpp core/JsonIo.cpp core/NotationProfile.cpp core/FilterQuery.cpp core/Library.cpp
  core/Jobs.cpp core/Handoff.cpp core/Settings.cpp core/MapData.cpp core/CaptureBuffer.cpp core/ModelTree.cpp core/TimelineTape.cpp core/Spectromorphology.cpp)

set(GNUMBAT_PLUGIN_SOURCES
  ${GNUMBAT_CORE_SOURCES}
  plugin/PluginProcessor.cpp plugin/PluginEditor.cpp
  plugin/ui/Theme.cpp plugin/ui/UiHost.cpp plugin/ui/NotationCard.cpp plugin/ui/AppModel.cpp
  plugin/ui/FilterBar.cpp plugin/ui/BankView.cpp plugin/ui/InspectorView.cpp plugin/ui/MapView.cpp plugin/ui/CapturePanel.cpp plugin/ui/ModelMenu.cpp
  plugin/ui/SpectromorphologyTree.cpp
 plugin/ui/ModelHub.cpp plugin/ui/Account.cpp)

set(GNUMBAT_CONFORMANCE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../core/conformance")

if(GNUMBAT_BUILD_TESTS)
  juce_add_console_app(gnumbat_core_tests PRODUCT_NAME "gnumbat_core_tests")
  target_sources(gnumbat_core_tests PRIVATE tests/core_tests.cpp ${GNUMBAT_CORE_SOURCES})
  target_compile_options(gnumbat_core_tests PRIVATE -Wno-float-equal)   # exact numeric equality is the documented filter semantics
  target_compile_definitions(gnumbat_core_tests PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_STANDALONE_APPLICATION=1)
  target_link_libraries(gnumbat_core_tests PRIVATE juce::juce_core juce::juce_cryptography
                        juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)

  add_executable(gnumbat_capture_tests tests/capture_tests.cpp core/CaptureBuffer.cpp)
  find_package(Threads REQUIRED)
  target_link_libraries(gnumbat_capture_tests PRIVATE Threads::Threads)

  if(GNUMBAT_BUILD_PLUGIN)
    juce_add_console_app(gnumbat_plugin_tests PRODUCT_NAME "gnumbat_plugin_tests")
    target_sources(gnumbat_plugin_tests PRIVATE tests/plugin_tests.cpp ${GNUMBAT_PLUGIN_SOURCES})
    target_compile_definitions(gnumbat_plugin_tests PRIVATE JUCE_MODAL_LOOPS_PERMITTED=1 JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0 JUCE_STANDALONE_APPLICATION=1 GNUMBAT_VERSION="${PROJECT_VERSION}")
    target_link_libraries(gnumbat_plugin_tests PRIVATE juce::juce_audio_utils juce::juce_cryptography
                          juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
    add_test(NAME plugin COMMAND gnumbat_plugin_tests)
  endif()

  enable_testing()
  add_test(NAME capture COMMAND gnumbat_capture_tests)
  add_test(NAME core COMMAND gnumbat_core_tests --conformance ${GNUMBAT_CONFORMANCE_DIR})
endif()

if(GNUMBAT_BUILD_PLUGIN)
  include(plugin/plugin.cmake)
endif()
