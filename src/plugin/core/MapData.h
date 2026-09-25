#pragma once
// Bake Map data. The projection (standardise -> PCA -> t-SNE, or UMAP later) is computed by the WORKER
// and stored under derived/maps/<feature_set_id>.json; the plugin only reads and draws it. That keeps
// heavy maths off the DAW process and makes the projection method replaceable without touching the UI.
#include <juce_core/juce_core.h>
#include <vector>

namespace gnumbat
{
    struct MapPoint { juce::String bakeId; float x = 0.f, y = 0.f; };      // x,y in [-1, 1]

    struct MapDoc
    {
        bool valid = false;
        juce::String mapId, featureSetId, label, method, requestedMethod, note, disclaimer, createdAt;
        bool hasTrust = false;
        double trustworthiness = 0.0;
        std::vector<MapPoint> points;
        std::vector<std::pair<juce::String, juce::String>> excluded;      // bake id, reason ("no analysis" ...)
        juce::int64 fileStamp = 0;                                        // mtime+size, to detect a new projection
    };

    MapDoc readMap (const juce::File& libraryRoot, const juce::String& featureSetId);
    juce::StringArray listMapFeatureSets (const juce::File& libraryRoot);   // feature sets that have a map on disk
}
