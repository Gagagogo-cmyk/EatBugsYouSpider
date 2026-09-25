/**
 * carbon.js — front-end carbon-per-visit estimate for the Gnumbat site.
 *
 * What this is: a self-contained, zero-dependency reimplementation of the
 * arithmetic in the "Sustainable Web Design v4" model, the same model that
 * powers websitecarbon.com's badge and the Green Web Foundation's official
 * @tgwf/co2 npm package. Constants below are copied verbatim from
 * @tgwf/co2 v0.19.0 (dist/esm/constants/index.js, SWDV4 object) — MIT/OFL
 * licensed, see https://github.com/thegreenwebfoundation/co2.js.
 *
 * Why not just `import` the real package: its browser entry point
 * (dist/esm/index.js) eagerly pulls in per-country/per-year electricity-map
 * datasets — ~420KB across five yearly files — because helpers/index.js
 * imports from the package's own index.js rather than from constants
 * directly. None of that is needed for a single global-average estimate,
 * and shipping 420KB of JSON to compute a number whose entire point is
 * "how little we ship" would be a joke. If you later add a bundler that
 * tree-shakes, swap this file for `import { co2 } from "@tgwf/co2"` and
 * delete this one — the math is identical, this just avoids the payload.
 *
 * No network calls happen here. Green-hosting status is a config constant
 * (GREEN_HOSTING below) baked in at deploy time — see
 * scripts/check-green-hosting.js for how to (re)verify it, and
 * docs/platform/SUSTAINABILITY.md for why that check runs at deploy time
 * and not on every page load.
 */

// --- SWDv4 constants (@tgwf/co2 v0.19.0, SWDV4) ---------------------------
const GB = 1_000_000_000; // fileSize.GIGABYTE in co2.js — decimal GB, not GiB
const SWDV4 = {
  OPERATIONAL_KWH_PER_GB_DATACENTER: 0.055,
  OPERATIONAL_KWH_PER_GB_NETWORK: 0.059,
  OPERATIONAL_KWH_PER_GB_DEVICE: 0.08,
  EMBODIED_KWH_PER_GB_DATACENTER: 0.012,
  EMBODIED_KWH_PER_GB_NETWORK: 0.013,
  EMBODIED_KWH_PER_GB_DEVICE: 0.081,
  GLOBAL_GRID_INTENSITY: 494, // gCO2e / kWh, world average
};

/**
 * Grams of CO2e for `bytes` transferred in one visit.
 * Mirrors @tgwf/co2's `perByte()` / un-optioned `perVisit()` exactly —
 * same inputs produce the same output as the real package.
 *
 * @param {number} bytes - transferred bytes for the page (see measurePageBytes)
 * @param {boolean} green - true if the serving host is on the Green Web
 *   Foundation's green hosting directory (see GREEN_HOSTING below)
 * @returns {number} grams of CO2e
 */
export function gramsCO2PerVisit(bytes, green = false) {
  if (!bytes || bytes < 1) return 0;
  const gb = bytes / GB;
  const greenFactor = green ? 1 : 0;

  const opDataCenter = gb * SWDV4.OPERATIONAL_KWH_PER_GB_DATACENTER;
  const opNetwork = gb * SWDV4.OPERATIONAL_KWH_PER_GB_NETWORK;
  const opDevice = gb * SWDV4.OPERATIONAL_KWH_PER_GB_DEVICE;

  const emDataCenter = gb * SWDV4.EMBODIED_KWH_PER_GB_DATACENTER;
  const emNetwork = gb * SWDV4.EMBODIED_KWH_PER_GB_NETWORK;
  const emDevice = gb * SWDV4.EMBODIED_KWH_PER_GB_DEVICE;

  // Green hosting zeroes only the *operational* data-center share (the
  // assumption being renewable-powered infra), not embodied/manufacturing
  // emissions, network, or the visitor's own device — same as upstream.
  const kwh =
    opDataCenter * (1 - greenFactor) +
    emDataCenter +
    opNetwork +
    emNetwork +
    opDevice +
    emDevice;

  return kwh * SWDV4.GLOBAL_GRID_INTENSITY;
}

/**
 * Sums real transferred bytes for the current page load using the
 * Performance API — actual bytes over the wire, not a guess from disk
 * sizes. Falls back to 0 if the API is unsupported (very old browsers),
 * in which case the caller should hide the indicator rather than show a
 * fabricated number.
 *
 * @returns {number} bytes
 */
export function measurePageBytes() {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return 0;
  }
  let total = 0;
  const nav = performance.getEntriesByType("navigation")[0];
  if (nav && nav.transferSize) total += nav.transferSize;
  for (const r of performance.getEntriesByType("resource")) {
    // transferSize is 0 for cross-origin resources without Timing-Allow-Origin
    // and for cached responses — this slightly *undercounts*, which is the
    // safe direction for a number you're using to hold yourself accountable.
    total += r.transferSize || 0;
  }
  return total;
}

/**
 * Formats grams for display: enough precision to be meaningful at Gnumbat's
 * scale (fractions of a gram) without false-precision digits.
 */
export function formatGrams(g) {
  if (g === 0) return "0g";
  if (g < 0.01) return "<0.01g";
  if (g < 10) return g.toFixed(2) + "g";
  return g.toFixed(1) + "g";
}

/**
 * Convenience one-call helper for wiring into the header. Call after the
 * page has finished loading (e.g. on `window.load`) so resource timing
 * entries are complete.
 *
 * @param {boolean} green - from deploy-time config, see GREEN_HOSTING
 * @returns {{bytes: number, grams: number, label: string}}
 */
export function estimateThisVisit(green) {
  const bytes = measurePageBytes();
  const grams = gramsCO2PerVisit(bytes, green);
  const label = bytes
    ? `~${formatGrams(grams)} CO₂ / visit${green ? " · green host" : ""}`
    : "";
  return { bytes, grams, label };
}
