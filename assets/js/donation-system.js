const REPO_OWNER = "deepndense-sketch";
const REPO_NAME = "Dipak-Chand";
const BRANCH = "main";
const DATA_PATHS = {
  site: "data/site.json",
  users: "data/admin-users.json",
  donations: "data/donations.json",
  donationsIndex: "data/donations-index.json"
};
const DONOR_COLORS = ["#176b87", "#b45309", "#7c3aed", "#0f766e", "#be123c", "#2563eb", "#a16207", "#15803d", "#c2410c", "#6d28d9"];
const TOKEN_STORAGE_KEY = "dipakGithubToken";
const LIST_LIMIT = 15;
const DEFAULT_SITE_TITLE = "Save Dipak Chand";

function apiUrl(path) {
  return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
}

function rawUrl(path) {
  return `${path}?v=${Date.now()}`;
}

function money(amount, currency = "Rs") {
  const value = Number(amount || 0);
  return `${currency} ${value.toLocaleString("en-IN")}`;
}

function slugify(text) {
  return String(text || "entry")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "entry";
}

function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function primaryImage(entry) {
  return entry.profileImage || (entry.images || [])[0] || null;
}

function donationDetailPath(id) {
  return `data/donations/${String(id || "entry").replace(/[^a-zA-Z0-9_-]/g, "-")}.json`;
}

function imageCount(entry) {
  return Number(entry.imageCount || [entry.profileImage, ...(entry.otherImages || []), ...(entry.images || [])].filter((image) => image && image.dataUrl).length);
}

function donationSummary(entry) {
  return {
    id: entry.id,
    donorName: entry.donorName || "",
    amount: Number(entry.amount || 0),
    color: entry.color || "",
    status: entry.status || "draft",
    adminId: entry.adminId || "",
    adminName: entry.adminName || "",
    address: entry.address || "",
    profileThumb: entry.profileThumb || null,
    profileImage: entry.profileThumb ? null : primaryImage(entry),
    imageCount: imageCount(entry),
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
    publishedAt: entry.publishedAt || null
  };
}

async function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readJson(path, fallback) {
  try {
    const response = await fetch(rawUrl(path), { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${path}`);
    return await response.json();
  } catch (error) {
    console.warn(error);
    return structuredClone(fallback);
  }
}

async function githubGet(path, token) {
  const response = await fetch(apiUrl(path), {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function toBase64Utf8(value) {
  return btoa(unescape(encodeURIComponent(JSON.stringify(value, null, 2) + "\n")));
}

function fromBase64Utf8(value) {
  return JSON.parse(decodeURIComponent(escape(atob(String(value || "").replace(/\s/g, "")))));
}

async function githubPutJson(path, value, token, message, sha) {
  const response = await fetch(apiUrl(path), {
    method: "PUT",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      message,
      content: toBase64Utf8(value),
      sha,
      branch: BRANCH
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function githubDeletePath(path, token, message, sha) {
  const response = await fetch(apiUrl(path), {
    method: "DELETE",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({
      message,
      sha,
      branch: BRANCH
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function saveJson(path, value, token, message) {
  if (!token) throw new Error("GitHub token is required to publish changes.");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let sha;
    try {
      const existing = await githubGet(path, token);
      sha = existing.sha;
    } catch (error) {
      sha = undefined;
    }
    try {
      return await githubPutJson(path, value, token, message, sha);
    } catch (error) {
      if (!String(error.message || "").includes('"status": "409"') || attempt === 1) throw error;
    }
  }
}

async function loadGithubJson(path, token) {
  if (!token) throw new Error("GitHub token is required to verify changes.");
  const existing = await githubGet(path, token);
  return fromBase64Utf8(existing.content);
}

async function updateJson(path, fallback, token, message, updater) {
  if (!token) throw new Error("GitHub token is required to publish changes.");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let sha;
    let current = structuredClone(fallback);
    try {
      const existing = await githubGet(path, token);
      sha = existing.sha;
      current = fromBase64Utf8(existing.content);
    } catch (error) {
      if (attempt > 0) throw error;
    }
    const next = await updater(structuredClone(current));
    try {
      return await githubPutJson(path, next, token, message, sha);
    } catch (error) {
      if (!String(error.message || "").includes('"status": "409"') || attempt === 2) throw error;
    }
  }
}

function sessionSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function sessionGet(key) {
  try { return JSON.parse(localStorage.getItem(key) || sessionStorage.getItem(key) || "null"); }
  catch { return null; }
}

function sessionRemove(key) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
}

function rememberToken(token) {
  const value = String(token || "").trim();
  if (value) localStorage.setItem(TOKEN_STORAGE_KEY, value);
  return value;
}

function getRememberedToken() {
  return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
}

function forgetRememberedToken() {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

async function loadAllData() {
  const [site, users, donationIndex] = await Promise.all([
    readJson(DATA_PATHS.site, { title: DEFAULT_SITE_TITLE, targetAmount: 5000000, currency: "Rs" }),
    readJson(DATA_PATHS.users, { mainAdmins: [], pending: [], approved: [] }),
    readJson(DATA_PATHS.donationsIndex, { donations: null })
  ]);
  let donations = donationIndex;
  if (!Array.isArray(donations.donations)) donations = await readJson(DATA_PATHS.donations, { donations: [] });
  return { site, users, donations: donations.donations || [] };
}

async function deleteJson(path, token, message) {
  if (!token) throw new Error("GitHub token is required to delete changes.");
  const existing = await githubGet(path, token);
  return githubDeletePath(path, token, message, existing.sha);
}

async function loadDonationDetail(id) {
  if (!id) return null;
  const detail = await readJson(donationDetailPath(id), null);
  return detail && detail.id ? detail : null;
}

function groupPublishedByAdmin(donations, users) {
  const approved = users.approved || [];
  const admins = new Map(approved.map((admin) => [admin.id, { ...admin, donations: [], total: 0 }]));
  for (const donation of donations.filter((entry) => entry.status === "published")) {
    const adminId = donation.adminId || "unknown";
    if (!admins.has(adminId)) {
      admins.set(adminId, { id: adminId, username: donation.adminName || "Unknown admin", email: "", donations: [], total: 0 });
    }
    const admin = admins.get(adminId);
    admin.donations.push(donation);
    admin.total += Number(donation.amount || 0);
  }
  return [...admins.values()].filter((admin) => admin.donations.length > 0).sort((a, b) => b.total - a.total);
}

function sortDonationsNewest(entries) {
  return [...entries].sort((a, b) => new Date(b.publishedAt || b.createdAt || 0) - new Date(a.publishedAt || a.createdAt || 0));
}

function sortDonationsAlphabetically(entries) {
  return [...entries].sort((a, b) => String(a.donorName || "").localeCompare(String(b.donorName || ""), "en", { sensitivity: "base" }));
}

function sortDonationsByAmount(entries) {
  return [...entries].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0));
}

function publicAdminGroups(donations, users) {
  return groupPublishedByAdmin(donations, users).map((admin) => ({
    ...admin,
    donations: sortDonationsAlphabetically(admin.donations)
  }));
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function thankYouNote(donorName) {
  return `Dear ${donorName || "Friend"},

With heartfelt gratitude, we sincerely thank you for your generous donation to support Dipak, who is bravely fighting blood cancer. Your kindness and compassion have brought hope, comfort, and strength during this challenging time.

Your contribution is more than financial support - it represents care, solidarity, and encouragement for Dipak and his loved ones as they face medical treatment and recovery. Because of compassionate individuals like you, difficult journeys become a little easier and filled with hope.

On behalf of Dipak Chand and everyone involved, we deeply appreciate your generosity, trust, and support. Your kindness will always be remembered and cherished.`;
}

function donationPageUrl(id) {
  return shareUrl(`donation.html?id=${encodeURIComponent(id || "")}`);
}

function donationShareButton(entry) {
  return `<button type="button" class="entry-share-button facebook-share-button" data-donor-share data-donor-name="${escapeHtml(entry.donorName)}" data-share-url="${escapeHtml(donationPageUrl(entry.id))}">Share</button>`;
}

function renderPublicDonationSummary(mountId = "donation-dashboard") {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  loadAllData().then(({ site, users, donations }) => {
    const target = Number(site.targetAmount || 5000000);
    const currency = site.currency || "Rs";
    const published = donations.filter((entry) => entry.status === "published");
    const grandTotal = published.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const groups = publicAdminGroups(donations, users);
    const state = {
      fundraiser: "all",
      sort: "recent"
    };
    const sortEntries = (entries) => {
      if (state.sort === "major") return sortDonationsByAmount(entries);
      if (state.sort === "alpha") return sortDonationsAlphabetically(entries);
      return sortDonationsNewest(entries);
    };
    const filteredEntries = () => state.fundraiser === "all"
      ? published
      : published.filter((entry) => (entry.adminId || "unknown") === state.fundraiser);
    const selectedFundraiserName = () => {
      if (state.fundraiser === "all") return "All Fundraisers";
      const group = groups.find((admin) => admin.id === state.fundraiser);
      return group?.username || "Selected Fundraiser";
    };
    const donationCard = (entry, index) => {
      const color = entry.color || DONOR_COLORS[index % DONOR_COLORS.length];
      const profileImage = entry.profileThumb || entry.profileImage;
      return `<article class="public-donation-card" data-admin-id="${escapeHtml(entry.adminId || "unknown")}" style="--donor-color:${escapeHtml(color)}">
        <a class="donor-photo-link" href="donation.html?id=${encodeURIComponent(entry.id)}" aria-label="${escapeHtml(entry.donorName)}">
          ${profileImage?.dataUrl
            ? `<img class="donor-photo" src="${profileImage.dataUrl}" alt="${escapeHtml(entry.donorName)}" loading="lazy" decoding="async">`
            : `<span class="donor-photo donor-photo-fallback">${escapeHtml(String(entry.donorName || "?").charAt(0).toUpperCase())}</span>`}
        </a>
        <div class="donor-summary">
          <a href="donation.html?id=${encodeURIComponent(entry.id)}">${escapeHtml(entry.donorName)}</a>
          <span class="amount">${money(entry.amount, currency)}</span>
          ${donationShareButton(entry)}
        </div>
      </article>`;
    };
    const renderFilteredView = () => {
      const entries = sortEntries(filteredEntries());
      const total = entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      const percent = Math.min(100, target ? (total / target) * 100 : 0);
      const remaining = Math.max(0, target - total);
      const fundraiserName = selectedFundraiserName();
      const totalLabel = state.fundraiser === "all"
        ? "Total Raised"
        : `${fundraiserName} Raised Total`;
      mount.querySelector("[data-public-total-label]").textContent = totalLabel;
      mount.querySelector("[data-public-total]").textContent = money(total, currency);
      mount.querySelector("[data-public-target]").textContent = money(target, currency);
      mount.querySelector("[data-public-percent]").textContent = `${percent.toFixed(1)}%`;
      mount.querySelector("[data-public-remaining]").textContent = money(remaining, currency);
      mount.querySelector("[data-public-progress]").style.width = `${percent}%`;
      mount.querySelector("[data-public-contributors]").textContent = `${entries.length} contributor${entries.length === 1 ? "" : "s"}`;
      mount.querySelector("[data-public-filter-title]").textContent = state.fundraiser === "all"
        ? "Showing all donor data"
        : `Showing donor data raised by ${fundraiserName}`;
      mount.querySelector("[data-public-donation-grid]").innerHTML = entries.length
        ? entries.map(donationCard).join("")
        : `<p class="empty-state">No donor data found for this fundraiser.</p>`;
    };
    if (!published.length) {
      mount.innerHTML = `<div class="public-summary"><h2>Donation Updates</h2><p>No published donation entries yet.</p></div>`;
      return;
    }
    mount.innerHTML = `
      <div class="public-summary">
        <h2>Donation Progress</h2>
        <p><strong data-public-total-label>Total Raised</strong>: <span data-public-total>${money(grandTotal, currency)}</span> of <span data-public-target>${money(target, currency)}</span> (<span data-public-percent></span>)</p>
        <div class="progress-shell" aria-label="Donation progress"><div class="progress-fill" data-public-progress></div></div>
        <div class="public-filter-stats">
          <p><strong>Remaining:</strong> <span data-public-remaining></span></p>
          <p><strong>Contributors:</strong> <span data-public-contributors></span></p>
        </div>
        <section class="fundraiser-panel">
          <h3>Fundraisers</h3>
          <div class="fundraiser-list">
            <button type="button" class="fundraiser-filter active" data-fundraiser-filter="all">
              <span>All Fundraisers</span>
              <strong>${money(grandTotal, currency)}</strong>
              <em>${published.length} contributors</em>
            </button>
            ${groups.map((admin) => `
              <button type="button" class="fundraiser-filter" data-fundraiser-filter="${escapeHtml(admin.id)}">
                <span>${escapeHtml(admin.username)} Raised Total ${money(admin.total, currency)}</span>
                <em>${admin.donations.length} contributors</em>
              </button>`).join("")}
          </div>
        </section>
        <section class="donor-toolbar" aria-label="Donor list filters">
          <div>
            <h3 data-public-filter-title>Showing all donor data</h3>
            <p>Choose how donor data is ordered.</p>
          </div>
          <label>
            Sort donor data
            <select data-donor-sort>
              <option value="recent">Recent entries at top</option>
              <option value="major">Major contributor</option>
              <option value="alpha">Alphabetical order</option>
            </select>
          </label>
        </section>
        <div class="home-donation-grid" data-public-donation-grid>
        </div>
      </div>`;
    mount.querySelectorAll("[data-fundraiser-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        state.fundraiser = button.dataset.fundraiserFilter;
        mount.querySelectorAll("[data-fundraiser-filter]").forEach((item) => item.classList.toggle("active", item === button));
        renderFilteredView();
      });
    });
    mount.querySelector("[data-donor-sort]").addEventListener("change", (event) => {
      state.sort = event.target.value;
      renderFilteredView();
    });
    renderFilteredView();
  }).catch((error) => {
    mount.innerHTML = `<div class="public-summary"><h2>Donation Updates</h2><p>Unable to load donation data.</p></div>`;
    console.error(error);
  });
}

function shareUrl(path = location.href) {
  return new URL(path, location.href).href;
}

function facebookShareHref(path = location.href, quote = "") {
  const params = new URLSearchParams({ u: shareUrl(path) });
  if (quote) params.set("quote", quote);
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

function renderFacebookShareLinks() {
  document.querySelectorAll("[data-facebook-share]").forEach((link) => {
    const target = link.getAttribute("data-share-url") || location.href;
    link.href = facebookShareHref(target);
    link.target = "_blank";
    link.rel = "noopener";
  });
}

async function copyText(text, statusEl) {
  try {
    await navigator.clipboard.writeText(text);
    if (statusEl) statusEl.textContent = "Text copied. Paste it into the Facebook post box.";
  } catch (error) {
    const textarea = document.getElementById("facebookSharePopupText");
    if (textarea) {
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
    }
    if (statusEl) statusEl.textContent = "Text selected. Copy it, then paste it into the Facebook post box.";
  }
}

function showFacebookShareComposer(donorName, url = location.href) {
  const note = thankYouNote(donorName);
  let modal = document.getElementById("facebookSharePopup");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "facebookSharePopup";
    modal.className = "share-popup";
    modal.innerHTML = `
      <div class="share-popup-card" role="dialog" aria-modal="true" aria-labelledby="facebookSharePopupTitle">
        <div class="share-popup-head">
          <h2 id="facebookSharePopupTitle">Facebook Post Text</h2>
          <button type="button" class="secondary share-popup-close" aria-label="Close">Close</button>
        </div>
        <img class="share-popup-photo" src="./DipakFBPhoto.jpg" alt="Dipak Chand" loading="lazy" decoding="async">
        <textarea id="facebookSharePopupText" readonly></textarea>
        <div class="detail-share-row share-popup-actions">
          <button type="button" class="secondary" id="facebookSharePopupCopy">Copy Text</button>
          <a class="complete-list-link facebook-share-button" id="facebookSharePopupOpen" target="_blank" rel="noopener">Open Facebook</a>
        </div>
        <p class="backend-help" id="facebookSharePopupStatus">Copy this text, then paste it into your Facebook post after Facebook opens.</p>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.closest(".share-popup-close")) modal.hidden = true;
    });
    modal.querySelector("#facebookSharePopupCopy").addEventListener("click", () => {
      copyText(modal.querySelector("#facebookSharePopupText").value, modal.querySelector("#facebookSharePopupStatus"));
    });
  }
  modal.querySelector("#facebookSharePopupText").value = note;
  modal.querySelector("#facebookSharePopupOpen").href = facebookShareHref(url);
  modal.querySelector("#facebookSharePopupStatus").textContent = "Copy this text, then paste it into your Facebook post after Facebook opens.";
  modal.hidden = false;
  const textarea = modal.querySelector("#facebookSharePopupText");
  textarea.focus();
  textarea.select();
  copyText(note, modal.querySelector("#facebookSharePopupStatus"));
}

document.addEventListener("click", (event) => {
  const shareButton = event.target.closest("[data-donor-share]");
  if (!shareButton) return;
  showFacebookShareComposer(shareButton.dataset.donorName, shareButton.dataset.shareUrl || location.href);
});

window.DipakCMS = {
  DATA_PATHS,
  DONOR_COLORS,
  DEFAULT_SITE_TITLE,
  money,
  slugify,
  uid,
  primaryImage,
  donationDetailPath,
  donationSummary,
  imageCount,
  sortDonationsNewest,
  sortDonationsAlphabetically,
  publicAdminGroups,
  escapeHtml,
  thankYouNote,
  donationShareButton,
  sha256,
  readJson,
  loadGithubJson,
  saveJson,
  deleteJson,
  updateJson,
  sessionSet,
  sessionGet,
  sessionRemove,
  rememberToken,
  getRememberedToken,
  forgetRememberedToken,
  loadAllData,
  loadDonationDetail,
  renderPublicDonationSummary,
  facebookShareHref,
  renderFacebookShareLinks,
  showFacebookShareComposer
};

document.addEventListener("DOMContentLoaded", renderFacebookShareLinks);
