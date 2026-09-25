"""Gnumbat Core — reference implementation (Python) of the Bake / dataset / model contracts.

The contracts are the JSON Schemas in ``schemas/``; this package is one implementation of
them. The JUCE plugin (src/plugin) is another. Both are checked against ``conformance/``.
"""

__version__ = "0.1.0"

# Version strings stamped into documents. Bump the *major* only for breaking layout changes.
LIBRARY_SCHEMA = "gnumbat.library/0.1"
