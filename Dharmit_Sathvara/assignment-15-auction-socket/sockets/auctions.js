/**
 * auctions.js — In-Memory Auction State Store
 *
 * Single source of truth shared between auctionEngine.js and timerManager.js.
 * Both socket files require THIS module so they share the exact same object
 * reference (Node's module cache guarantees one instance per process).
 */

const auctions = {
  // ── Auction 1 ────────────────────────────────────────────────────────────
  AUC_VINTAGE_99: {
    id: "AUC_VINTAGE_99",
    title: "1967 Vintage Fender Stratocaster",
    description:
      "Original condition rare electric guitar – one of fewer than 200 surviving examples in pristine sunburst finish. Includes original hardshell case and authentication certificate.",
    imageUrl: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600&q=80",
    startingPrice: 50000,
    currentBid: 50000,
    highestBidder: null, // { socketId, username }
    minIncrement: 2000,
    timeRemainingSeconds: 120,
    status: "active", // "upcoming" | "active" | "ended"
    bidHistory: [],
    timerInterval: null,
    viewers: new Set(), // tracks connected socket IDs for totalViewers count
  },

  // ── Auction 2 ────────────────────────────────────────────────────────────
  AUC_ROLEX_DAYTONA: {
    id: "AUC_ROLEX_DAYTONA",
    title: "Rolex Daytona 1972 – Ref. 6263",
    description:
      'Paul Newman Daytona with exotic "lemon" dial. Unworn, double-sealed. Full set: papers, original bracelet, hang tags. One of the rarest references ever produced.',
    imageUrl: "https://images.unsplash.com/photo-1547996160-81dfa63595aa?w=600&q=80",
    startingPrice: 250000,
    currentBid: 250000,
    highestBidder: null,
    minIncrement: 10000,
    timeRemainingSeconds: 180,
    status: "active",
    bidHistory: [],
    timerInterval: null,
    viewers: new Set(),
  },
};

/**
 * getAuction(auctionId) — safe lookup helper
 * Returns the auction object or undefined if not found.
 */
function getAuction(auctionId) {
  return auctions[auctionId];
}

module.exports = { auctions, getAuction };
