/**
 * server.js — Entry Point
 *
 * Responsibilities:
 *   1. Create an Express app that serves /public as static files.
 *   2. Wrap it in a Node http.Server + attach Socket.io (with CORS).
 *   3. Boot per-auction timers for all seeded "active" auctions.
 *   4. Wire every new socket connection through registerAuctionHandlers.
 *   5. Listen on process.env.PORT || 5000.
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const path = require("path");
const cors = require("cors");
const { Server } = require("socket.io");

const { auctions } = require("./sockets/auctions");
const { startAuctionTimer } = require("./sockets/timerManager");
const { registerAuctionHandlers } = require("./sockets/auctionEngine");

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Health-check endpoint (handy for Render)
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── HTTP + Socket.io ──────────────────────────────────────────────────────────
const httpServer = http.createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// ── Boot auction timers ───────────────────────────────────────────────────────
// All seeded auctions with status "active" start their countdown immediately.
Object.values(auctions).forEach((auction) => {
  if (auction.status === "active") {
    startAuctionTimer(io, auction);
    console.log(
      `⏱  Timer started for auction [${auction.id}] — ${auction.timeRemainingSeconds}s remaining`
    );
  }
});

// ── Socket.io connection handler ──────────────────────────────────────────────
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  registerAuctionHandlers(io, socket);
});

// ── Start server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║   🏷️  Real-Time Auction & Bidding Engine          ║");
  console.log(`║   🚀  Server running on http://localhost:${PORT}   ║`);
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`📦  ${Object.keys(auctions).length} auction(s) seeded and live.`);
});
