# Included from ../CMakeLists.txt when GNUMBAT_BUILD_PLUGIN is ON.
juce_add_plugin(GnumbatPlugin
    COMPANY_NAME "Gnumbat"
    PLUGIN_MANUFACTURER_CODE Gnmb
    PLUGIN_CODE Gnbt
    FORMATS VST3 Standalone
    PRODUCT_NAME "M-RLCF"   # shown in hosts as "M-RLCF (Gnumbat)"; codes below unchanged so saved projects still load
    BUNDLE_ID org.gnumbat.plugin
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    VST3_CATEGORIES "Fx" "Analyzer"
    COPY_PLUGIN_AFTER_BUILD TRUE)

target_sources(GnumbatPlugin PRIVATE ${GNUMBAT_PLUGIN_SOURCES})

# CMAKE_CURRENT_SOURCE_DIR here is still src/plugin (this file is include()-d, not
# add_subdirectory()-d, from ../CMakeLists.txt) -- ../.. from there is the EBYS repo root.
get_filename_component(GNUMBAT_EBYS_ROOT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)

target_compile_definitions(GnumbatPlugin PUBLIC
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    GNUMBAT_VERSION="${PROJECT_VERSION}"
    GNUMBAT_BUILTIN_EBYS_ROOT="${GNUMBAT_EBYS_ROOT_DIR}")

target_link_libraries(GnumbatPlugin
    PRIVATE juce::juce_audio_utils juce::juce_cryptography
    PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_warning_flags)
