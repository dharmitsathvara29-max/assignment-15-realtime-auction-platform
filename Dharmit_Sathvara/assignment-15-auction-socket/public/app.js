/**
 * app.js — Trading Floor Client
 *
 * Connects to the Socket.io server, manages all UI updates for the
 * live bidding experience:
 *
 *   • Username modal on load
 *   • auction:join on submit → populates item info via auction:init
 *   • Countdown display updated by auction:time_tick (pulsing red < 15s)
 *   • Live bid history feed via bid:success
 *   • Outbid alert banner via bid:outbid
 *   • Rejection / error toast via bid:rejected
 *   • Anti-snipe banner + timer reset via auction:extended
 *   • SOLD overlay via auction:sold
 *   • Viewer count badge via user:joined / user:left
 */

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

const socket = io(); // connects to the same origin

// Read auctionId from URL query string, default to the Stratocaster auction
const params = new URLSearchParams(window.location.search);
const auctionId = params.get("auctionId") || "AUC_VINTAGE_99";

let myUsername = "";
let timerMax = 120; // updated on auction:init for accurate progress bar

// ─────────────────────────────────────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────────────────────────────────────

const modalOverlay    = document.getElementById("modal-overlay");
const usernameInput   = document.getElementById("username-input");
const modalEnterBtn   = document.getElementById("modal-enter-btn");

const appEl           = document.getElementById("app");
const roomTag         = document.getElementById("room-tag");
const myUsernameEl    = document.getElementById("my-username");
const viewerCount     = document.getElementById("viewer-count");

const itemImage       = document.getElementById("item-image");
const itemTitle       = document.getElementById("item-title");
const itemDesc        = document.getElementById("item-desc");
const statusChip      = document.getElementById("status-chip");
const currentBidEl    = document.getElementById("current-bid");
const minBidHint      = document.getElementById("min-bid-hint");
const timerEl         = document.getElementById("timer");
const timerBar        = document.getElementById("timer-bar");

const bidInput        = document.getElementById("bid-input");
const bidBtn          = document.getElementById("bid-btn");
const quickFill       = document.getElementById("quick-fill");
const rejectionToast  = document.getElementById("rejection-toast");

const bidHistoryList  = document.getElementById("bid-history");
const historyCount    = document.getElementById("history-count");

const outbidBanner    = document.getElementById("outbid-banner");
const outbidMsg       = document.getElementById("outbid-msg");
const antisnipeBanner = document.getElementById("antisnipe-banner");
const antisnipeMsg    = document.getElementById("antisnipe-msg");

const soldOverlay     = document.getElementById("sold-overlay");
const soldTitle       = document.getElementById("sold-title");
const soldWinner      = document.getElementById("sold-winner");
const soldPrice       = document.getElementById("sold-price");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatINR(amount) {
  return "₹" + Number(amount).toLocaleString("en-IN");
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0
    ? `${m}:${String(s).padStart(2, "0")}`
    : `${s}s`;
}

/** Show / hide banner */
function hideBanner(id) {
  document.getElementById(id).classList.add("hidden");
}
window.hideBanner = hideBanner; // expose for onclick in HTML

function showBanner(banner, msgEl, text) {
  msgEl.textContent = text;
  banner.classList.remove("hidden");
  // Auto-dismiss after 6 s
  clearTimeout(banner._dismissTimer);
  banner._dismissTimer = setTimeout(() => banner.classList.add("hidden"), 6000);
}

function showToast(message, isError = true) {
  rejectionToast.textContent = message;
  rejectionToast.classList.remove("hidden");
  rejectionToast.className = "rejection-toast " + (isError ? "toast-error" : "toast-success");
  clearTimeout(rejectionToast._timer);
  rejectionToast._timer = setTimeout(() => {
    rejectionToast.classList.add("hidden");
  }, 4000);
}

/** Flash the price element when bid updates */
function flashPrice() {
  currentBidEl.classList.remove("price-flash");
  // Force reflow so the animation re-triggers
  void currentBidEl.offsetWidth;
  currentBidEl.classList.add("price-flash");
}

/** Update timer display and progress bar, applying urgency CSS below 15 s */
function updateTimer(seconds) {
  timerEl.textContent = formatTime(seconds);

  // Progress bar (shrinks as time runs out)
  const pct = Math.min(100, (seconds / timerMax) * 100);
  timerBar.style.width = pct + "%";

  if (seconds <= 15) {
    timerEl.classList.add("timer-urgent");
    timerBar.classList.add("bar-urgent");
  } else {
    timerEl.classList.remove("timer-urgent");
    timerBar.classList.remove("bar-urgent");
  }
}

/** Render quick-fill chips (min bid, min+increment, min+2×increment) */
function renderQuickFill(currentBid, minIncrement) {
  quickFill.innerHTML = "";
  const suggestions = [
    currentBid + minIncrement,
    currentBid + minIncrement * 2,
    currentBid + minIncrement * 5,
  ];
  suggestions.forEach((amt) => {
    const chip = document.createElement("button");
    chip.className = "quick-chip";
    chip.textContent = formatINR(amt);
    chip.addEventListener("click", () => {
      bidInput.value = amt;
    });
    quickFill.appendChild(chip);
  });
}

/** Prepend a bid entry to the history list */
function prependBidEntry({ bidder, amount, timestamp }) {
  // Remove empty-state placeholder if present
  const empty = bidHistoryList.querySelector(".empty-state");
  if (empty) empty.remove();

  const li = document.createElement("li");
  li.className = "bid-entry bid-entry-new";
  li.innerHTML = `
    <span class="bid-avatar">${bidder.charAt(0).toUpperCase()}</span>
    <span class="bid-info">
      <strong>${bidder}</strong>
      <span class="bid-amount">${formatINR(amount)}</span>
    </span>
    <span class="bid-time">${timestamp}</span>
  `;
  bidHistoryList.insertBefore(li, bidHistoryList.firstChild);

  // Remove animation class after it plays
  setTimeout(() => li.classList.remove("bid-entry-new"), 600);
}

/** Render the full bid history (on init) */
function renderHistory(bidHistory) {
  bidHistoryList.innerHTML = "";
  if (!bidHistory || bidHistory.length === 0) {
    bidHistoryList.innerHTML = '<li class="empty-state">Waiting for the first bid…</li>';
    historyCount.textContent = "0 bids";
    return;
  }
  bidHistory.forEach(prependBidEntry);
  // prependBidEntry inserts at top, so final order is newest-first
  // But since bidHistory is already newest-first (unshift on server),
  // we iterate and append to keep consistent ordering.
  // Re-render cleanly:
  bidHistoryList.innerHTML = "";
  bidHistory.forEach((entry) => {
    const li = document.createElement("li");
    li.className = "bid-entry";
    li.innerHTML = `
      <span class="bid-avatar">${entry.bidder.charAt(0).toUpperCase()}</span>
      <span class="bid-info">
        <strong>${entry.bidder}</strong>
        <span class="bid-amount">${formatINR(entry.amount)}</span>
      </span>
      <span class="bid-time">${entry.timestamp}</span>
    `;
    bidHistoryList.appendChild(li);
  });
  historyCount.textContent = `${bidHistory.length} bid${bidHistory.length !== 1 ? "s" : ""}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal → Join
// ─────────────────────────────────────────────────────────────────────────────

function enterFloor() {
  const name = usernameInput.value.trim();
  if (!name) {
    usernameInput.classList.add("input-error");
    usernameInput.placeholder = "Please enter a name!";
    return;
  }
  myUsername = name;

  // Hide modal, show app
  modalOverlay.classList.add("hidden");
  appEl.classList.remove("hidden");

  myUsernameEl.textContent = myUsername;
  roomTag.textContent = auctionId;

  // Join the auction room
  socket.emit("auction:join", { auctionId, username: myUsername });
}

modalEnterBtn.addEventListener("click", enterFloor);
usernameInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") enterFloor();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bid Button
// ─────────────────────────────────────────────────────────────────────────────

bidBtn.addEventListener("click", () => {
  const raw = bidInput.value.trim();
  if (!raw || isNaN(Number(raw))) {
    showToast("Please enter a valid number.", true);
    return;
  }

  const amount = Number(raw);
  socket.emit("bid:place", { auctionId, amount });

  // Briefly disable to prevent accidental double-click
  bidBtn.disabled = true;
  bidInput.value = "";
  setTimeout(() => { bidBtn.disabled = false; }, 1500);
});

// Allow Enter key in bid input
bidInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") bidBtn.click();
});

// ─────────────────────────────────────────────────────────────────────────────
// Socket Event Handlers
// ─────────────────────────────────────────────────────────────────────────────

/** auction:init — hydrates the UI for a new joiner */
socket.on("auction:init", ({ item, bidHistory, timeRemaining }) => {
  // Item details
  itemTitle.textContent = item.title;
  itemDesc.textContent = item.description;
  if (item.imageUrl) {
    itemImage.src = item.imageUrl;
    itemImage.alt = item.title;
  }

  // Price
  currentBidEl.textContent = formatINR(item.currentBid);
  minBidHint.textContent = `Min next bid: ${formatINR(item.currentBid + item.minIncrement)}`;
  bidInput.min = item.currentBid + item.minIncrement;

  // Quick fill chips
  renderQuickFill(item.currentBid, item.minIncrement);

  // Status chip
  if (item.status === "ended") {
    statusChip.textContent = "● ENDED";
    statusChip.className = "status-chip status-ended";
    bidBtn.disabled = true;
  }

  // Store timerMax for progress bar ratio
  timerMax = Math.max(timeRemaining, 60);
  updateTimer(timeRemaining);

  // Bid history
  renderHistory(bidHistory);

  // Store minIncrement for later quick-fill updates
  bidInput.dataset.minIncrement = item.minIncrement;
});

/** auction:time_tick — update countdown every second */
socket.on("auction:time_tick", ({ timeRemaining }) => {
  updateTimer(timeRemaining);
});

/** user:joined / user:left — viewer count badge */
socket.on("user:joined", ({ totalViewers }) => {
  viewerCount.textContent = totalViewers;
});
socket.on("user:left", ({ totalViewers }) => {
  viewerCount.textContent = totalViewers;
});

/** bid:success — new highest bid broadcast to room */
socket.on("bid:success", ({ currentBid, highestBidder, bidHistory, timeRemaining }) => {
  // Update price
  currentBidEl.textContent = formatINR(currentBid);
  flashPrice();

  // Update timer (anti-snipe may have extended it)
  updateTimer(timeRemaining);

  // Update min-bid hint and quick chips
  const minIncrement = Number(bidInput.dataset.minIncrement) || 2000;
  minBidHint.textContent = `Min next bid: ${formatINR(currentBid + minIncrement)}`;
  bidInput.min = currentBid + minIncrement;
  renderQuickFill(currentBid, minIncrement);

  // Prepend latest bid to history (bidHistory[0] is newest)
  if (bidHistory && bidHistory.length > 0) {
    const empty = bidHistoryList.querySelector(".empty-state");
    if (empty) empty.remove();
    prependBidEntry(bidHistory[0]);
    historyCount.textContent = `${bidHistory.length} bid${bidHistory.length !== 1 ? "s" : ""}`;
  }

  // Show a subtle "you're winning" hint if it's my bid
  if (highestBidder === myUsername) {
    showToast(`✅ You are now the highest bidder at ${formatINR(currentBid)}!`, false);
  }
});

/** bid:outbid — targeted private alert to displaced bidder */
socket.on("bid:outbid", ({ message }) => {
  showBanner(outbidBanner, outbidMsg, message);
  // Optional audio cue (beep)
  tryBeep(440, 0.3, 0.15);
});

/** bid:rejected — show error toast near bid input */
socket.on("bid:rejected", ({ reason }) => {
  showToast("⚠️ " + reason, true);
});

/** auction:extended — anti-snipe triggered */
socket.on("auction:extended", ({ timeRemaining, message }) => {
  updateTimer(timeRemaining);
  showBanner(antisnipeBanner, antisnipeMsg, message);
  timerEl.classList.add("timer-extended");
  setTimeout(() => timerEl.classList.remove("timer-extended"), 2000);
});

/** auction:error — room not found etc. */
socket.on("auction:error", ({ message }) => {
  showToast("❌ " + message, true);
});

/** auction:sold — disable bidding, show overlay */
socket.on("auction:sold", ({ winner, finalPrice, status }) => {
  bidBtn.disabled = true;
  bidInput.disabled = true;
  statusChip.textContent = "● ENDED";
  statusChip.className = "status-chip status-ended";
  updateTimer(0);

  soldOverlay.classList.remove("hidden");

  if (status === "sold" && winner) {
    soldTitle.textContent = "🔨 SOLD!";
    soldWinner.textContent = `Winner: ${winner}`;
    soldPrice.textContent = `Final Price: ${formatINR(finalPrice)}`;
  } else {
    soldTitle.textContent = "😔 NO SALE";
    soldWinner.textContent = "No bids were placed.";
    soldPrice.textContent = `Starting Price was ${formatINR(finalPrice)}`;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audio (Web Audio API — graceful fallback if blocked)
// ─────────────────────────────────────────────────────────────────────────────

function tryBeep(frequency, volume, duration) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gainNode.gain.value = volume;
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
  } catch (_) {
    // Audio not available — silent fail
  }
}
