# Speculative Layer — Cricket Protein & CRKT Token Economy

> This document captures an exploratory business concept attached to the EBYS project. It is not part of the active protocol or instrument documentation. Nothing here is implemented or committed. It is preserved as a possible future direction.

---

## The Concept in One Paragraph

EBYS artists and DJs earn tips through the tipping protocol. As an optional second layer, those earnings could be converted into a stake in a cricket protein powder company — a cooperative where the people who create value (the music community) are the same people who receive the margin. The token is called CRKT. It is earned, not bought. The powder company exists to give artists a tangible economic stake that grows with the community, independent of streaming revenue or label deals.

---

## Cricket Protein Powder Company

A company that sells cricket protein powder and distributes its margin to CRKT holders — artists and DJs who earned tokens through the tipping protocol.

The powder company is community infrastructure. It exists to support artists, not to extract from them. EBYS covers its operating costs and nothing more. Everything left flows out to CRKT holders.

No membership. No obligations. No contract. You hold CRKT, you receive a share of powder margin monthly. You are free.

### Where EBYS Makes Money

From the powder company, EBYS deducts actual operating costs only — supplier management, infrastructure, payment processing. No percentage cut on top. The remainder goes entirely to CRKT holders, including EBYS's own founder stake earned through curation.

### The Loop

```
EBYS builds the instrument and the protocol
    ↓
DJs perform, artists submit music
    ↓
Community grows, brand spreads
    ↓
Listeners tip sets → dollars flow through the protocol
    ↓
Artists and DJs choose: cash out in dollars or convert to CRKT
    ↓
Powder sells → margin distributes to all CRKT holders monthly
    ↓
Artists earn from powder without thinking about powder
    ↓
Community has a reason to keep participating
```

### Distribution Mechanics

```
Powder sells
    ↓
EBYS deducts actual operating costs
Remainder → 100% to distribution pool
    ↓
Each holder receives: (their CRKT / total CRKT) × distribution pool
```

Distribution is monthly, automatic, on-chain. It arrives in your wallet. You don't claim it. When revenue is zero, distribution is zero.

---

## CRKT — Earned, Not Bought

CRKT is not on any exchange. You cannot buy it. The only way to get it is to earn it through tips via the tipping protocol.

This means:
- No passive buyers diluting the pool
- No speculation
- No buyout scenario
- No whale dominance through money
- Accumulation reflects actual community appreciation, nothing else

### How You Earn CRKT

Tips from listeners flow through the tipping protocol. Artists and DJs receive their share in dollars. Each recipient then chooses:

```
Receive dollars   → cash out to bank account, no crypto involved
Convert to CRKT   → connect a Solana wallet, become a powder company stakeholder
```

Converting is opt-in. An artist who just wants to get paid gets paid in dollars. An artist who believes in the project connects a wallet, converts to CRKT, and starts earning from powder sales.

### Two Tip Contexts

**EBYS Context — Full Split:** EBYS has full visibility into the mix. When a listener tips an EBYS set, the split is calculated automatically across the DJ and every contributing artist. Each recipient independently chooses: dollars or CRKT.

**External Context — DJ Only:** A DJ performing on other gear. The protocol has no visibility. The tip goes to the DJ. Full stop. This is honest about what the system can and can't see — and makes EBYS genuinely valuable to artists who want their music to earn from tips even when they're not performing.

### Escrow

Artists who haven't set up a payment method yet still accumulate earnings on the platform. When they're ready, they connect a bank account (for dollars) or a Solana wallet (for CRKT). Everything that accrued releases at that point. No expiry. No fees.

### EBYS's Position

EBYS built the protocol and runs one instance of it. It does not hold a CRKT founding stake. It earns CRKT the same way a curator does — by running sets, by the community tipping those sets, by choosing to convert earnings to CRKT rather than cash out.

---

## Why Cricket Protein

### vs. Lab-Grown Meat

Lab-grown meat is capital-intensive, requires cold chain at scale, and is still working through regulatory approval in most markets. It reproduces the industrial meat model: centralized production, large capital requirement, equity structure that extracts rather than distributes.

Cricket protein sidesteps this entirely.

| Factor | Cricket protein | Lab-grown meat | Conventional animal |
|--------|----------------|----------------|---------------------|
| Land use | Minimal | Facility-dependent | High |
| Water use | Very low | Moderate | Very high (beef: 1800L/kg) |
| GHG emissions | ~1% of beef | ~50% of beef (current) | High |
| Feed conversion | ~2:1 | ~3–10:1 (current) | ~7:1 (beef) |
| Capital to start | Low | Very high | Moderate |
| Regulatory path | Clear (Canada, EU) | In progress | Clear |

### The Cooperative Structure

**Traditional food company:** investor capital → build supply chain → market → extract margin → return to investors.

**EBYS model:** artist and DJ community → organic brand exposure → powder sales → margin distributes back to the community (via CRKT) → community grows.

There are no external investors in the margin distribution. EBYS covers costs. Everything else flows out to CRKT holders. The supplier relationship is white-label at first — Entomo Farms or equivalent — to remove production risk entirely. EBYS handles brand, distribution, and community.

### The Climate Loop

The EBYS remixing engine temperature trigger:

```
entropy = clamp(0.5 + (δT / 5.0), 0.0, 1.0)
```

Where δT = today's temperature − 10-year rolling average for this date.

Hot planet: more entropy, more composite mixes, more curator activity, higher tip probability, more CRKT conversions.

Cool planet (climate win): more powder sales from a credible climate narrative. Either state benefits CRKT holders — EBYS doesn't profit from climate failure.

### The Community as Sales Force

Artists don't pitch powder. They perform. A DJ performs, their audience watches, the radio page has the buy link. The instrument is named after eating bugs. It travels naturally.

The social experiment: people who push boundaries in taste (artists, DJs, experimental music communities) are the right early adopters for insect protein. This is not influencer marketing — no one is paid to say they eat cricket powder. It's an ecosystem alignment: the people who earn from the protocol have an interest in the protocol's success.

---

## Supplier Research

### Draft Email — Entomo Farms Wholesale Inquiry

**To:** info@entomofarms.com
**Subject:** White Label Cricket Powder — Inquiry

---

Hi,

My name is Alex G. I'm building EBYS (Eat Bugs You Spider!), a neural DJ deck and web radio for the Montreal music scene. It's a research-creation project at the intersection of AI, music technology, and open-source software.

Cricket protein powder is the commercial backbone. The radio, the deck, and the community of DJs and artists that form around it — the pollinators — are the marketing channel. The project includes an open tipping protocol that lets listeners tip DJ sets directly, with the tip automatically split between the DJ and the contributing artists. Artists and DJs who earn tips can convert those earnings into a revenue share from EBYS cricket powder sales.

Artists who push the boundaries of taste seem like the right people to push cricket protein into the mainstream. That is the social experiment at the center of the project.

I'm in early stages of development and want to understand what's solid before I code this web.

A few questions:

- Do you offer white label drop-shipping — sealed, branded, shipped directly to the customer?
- If so, what are per-unit costs for drop-ship orders?
- Otherwise, what are minimum order quantities and pricing for bulk wholesale?

Happy to share more about the project if useful.

Thanks! :D🦗

Alex G.
eatbugsyouspider@proton.me

---

## Revenue Model (if implemented)

If this layer is ever activated, it slots into the EBYS revenue stack as:

```
Scales with community:
→ Powder + CRKT distributions (margin from sales → CRKT holders)

Foundation:
→ Tipping protocol (same as active protocol, CRKT conversion is opt-in layer on top)
```

On-chain implementation not started. Escrow model is in the database (tip earnings accumulate in `ebys.db`, artist claims and chooses cash vs. CRKT when they onboard). Solana wallet field exists in the `users` table.
