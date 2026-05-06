const REPO_OWNER = "deepndense-sketch";
const REPO_NAME = "Dipak-Chand";
const BRANCH = "main";
const DATA_PATHS = {
  site: "data/site.json",
  users: "data/admin-users.json",
  donations: "data/donations.json"
};
const DONOR_COLORS = ["#176b87", "#b45309", "#7c3aed", "#0f766e", "#be123c", "#2563eb", "#a16207", "#15803d", "#c2410c", "#6d28d9"];

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

async function saveJson(path, value, token, message) {
  if (!token) throw new Error("GitHub token is required to publish changes.");
  let sha;
  try {
    const existing = await githubGet(path, token);
    sha = existing.sha;
  } catch (error) {
    sha = undefined;
  }
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

function sessionSet(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function sessionGet(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || "null"); }
  catch { return null; }
}

async function loadAllData() {
  const [site, users, donations] = await Promise.all([
    readJson(DATA_PATHS.site, { targetAmount: 5000000, currency: "Rs" }),
    readJson(DATA_PATHS.users, { mainAdmins: [], pending: [], approved: [] }),
    readJson(DATA_PATHS.donations, { donations: [] })
  ]);
  return { site, users, donations: donations.donations || [] };
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
                ${admin.donations.sort((a, b) => new Date(b.publishedAt || b.createdAt) - new Date(a.publishedAt || a.createdAt)).map((entry, index) => {
                  const color = entry.color || DONOR_COLORS[(adminIndex + index) % DONOR_COLORS.length];
                  const pct = target ? (Number(entry.amount || 0) / target) * 100 : 0;
                  return `<article class="public-donation-card" style="--donor-color:${color}">
                    <a href="donation.html?id=${encodeURIComponent(entry.id)}" target="_blank" rel="noopener">${entry.donorName}</a>
                    <span class="amount">${money(entry.amount, currency)}</span>
                    <div class="percent">${pct.toFixed(2)}% of target</div>
                  </article>`;
                }).join("")}
              </div>
            </section>`).join("")}
        </div>
      </div>`;
  }).catch((error) => {
    mount.innerHTML = `<div class="public-summary"><h2>Donation Updates</h2><p>Unable to load donation data.</p></div>`;
    console.error(error);
  });
}

window.DipakCMS = {
  DATA_PATHS,
  DONOR_COLORS,
  money,
  slugify,
  uid,
  sha256,
  readJson,
  saveJson,
  sessionSet,
  sessionGet,
  loadAllData,
  renderPublicDonationSummary
};
