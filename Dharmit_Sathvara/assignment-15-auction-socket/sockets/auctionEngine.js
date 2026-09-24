/**
 * auctionEngine.js — Core Bidding Logic & Socket Event Handlers
 *
 * Exports:
 *   registerAuctionHandlers(io, socket)
 *
 * Events handled (client → server):
 *   "auction:join"   { auctionId, username }
 *   "bid:place"      { auctionId, amount }
 *   "disconnect"     (built-in)
 *
 * Events emitted (server → client/room):
 *   "auction:init"     → joining socket only
 *   "user:joined"      → whole room  (on join AND on disconnect, see below)
 *   "auction:error"    → offending socket only
 *   "bid:rejected"     → offending socket only
 *   "bid:success"      → whole room
 *   "bid:outbid"       → previous highest bidder's socket only
 *   "auction:extended" → whole room
 *
 * Disconnect behaviour (documented in README):
 *   On disconnect the socket's id is removed from auction.viewers and a
 *   "user:left" event is broadcast to the room with { totalViewers }.
 *   The client side treats "user:left" identically to the viewer-count
 *   section of "user:joined" (both carry totalViewers).
 */

const { getAuction } = require("./auctions");

// ─────────────────────────────────────────────────────────────────────────────
// Authoritative Bid Handler (synchronous – no awaited I/O in critical section)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * handleBidPlacement
 *
 * Validates and applies a bid.  All steps run synchronously so two near-
 * simultaneous bids from different sockets are processed in strict received
 * order with no race condition (Node's event loop runs each handler to
 * completion before dispatching the next).
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 * @param {object} auction   – live auction object from shared store
 * @param {number} bidAmount – amount submitted by the client
 * @param {string} username  – bidder's display name (stored on socket)
 */
function handleBidPlacement(io, socket, auction, bidAmount, username) {
  // ── 1. Auction must be active ─────────────────────────────────────────────
  if (auction.status !== "active" || auction.timeRemainingSeconds <= 0) {
    return socket.emit("bid:rejected", { reason: "Auction is closed" });
  }

  // ── 2. Self-outbid prohibition ────────────────────────────────────────────
  if (
    auction.highestBidder &&
    auction.highestBidder.socketId === socket.id
  ) {
    return socket.emit("bid:rejected", {
      reason: "You are already the highest bidder",
    });
  }

  // ── 3. Minimum increment enforcement ─────────────────────────────────────
  const minimumRequired = auction.currentBid + auction.minIncrement;
  if (bidAmount < minimumRequired) {
    return socket.emit("bid:rejected", {
      reason: `Bid too low. Minimum valid bid is ₹${minimumRequired.toLocaleString("en-IN")}`,
    });
  }

  // ── 4. Capture previous highest bidder before overwriting ─────────────────
  const previousBidder = auction.highestBidder;

  // ── 5. Update authoritative state ─────────────────────────────────────────
  auction.currentBid = bidAmount;
  auction.highestBidder = { socketId: socket.id, username };
  auction.bidHistory.unshift({
    bidder: username,
    amount: bidAmount,
    timestamp: new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
  });

  // ── 6. Anti-Snipe Rule ────────────────────────────────────────────────────
  // If a bid arrives in the final 15 s, reset the clock to 20 s and alert room.
  if (auction.timeRemainingSeconds < 15) {
    auction.timeRemainingSeconds = 20;
    io.to(auction.id).emit("auction:extended", {
      timeRemaining: 20,
      message: "⚡ Bid in final seconds: Timer extended by 20s!",
    });
  }

  // ── 7. Broadcast new top bid to WHOLE room ─────────────────────────────────
  io.to(auction.id).emit("bid:success", {
    currentBid: auction.currentBid,
    highestBidder: username,
    bidHistory: auction.bidHistory,
    timeRemaining: auction.timeRemainingSeconds,
  });

  // ── 8. Private outbid alert to the displaced highest bidder ───────────────
  if (previousBidder && previousBidder.socketId !== socket.id) {
    io.to(previousBidder.socketId).emit("bid:outbid", {
      message: `You were outbid by ${username} with ₹${bidAmount.toLocaleString("en-IN")}!`,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Socket Handler Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * registerAuctionHandlers
 * Called once per new socket connection from server.js.
 *
 * @param {import("socket.io").Server} io
 * @param {import("socket.io").Socket} socket
 */
function registerAuctionHandlers(io, socket) {
  // ── auction:join ──────────────────────────────────────────────────────────
  socket.on("auction:join", ({ auctionId, username } = {}) => {
    // Validate inputs
    if (!auctionId || !username) {
      return socket.emit("auction:error", {
        message: "auctionId and username are required to join.",
      });
    }

    const auction = getAuction(auctionId);
    if (!auction) {
      return socket.emit("auction:error", {
        message: `Auction "${auctionId}" does not exist.`,
      });
    }

    // Join the Socket.io room for this auction
    socket.join(auctionId);

    // Store context on the socket instance for disconnect cleanup
    socket.auctionId = auctionId;
    socket.username = username;

    // Track this viewer
    auction.viewers.add(socket.id);

    // ── Send current state to the JOINING client only ─────────────────────
    socket.emit("auction:init", {
      item: {
        id: auction.id,
        title: auction.title,
        description: auction.description,
        imageUrl: auction.imageUrl,
        startingPrice: auction.startingPrice,
        currentBid: auction.currentBid,
        highestBidder: auction.highestBidder
          ? auction.highestBidder.username
          : null,
        minIncrement: auction.minIncrement,
        status: auction.status,
      },
      bidHistory: auction.bidHistory,
      timeRemaining: auction.timeRemainingSeconds,
    });

    // ── Broadcast updated viewer count to WHOLE room ──────────────────────
    io.to(auctionId).emit("user:joined", {
      username,
      totalViewers: auction.viewers.size,
    });
  });

  // ── bid:place ─────────────────────────────────────────────────────────────
  socket.on("bid:place", ({ auctionId, amount } = {}) => {
    if (!auctionId || amount == null) {
      return socket.emit("bid:rejected", {
        reason: "Invalid bid payload (auctionId and amount required).",
      });
    }

    const auction = getAuction(auctionId);
    if (!auction) {
      return socket.emit("bid:rejected", {
        reason: `Auction "${auctionId}" not found.`,
      });
    }

    const username = socket.username || "Anonymous";
    handleBidPlacement(io, socket, auction, Number(amount), username);
  });

  // ── disconnect ────────────────────────────────────────────────────────────
  // Remove the socket from the viewer set and broadcast the updated count.
  // We emit "user:left" (shape: { totalViewers }) so the client can update
  // the viewer badge.  This is documented in README.md.
  socket.on("disconnect", () => {
    const { auctionId, username } = socket;
    if (!auctionId) return; // socket never joined an auction room

    const auction = getAuction(auctionId);
    if (!auction) return;

    auction.viewers.delete(socket.id);

    // Broadcast reduced viewer count to remaining room members
    io.to(auctionId).emit("user:left", {
      username,
      totalViewers: auction.viewers.size,
    });
  });
}

module.exports = { registerAuctionHandlers };
