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

function renderPublicDonationSummary(mountId = "donation-dashboard") {
  const mount = document.getElementById(mountId);
  if (!mount) return;
  loadAllData().then(({ site, users, donations }) => {
    const target = Number(site.targetAmount || 5000000);
    const currency = site.currency || "Rs";
    const published = donations.filter((entry) => entry.status === "published");
    const total = published.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
    const percent = Math.min(100, target ? (total / target) * 100 : 0);
    const remaining = Math.max(0, target - total);
    const groups = groupPublishedByAdmin(donations, users);
    if (!published.length) {
      mount.innerHTML = `<div class="public-summary"><h2>Donation Updates</h2><p>No published donation entries yet.</p></div>`;
      return;
    }
    mount.innerHTML = `
      <div class="public-summary">
        <h2>Donation Progress</h2>
        <p><strong>Total Raised:</strong> ${money(total, currency)} of ${money(target, currency)} (${percent.toFixed(1)}%)</p>
        <div class="progress-shell" aria-label="Donation progress"><div class="progress-fill" style="width:${percent}%"></div></div>
        <p><strong>Remaining:</strong> ${money(remaining, currency)}</p>
        <div class="admin-columns">
          ${groups.map((admin, adminIndex) => `
            <section class="admin-column">
              <h3>${admin.username}</h3>
              <div class="admin-total">${money(admin.total, currency)} raised</div>
              <div class="timeline-list">
                ${sortDonationsNewest(admin.donations).slice(0, LIST_LIMIT).map((entry, index) => {
                  const color = entry.color || DONOR_COLORS[(adminIndex + index) % DONOR_COLORS.length];
                  const profileImage = entry.profileThumb || entry.profileImage;
                  return `<article class="public-donation-card" style="--donor-color:${color}">
                    <a class="donor-photo-link" href="donation.html?id=${encodeURIComponent(entry.id)}" aria-label="${entry.donorName}">
                      ${profileImage?.dataUrl
                        ? `<img class="donor-photo" src="${profileImage.dataUrl}" alt="${entry.donorName}" loading="lazy" decoding="async">`
                        : `<span class="donor-photo donor-photo-fallback">${String(entry.donorName || "?").charAt(0).toUpperCase()}</span>`}
                    </a>
                    <div class="donor-summary">
                      <a href="donation.html?id=${encodeURIComponent(entry.id)}">${entry.donorName}</a>
                      <span class="amount">${money(entry.amount, currency)}</span>
                    </div>
                  </article>`;
                }).join("")}
              </div>
              ${admin.donations.length > LIST_LIMIT ? `<a class="complete-list-link" href="donations-list.html?admin=${encodeURIComponent(admin.id)}">View complete list (${admin.donations.length})</a>` : ""}
            </section>`).join("")}
        </div>
      </div>`;
  }).catch((error) => {
    mount.innerHTML = `<div class="public-summary"><h2>Donation Updates</h2><p>Unable to load donation data.</p></div>`;
    console.error(error);
  });
}

function shareUrl(path = location.href) {
  return new URL(path, location.href).href;
}

function facebookShareHref(path = location.href) {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl(path))}`;
}

function renderFacebookShareLinks() {
  document.querySelectorAll("[data-facebook-share]").forEach((link) => {
    const target = link.getAttribute("data-share-url") || location.href;
    link.href = facebookShareHref(target);
    link.target = "_blank";
    link.rel = "noopener";
  });
}

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
  renderFacebookShareLinks
};

document.addEventListener("DOMContentLoaded", renderFacebookShareLinks);
