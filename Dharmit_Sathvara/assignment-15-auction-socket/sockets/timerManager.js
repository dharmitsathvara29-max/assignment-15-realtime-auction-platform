/**
 * timerManager.js — Server-Side Countdown Timer & Auction Lifecycle
 *
 * Exports:
 *   startAuctionTimer(io, auction)  – starts per-auction setInterval
 *   stopAuctionTimer(auction)       – clears the interval (cleanup helper)
 *
 * Timer behaviour:
 *   • Fires every 1 000 ms.
 *   • Decrements auction.timeRemainingSeconds (never below 0).
 *   • Broadcasts "auction:time_tick" to the auction room every tick.
 *   • When timeRemainingSeconds reaches 0:
 *       – Clears the interval and nulls timerInterval.
 *       – Sets auction.status = "ended".
 *       – Broadcasts "auction:sold" to the room.
 *         · If a highest bidder exists  → { winner, finalPrice, status: "sold" }
 *         · If NO bids were placed      → { winner: null, finalPrice: startingPrice, status: "unsold" }
 *         (The "unsold" path is documented in README.md.)
 */

/**
 * startAuctionTimer
 * @param {import("socket.io").Server} io
 * @param {object} auction  – reference to the live auction object in the shared store
 */
function startAuctionTimer(io, auction) {
  // Guard: do not start a second timer if one is already running
  if (auction.timerInterval !== null) return;

  auction.timerInterval = setInterval(() => {
    // ── 1. Tick ──────────────────────────────────────────────────────────
    if (auction.timeRemainingSeconds > 0) {
      auction.timeRemainingSeconds -= 1;
    }

    // ── 2. Broadcast tick to room ─────────────────────────────────────────
    io.to(auction.id).emit("auction:time_tick", {
      auctionId: auction.id,
      timeRemaining: auction.timeRemainingSeconds,
    });

    // ── 3. Auction ends ───────────────────────────────────────────────────
    if (auction.timeRemainingSeconds <= 0) {
      // Stop the timer first to prevent re-entry
      clearInterval(auction.timerInterval);
      auction.timerInterval = null;
      auction.status = "ended";

      if (auction.highestBidder) {
        // Reserve met — auction sold to highest bidder
        io.to(auction.id).emit("auction:sold", {
          winner: auction.highestBidder.username,
          finalPrice: auction.currentBid,
          status: "sold",
        });
      } else {
        // No bids placed — item goes unsold
        io.to(auction.id).emit("auction:sold", {
          winner: null,
          finalPrice: auction.startingPrice,
          status: "unsold",
        });
      }
    }
  }, 1000);
}

/**
 * stopAuctionTimer
 * Clears an auction's running interval (useful for cleanup on shutdown or restart).
 * @param {object} auction
 */
function stopAuctionTimer(auction) {
  if (auction.timerInterval !== null) {
    clearInterval(auction.timerInterval);
    auction.timerInterval = null;
  }
}

module.exports = { startAuctionTimer, stopAuctionTimer };
