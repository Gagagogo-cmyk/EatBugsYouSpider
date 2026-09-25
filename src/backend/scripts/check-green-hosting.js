#!/usr/bin/env node
/**
 * check-green-hosting.js — run this by hand (or from CI on deploy), not
 * from the running server. It's the one place this project makes a live
 * call to a third-party API for the carbon indicator: the Green Web
 * Foundation's Greencheck API, which answers "is this domain served by a
 * renewable-powered / offset host?" The answer is a fact about your
 * hosting provider, not about any given visitor, so there's no reason to
 * ask it more than once per deploy/provider-change.
 *
 * Usage:
 *   cd src/backend
 *   npm install --no-save @tgwf/co2   (not a runtime dependency — dev-only)
 *   node scripts/check-green-hosting.js eatbugsyouspider.com
 *
 * Then hand-copy the boolean it prints into
 * src/frontend/eco/carbon-config.js (GREEN_HOSTING).
 *
 * Why not call this at runtime instead: it would mean every single visit
 * makes an extra network round-trip to a third party just to render a
 * badge whose whole point is minimizing extra network round-trips. Baking
 * the (rarely-changing) answer into a static constant costs zero bytes and
 * zero requests per visitor.
 */
const { check } = require("@tgwf/co2/hosting");

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: node check-green-hosting.js <domain>");
  console.error("Example: node check-green-hosting.js eatbugsyouspider.com");
  process.exit(1);
}

check(domain, { verbose: true, userAgentIdentifier: "gnumbat-sustainability-check" })
  .then((result) => {
    console.log(JSON.stringify(result, null, 2));
    const green = Array.isArray(result) ? result.length > 0 : !!(result && result.green);
    console.log(
      `\n→ ${domain}: ${green ? "GREEN" : "not green"}. Set GREEN_HOSTING = ${green} in src/frontend/eco/carbon-config.js`
    );
    if (!green) {
      console.log(
        "  If this is wrong or you've since moved hosts, the Green Web Foundation lets hosting\n" +
          "  providers register at https://www.thegreenwebfoundation.org/ — worth checking whether\n" +
          "  Railway's underlying region/provider is listed before assuming 'not green'."
      );
    }
  })
  .catch((err) => {
    console.error("Green hosting check failed:", err.message);
    process.exit(1);
  });
