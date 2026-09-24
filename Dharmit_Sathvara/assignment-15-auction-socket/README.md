# 🏷️ Real-Time Live Auction & Bidding Engine

A mission-critical, low-latency real-time live auction & bidding platform built with **Node.js**, **Express.js**, and **Socket.io**.

---
Live link : https://assignment-15-realtime-auction-platform-8st8.onrender.com

## 📦 Setup & Running

```bash
# 1. Install dependencies
npm install

# 2. Development (auto-restart on file change)
npm run dev

# 3. Production
npm start
```

> Server starts at **http://localhost:5000**

Copy `.env.example` → `.env` if you need a custom port:
```bash
cp .env.example .env
```

---

## 🏗️ Project Structure

```
assignment-15-auction-socket/
├── public/
│   ├── index.html       ← Trading-floor UI
│   ├── app.js           ← Socket.io client logic
│   └── style.css        ← Dark trading-floor styles
├── sockets/
│   ├── auctions.js      ← Shared in-memory state store
│   ├── auctionEngine.js ← Bid validation & socket handlers
│   └── timerManager.js  ← Per-auction countdown timer
├── server.js            ← Express + Socket.io entry point
├── .env.example
├── .gitignore
└── package.json
```

---

## 🎮 3-Tab Testing Walkthrough

### Setup
1. Start the server: `npm run dev`
2. Open three browser tabs all pointing to `http://localhost:5000`

### Tab 1 — Bidder: Vikram
- Enter name **Vikram** → default auction `AUC_VINTAGE_99` loads
- Starting bid: ₹50,000 | Min increment: ₹2,000

### Tab 2 — Bidder: Ananya
- Enter name **Ananya** → joins the same room
- Viewer count badge now shows **2**

### Tab 3 — Viewer: Viewer C
- Enter any name (e.g. **Viewer C**) → joins as observer
- Viewer count badge shows **3**

### Scenario Steps

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Vikram bids ₹52,000 | All 3 tabs show current bid → ₹52,000; Vikram sees "You are now the highest bidder" |
| 2 | Ananya bids ₹54,000 | All 3 tabs update; **Vikram gets private outbid banner** with audio beep |
| 3 | Vikram tries to bid ₹54,500 | Toast: "Bid too low. Minimum valid bid is ₹56,000" |
| 4 | Ananya tries to bid again | Toast: "You are already the highest bidder" |
| 5 | Timer drops to 10s → Vikram bids ₹58,000 | Timer jumps back to 20s; **Anti-snipe banner** fires on all tabs |
| 6 | Timer hits 0 | `auction:sold` fires → bid input disabled; SOLD overlay shows winner + final price |

**Second auction** — navigate to `http://localhost:5000?auctionId=AUC_ROLEX_DAYTONA` to test with the Rolex auction (starting ₹2,50,000 | increment ₹10,000).

---

## 📡 Full Event Protocol

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `auction:join` | `{ auctionId, username }` | Join the bidding floor room |
| `bid:place` | `{ auctionId, amount }` | Place a new bid |

### Server → Client (targeted)

| Event | Payload | Description |
|-------|---------|-------------|
| `auction:init` | `{ item, bidHistory, timeRemaining }` | Hydrates state for the joining client only |
| `bid:rejected` | `{ reason }` | Validation failure — sent only to the offending bidder |
| `bid:outbid` | `{ message }` | Private alert sent only to the displaced highest bidder |
| `auction:error` | `{ message }` | Room not found / invalid payload |

### Server → Room (broadcast)

| Event | Payload | Description |
|-------|---------|-------------|
| `auction:time_tick` | `{ auctionId, timeRemaining }` | Every 1 second |
| `user:joined` | `{ username, totalViewers }` | On new join |
| `user:left` | `{ username, totalViewers }` | On disconnect |
| `bid:success` | `{ currentBid, highestBidder, bidHistory, timeRemaining }` | New top bid |
| `auction:extended` | `{ timeRemaining, message }` | Anti-snipe clock reset |
| `auction:sold` | `{ winner, finalPrice, status }` | Auction ended |

---

## ⚡ Anti-Snipe Rule

> If a bid is placed when `timeRemainingSeconds < 15`, the server resets the timer to **20 seconds** and broadcasts `auction:extended` to the whole room.

This prevents last-second bid sniping by extending the window for competing bidders.

---

## 📋 Documented Behavior

### No-Winner / Unsold Case
If the auction clock reaches 0 and **no bids** were placed (`auction.highestBidder === null`), the server emits:
```json
{ "winner": null, "finalPrice": <startingPrice>, "status": "unsold" }
```
The client shows a "NO SALE" overlay instead of the SOLD banner.

### Disconnect Handling
On socket disconnect:
- The socket's ID is removed from `auction.viewers`.
- A `user:left` event is broadcast to the remaining room members with the updated `totalViewers` count.
- The client side listens for `user:left` (same as `user:joined`) to update the viewer badge.
- If the disconnected user was the highest bidder, **their bid remains valid** — the server retains their username as `highestBidder`. Their socket ID is no longer valid for future direct messages, so any future outbid alert will simply not be delivered (graceful no-op).

### Race Condition Prevention
All bid validation and state mutation in `handleBidPlacement()` is **synchronous** (zero `await` in the critical section). Node.js's single-threaded event loop guarantees each handler runs to completion before the next fires — so two near-simultaneous bids from different clients are processed in strict received order with no TOCTOU vulnerability.

---

## 🚀 Deploy to Render

1. Push to GitHub (see submission instructions).
2. Render → New Web Service → select repo.
3. **Root Directory**: `Dharmit_Sathvara/assignment-15-auction-socket`
4. **Build Command**: `npm install`
5. **Start Command**: `npm start`
6. No environment variables needed (Render sets `PORT` automatically).

> ⚠️ Free-tier Render instances spin down after inactivity. Visit the URL once before your demo to wake the instance. In-memory auction state resets on each cold start.

---

## 🛡️ Grading Checklist

| Component | ✅ |
|-----------|---|
| Real-time bid processing & validation engine (race-condition-safe) | ✅ |
| Server-side countdown timer & anti-snipe mechanism | ✅ |
| Targeted outbid notifications & live room broadcasting | ✅ |
| Auditable bid history feed & live viewer counter | ✅ |
| Trading floor UI polish, audio/visual cues | ✅ |
