#pragma once
// Model lineage browsing/creation. A "Model" (gnumbat.model/0.1, schema/model.schema.json) is a
// named lineage; the plugin's own "<" menu (see ui::ModelMenu) lets the user browse and branch
// these to organise different creative directions ("genres") for what's eventually trained on
// this library's Bakes. There is no training pipeline behind this yet -- ModelVersion
// (model_version.schema.json), the actual trained-artifact record with its dataset/architecture/
// training-state fields, is the next layer once one exists. For now a Model is just a name and a
// place in the tree: `parent_model_id` is Gnumbat's own extension of model.json, not (yet) one of
// the schema's own listed properties, but the schema's `additionalProperties: true` allows it, so
// nothing else reading model.json breaks by its being there.
#include <juce_core/juce_core.h>
#include <vector>

namespace gnumbat
{
    struct ModelInfo
    {
        juce::String id, name, description, creator, parentId;   // parentId empty => a root/seed
        juce::int64 createdAtMs = 0, modifiedAtMs = 0;
        juce::StringArray votesUp, votesDown;   // who voted which way (one slot per user) -- same scheme as a Bake's votes
    };

    /** Every model.json found under models/<id>/ beneath the library root, oldest first. A
        record that fails to parse (missing/malformed) is skipped rather than aborting the whole
        listing. */
    std::vector<ModelInfo> listModels (const juce::File& libraryRoot);

    /** Creates a new Model, writing model.json under models/<id>/ beneath the library root.
        `parentId` empty starts a fresh, independent lineage (a "seed"); otherwise the new Model
        branches from it. `idOut` receives the new id. */
    juce::Result createModel (const juce::File& libraryRoot, const juce::String& name, const juce::String& parentId, juce::String& idOut);

    /** Rewrites a Model's votes_up / votes_down lists in its model.json (a vote is not an edit, so
        modified_at is left alone). */
    /** One-time privacy migration: everywhere this library recorded `from` (the OS login name the
        plugin used to write) -- Model creators and votes, Bake created_by and votes -- write `to`
        (Settings::localIdentity()) instead. History files are left as they were. Returns the number
        of files changed. */
    int replaceIdentity (const juce::File& libraryRoot, const juce::String& from, const juce::String& to);

    juce::Result setModelVotes (const juce::File& libraryRoot, const juce::String& id, const juce::StringArray& up, const juce::StringArray& down);
}
