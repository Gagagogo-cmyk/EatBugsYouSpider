/**
 * carbon-config.js — deploy-time constants for the carbon indicator.
 *
 * Nothing in here is computed live. GREEN_HOSTING is set by running
 * scripts/check-green-hosting.js against whatever's currently in Railway's
 * DNS/hosting chain, and re-run only when you change hosting providers —
 * not on a schedule, not per request. INSTRUMENT_GCO2_PER_LISTENER_HOUR is
 * a measured number, not a guess — see docs/platform/SUSTAINABILITY.md
 * §"The AI-compute honesty layer" for how to measure it (powermetrics /
 * nvidia-smi power draw around a real Demucs+Ollama session). Until you've
 * measured it, leave it null — the header should say "front-end only" in
 * that state rather than imply a made-up total.
 */
export const GREEN_HOSTING = false; // TODO: run scripts/check-green-hosting.js and update

export const INSTRUMENT_GCO2_PER_LISTENER_HOUR = null; // TODO: measure, see doc
