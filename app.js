const state = {
  page: 1,
  pageSize: 25,
  view: "dashboard",
  layout: "table",
  total: 0,
  venues: [],
  selected: null,
  activeFilterLabel: "Base de prospection"
};

const API_BASE = location.pathname.includes("/functions/v1/prospect-lieux-b2b")
  ? "/functions/v1/prospect-lieux-b2b"
  : location.hostname.endsWith("github.io")
    ? "https://lsczptxjhiadoskvklvj.supabase.co/functions/v1/prospect-lieux-b2b"
  : "";

const dashboardFilters = {
  total: { label: "Lieux à vérifier", params: { includeKactus: "true", kactusQueue: "true" } },
  new: { label: "Nouveaux à vérifier", params: { includeKactus: "true", kactusQueue: "true", status: "Nouveau" } },
  absentKactus: { label: "Absents Kactus", params: { includeKactus: "true", absentKactusOnly: "true" } },
  neverContacted: { label: "Jamais contactés à vérifier", params: { includeKactus: "true", kactusQueue: "true", contacted: "Non" } },
  contacted: { label: "Contactés à vérifier", params: { includeKactus: "true", kactusQueue: "true", contacted: "Oui" } },
  interested: { label: "Intéressés à vérifier", params: { includeKactus: "true", kactusQueue: "true", status: "Interesse" } },
  partners: { label: "Partenaires à vérifier", params: { includeKactus: "true", kactusQueue: "true", status: "Partenaire" } },
  refused: { label: "Refus à vérifier", params: { includeKactus: "true", kactusQueue: "true", status: "Refuse" } },
  dueToday: { label: "Relances du jour à vérifier", params: { includeKactus: "true", kactusQueue: "true", followUp: "today" } }
};

const statuses = [
  "Nouveau",
  "A verifier",
  "A contacter",
  "Contacte",
  "En attente",
  "A relancer",
  "Rendez-vous prevu",
  "Interesse",
  "Partenaire",
  "Refuse",
  "Present sur Kactus"
];

const venueTypes = [
  "Salle de reception",
  "Restaurant",
  "Restaurant privatisable",
  "Salle de reunion",
  "Auditorium",
  "Loft",
  "Hotel",
  "Coworking",
  "Theatre",
  "Galerie",
  "Musee",
  "Rooftop",
  "Peniche",
  "Centre de conference",
  "Musee",
  "Centre culturel",
  "Salle polyvalente",
  "Lieu de reception",
  "Espace atypique",
  "Lieu atypique"
];

const $ = (selector) => document.querySelector(selector);

init();

function init() {
  fillSelect("#arrondissementFilter", Array.from({ length: 20 }, (_, i) => `${i + 1}e`));
  fillSelect("#typeFilter", venueTypes);
  fillSelect("#statusFilter", statuses);
  bindEvents();
  loadDashboard();
  loadSyncProgress();
  loadVenues();
}

function bindEvents() {
  document.querySelectorAll(".nav button").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
  [
    "#searchInput",
    "#cityFilter",
    "#arrondissementFilter",
    "#typeFilter",
    "#capacityFilter",
    "#ownerFilter",
    "#statusFilter",
    "#contactedFilter",
    "#interestedFilter",
    "#followUpFilter",
    "#doneFilter",
    "#ratingFilter",
    "#absentKactusOnly",
    "#kactusQueueOnly",
    "#includeKactus"
  ].forEach((selector) => {
    $(selector).addEventListener("input", debounce(() => {
      state.page = 1;
      loadVenues();
    }, 220));
  });
  $("#syncButton").addEventListener("click", syncNow);
  $("#nextBatchButton").addEventListener("click", syncNow);
  $("#clearFilterButton").addEventListener("click", clearDashboardFilter);
  $("#manualButton").addEventListener("click", () => $("#manualDialog").showModal());
  $("#manualForm").addEventListener("submit", createManualVenue);
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => $(`#${button.dataset.close}`).close());
  });
  $("#tableViewButton").addEventListener("click", () => setLayout("table"));
  $("#cardViewButton").addEventListener("click", () => setLayout("cards"));
  $("#prevPage").addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      loadVenues();
    }
  });
  $("#nextPage").addEventListener("click", () => {
    if (state.page * state.pageSize < state.total) {
      state.page += 1;
      loadVenues();
    }
  });
  $("#autoSyncToggle").addEventListener("change", (event) => {
    localStorage.setItem("prospect-auto-sync-weekly", event.target.checked ? "true" : "false");
    showBanner(event.target.checked ? "Actualisation hebdomadaire activee sur cet appareil." : "Actualisation hebdomadaire desactivee sur cet appareil.");
  });
  $("#autoSyncToggle").checked = localStorage.getItem("prospect-auto-sync-weekly") === "true";
  applyUrlFilter();
}

function setView(view) {
  state.view = view;
  document.querySelectorAll(".nav button").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#dashboard").classList.toggle("hidden", view !== "dashboard");
  applyViewPreset(view);
  state.page = 1;
  loadVenues();
}

function applyViewPreset(view) {
  if (view === "new") $("#statusFilter").value = "Nouveau";
  if (view === "todo") $("#statusFilter").value = "A contacter";
  if (view === "followups") $("#followUpFilter").value = "today";
  if (view === "interested") $("#interestedFilter").value = "Oui";
  if (view === "partners") $("#statusFilter").value = "Partenaire";
  if (view === "prospects") {
    $("#absentKactusOnly").checked = true;
    state.activeFilterLabel = "Prospects certains";
  }
  if (view === "kactusQueue") {
    $("#includeKactus").checked = true;
    $("#kactusQueueOnly").checked = true;
    state.activeFilterLabel = "À vérifier sur Kactus";
  }
  if (view === "kactus") {
    $("#includeKactus").checked = true;
    $("#statusFilter").value = "Present sur Kactus";
  }
  if (view === "all" || view === "dashboard" || view === "settings") {
    $("#statusFilter").value = "";
    $("#followUpFilter").value = "";
    $("#interestedFilter").value = "";
  }
}

function setLayout(layout) {
  state.layout = layout;
  $("#tableView").classList.toggle("hidden", layout !== "table");
  $("#cardView").classList.toggle("hidden", layout !== "cards");
  $("#tableViewButton").classList.toggle("active", layout === "table");
  $("#cardViewButton").classList.toggle("active", layout === "cards");
}

async function loadDashboard() {
  const data = await api("/api/dashboard");
  const present = await api("/api/venues?includeKactus=true&kactusStatus=Present sur Kactus&pageSize=100");
  const visibleStats = {
    total: Math.max(0, (data.stats.total || 0) - present.total),
    newVenues: Math.max(0, (data.stats.newVenues || 0) - present.items.filter((venue) => venue.commercial.status === "Nouveau").length),
    absentKactus: data.stats.absentKactus || 0,
    neverContacted: Math.max(0, (data.stats.neverContacted || 0) - present.items.filter((venue) => venue.commercial.contacted === "Non").length),
    contacted: Math.max(0, (data.stats.contacted || 0) - present.items.filter((venue) => venue.commercial.contacted === "Oui").length),
    interested: data.stats.interested || 0,
    partners: data.stats.partners || 0,
    refused: data.stats.refused || 0,
    dueToday: data.stats.dueToday || 0
  };
  const cards = [
    ["total", "Total", visibleStats.total],
    ["new", "Nouveaux", visibleStats.newVenues],
    ["absentKactus", "Absents Kactus", visibleStats.absentKactus],
    ["neverContacted", "Jamais contactes", visibleStats.neverContacted],
    ["contacted", "Contactes", visibleStats.contacted],
    ["interested", "Interesses", visibleStats.interested],
    ["partners", "Partenaires", visibleStats.partners],
    ["refused", "Refus", visibleStats.refused],
    ["dueToday", "Relances du jour", visibleStats.dueToday]
  ];
  $("#dashboard").innerHTML = `
    <div class="stat-grid">${cards.map(([key, label, value]) => `<button class="stat-card" type="button" data-filter="${key}" aria-label="Afficher ${escapeHtml(value)} lieux - ${escapeHtml(label)}"><span>${label}</span><strong>${value}</strong></button>`).join("")}</div>
    <article class="priority-panel">
      <div class="panel-head"><h2>Priorites du jour</h2><span>${ownerText(data.owners)}</span></div>
      <div class="priority-list">
        ${data.priorities.map((venue) => `<button onclick="window.openVenue(${venue.id})"><strong>${escapeHtml(venue.name)}</strong><span>${escapeHtml(venue.zone)} - ${escapeHtml(venue.commercial.status)}</span></button>`).join("") || "<p>Aucune priorite immediate.</p>"}
      </div>
    </article>
  `;
  document.querySelectorAll(".stat-card[data-filter]").forEach((card) => {
    card.addEventListener("click", () => applyDashboardFilter(card.dataset.filter, true));
    card.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      applyDashboardFilter(card.dataset.filter, true);
    });
  });
}

async function loadSyncProgress() {
  const [progress, archives, dashboard] = await Promise.all([
    api("/api/sync-progress"),
    api("/api/sync-runs"),
    api("/api/dashboard")
  ]);
  renderProgress(progress, archives, dashboard.stats?.total || 0);
}

async function loadVenues() {
  const query = buildQuery();
  const data = await api(`/api/venues?${query}`);
  state.venues = data.items;
  state.total = data.total;
  $("#resultCount").textContent = `${data.total} ${data.total > 1 ? "lieux" : "lieu"}`;
  $("#viewHint").textContent = state.activeFilterLabel;
  $("#clearFilterButton").classList.toggle("hidden", state.activeFilterLabel === "Base de prospection");
  $("#pageLabel").textContent = `Page ${state.page}`;
  $("#prevPage").disabled = state.page === 1;
  $("#nextPage").disabled = state.page * state.pageSize >= state.total;
  $("#csvExport").href = `${API_BASE}/api/export.csv?${query}`;
  $("#xlsExport").href = `${API_BASE}/api/export.xls?${query}`;
  renderRows();
  renderCards();
}

function applyUrlFilter() {
  const params = new URLSearchParams(window.location.search);
  const filter = params.get("filter");
  if (filter && dashboardFilters[filter]) {
    applyDashboardFilter(filter, false);
    return;
  }
  applyParamsToControls(params);
  if (!window.location.search) {
    $("#includeKactus").checked = true;
    $("#kactusQueueOnly").checked = true;
    state.activeFilterLabel = "À vérifier sur Kactus";
    return;
  }
  state.activeFilterLabel = params.get("label") || "Base de prospection";
}

function applyDashboardFilter(filterKey, pushUrl) {
  const filter = dashboardFilters[filterKey];
  if (!filter) return;
  resetFilters();
  setView("all");
  applyParamsToControls(new URLSearchParams(filter.params));
  state.activeFilterLabel = filter.label;
  state.page = 1;
  if (pushUrl) {
    const params = new URLSearchParams(filter.params);
    params.set("filter", filterKey);
    params.set("label", filter.label);
    history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
  }
  loadVenues();
  document.querySelector(".workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function clearDashboardFilter() {
  resetFilters();
  $("#includeKactus").checked = true;
  $("#kactusQueueOnly").checked = true;
  state.activeFilterLabel = "À vérifier sur Kactus";
  state.page = 1;
  history.pushState({}, "", window.location.pathname);
  setView("all");
  loadVenues();
}

function resetFilters() {
  [
    "#searchInput",
    "#cityFilter",
    "#arrondissementFilter",
    "#typeFilter",
    "#capacityFilter",
    "#ownerFilter",
    "#statusFilter",
    "#contactedFilter",
    "#interestedFilter",
    "#followUpFilter",
    "#doneFilter",
    "#ratingFilter"
  ].forEach((selector) => {
    $(selector).value = "";
  });
  $("#absentKactusOnly").checked = false;
  $("#kactusQueueOnly").checked = false;
  $("#includeKactus").checked = false;
}

function applyParamsToControls(params) {
  const controlMap = {
    q: "#searchInput",
    city: "#cityFilter",
    arrondissement: "#arrondissementFilter",
    venueType: "#typeFilter",
    minCapacity: "#capacityFilter",
    responsible: "#ownerFilter",
    status: "#statusFilter",
    contacted: "#contactedFilter",
    interested: "#interestedFilter",
    followUp: "#followUpFilter",
    doneStatus: "#doneFilter",
    minRating: "#ratingFilter"
  };
  for (const [param, selector] of Object.entries(controlMap)) {
    if (params.has(param)) $(selector).value = params.get(param);
  }
  $("#absentKactusOnly").checked = params.get("absentKactusOnly") === "true";
  $("#kactusQueueOnly").checked = params.get("kactusQueue") === "true";
  $("#includeKactus").checked = params.get("includeKactus") === "true";
}

function buildQuery() {
  const params = new URLSearchParams({ page: state.page, pageSize: state.pageSize });
  const map = {
    q: "#searchInput",
    city: "#cityFilter",
    arrondissement: "#arrondissementFilter",
    venueType: "#typeFilter",
    minCapacity: "#capacityFilter",
    responsible: "#ownerFilter",
    status: "#statusFilter",
    contacted: "#contactedFilter",
    interested: "#interestedFilter",
    followUp: "#followUpFilter",
    doneStatus: "#doneFilter",
    minRating: "#ratingFilter"
  };
  for (const [key, selector] of Object.entries(map)) {
    const value = $(selector).value;
    if (value) params.set(key, value);
  }
  if ($("#absentKactusOnly").checked) params.set("absentKactusOnly", "true");
  if ($("#kactusQueueOnly").checked) params.set("kactusQueue", "true");
  if ($("#includeKactus").checked) params.set("includeKactus", "true");
  return params.toString();
}

function renderRows() {
  $("#venueRows").innerHTML = state.venues.map((venue) => `
    <tr class="${venue.alreadyDone ? "already-done-row" : ""}" onclick="window.openVenue(${venue.id})">
      <td>
        <label class="done-cell" onclick="event.stopPropagation()">
          <input type="checkbox" data-done-id="${venue.id}" ${venue.alreadyDone ? "checked" : ""} onchange="window.toggleAlreadyDone(${venue.id}, this.checked)" aria-label="Marquer ${escapeHtml(venue.name)} comme déjà fait" />
        </label>
      </td>
      <td>${googleBusinessLink(venue)}</td>
      <td><strong>${escapeHtml(venue.name)}</strong><small>${escapeHtml(venue.address)}</small></td>
      <td>${escapeHtml(venue.venueType)}</td>
      <td>${escapeHtml(venue.zone)}</td>
      <td>${venue.phone ? `<a href="tel:${venue.phone}">${escapeHtml(venue.phone)}</a>` : "<span class='muted'>A verifier</span>"}</td>
      <td>${venue.capacity || "<span class='muted'>?</span>"}</td>
      <td>${pill(venue.privateHire)}</td>
      <td>${pill(venue.kactusStatus)}</td>
      <td>${pill(venue.commercial.contacted)}</td>
      <td>${escapeHtml(venue.commercial.responsible)}</td>
      <td>${pill(venue.commercial.interested)}</td>
      <td>${escapeHtml(venue.commercial.nextFollowUpDate || "-")}</td>
      <td>${pill(venue.commercial.status)}</td>
      <td class="comment-cell">${escapeHtml(venue.commercial.comment || "")}</td>
    </tr>
  `).join("");
}

function renderCards() {
  $("#cardView").innerHTML = state.venues.map((venue) => `
    <article class="venue-card ${venue.alreadyDone ? "already-done-row" : ""}" onclick="window.openVenue(${venue.id})">
      ${googleBusinessLink(venue, "card")}
      <div>
        <div class="card-title"><strong>${escapeHtml(venue.name)}</strong>${pill(venue.kactusStatus)}</div>
        <p>${escapeHtml(venue.venueType)} - ${escapeHtml(venue.zone)} - ${venue.capacity || "?"} pers.</p>
        <span>${venue.alreadyDone ? "Déjà fait - " : ""}${escapeHtml(venue.commercial.status)} avec ${escapeHtml(venue.commercial.responsible)}</span>
      </div>
    </article>
  `).join("");
}

window.toggleAlreadyDone = async (id, checked) => {
  const previous = state.venues.find((venue) => venue.id === id)?.alreadyDone || false;
  state.venues = state.venues.map((venue) => venue.id === id ? { ...venue, alreadyDone: checked } : venue);
  renderRows();
  renderCards();
  try {
    await api(`/api/venues/${id}/already-done`, { method: "PATCH", body: JSON.stringify({ alreadyDone: checked }) });
    await loadVenues();
  } catch (error) {
    state.venues = state.venues.map((venue) => venue.id === id ? { ...venue, alreadyDone: previous } : venue);
    renderRows();
    renderCards();
    showBanner("Impossible d'enregistrer Déjà fait pour ce lieu.");
  }
};

window.openVenue = async (id) => {
  const data = await api(`/api/venues/${id}`);
  state.selected = data.venue;
  renderDetail(data.venue, data.history);
  if (!$("#venueDialog").open) $("#venueDialog").showModal();
};

function renderDetail(venue, history) {
  $("#venueDetail").innerHTML = `
    <div class="detail-hero">
      <img src="${photo(venue)}" alt="">
      <button class="close-button" onclick="document.querySelector('#venueDialog').close()">Fermer</button>
    </div>
    <div class="detail-body">
      <div class="detail-title">
        <div>
          <p class="eyebrow">${escapeHtml(venue.venueType)} - ${escapeHtml(venue.zone)}</p>
          <h2>${escapeHtml(venue.name)}</h2>
        </div>
        ${pill(venue.kactusStatus)}
      </div>
      <div class="info-grid">
        ${info("Adresse", venue.address)}
        ${info("Telephone", venue.phone ? `<a href="tel:${venue.phone}">${escapeHtml(venue.phone)}</a>` : "A verifier")}
        ${info("E-mail", venue.commercial.directEmail ? `<a href="mailto:${venue.commercial.directEmail}">${escapeHtml(venue.commercial.directEmail)}</a>` : "A verifier")}
        ${info("Site", venue.website ? `<a target="_blank" href="${venue.website}">Ouvrir</a>` : "A verifier")}
        ${info("Google Maps", venue.mapsUrl ? `<a target="_blank" href="${venue.mapsUrl}">Ouvrir dans Google Maps</a>` : "A verifier")}
        ${info("Note Google", venue.rating ? `${venue.rating} (${venue.reviewCount || 0} avis)` : "A verifier")}
        ${info("Capacite estimee", venue.capacity || "A verifier")}
        ${info("Privatisable", venue.privateHire)}
        ${info("Déjà fait", venue.alreadyDone ? "Oui" : "Non")}
        ${info("Derniere verification", venue.lastCheckedAt || "A verifier")}
        ${info("Source", venue.source)}
      </div>
      <div class="done-detail">
        <label>
          <input type="checkbox" ${venue.alreadyDone ? "checked" : ""} onchange="window.toggleAlreadyDone(${venue.id}, this.checked)" />
          Déjà fait
        </label>
      </div>
      <div class="public-actions">
        <a class="ghost-button" target="_blank" href="${kactusSearchUrl(venue)}">Chercher ${escapeHtml(venue.name)} Kactus</a>
        <form id="publicVenueForm" class="public-form">
          <label>Statut Kactus
            <select name="kactusStatus">
              ${["Presence incertaine", "Absent de Kactus", "Present sur Kactus"].map((option) => `<option ${option === venue.kactusStatus ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </label>
          <label>Lien Google Maps<input name="mapsUrl" type="url" value="${escapeHtml(venue.mapsUrl || "")}" /></label>
          <button class="ghost-button" type="submit">Enregistrer verification</button>
        </form>
      </div>
      <form id="commercialForm" class="commercial-form">
        ${selectField("contacted", "Prise de contact", ["Oui", "Non"], venue.commercial.contacted)}
        ${selectField("responsible", "Responsable", ["Steven", "Gabriel"], venue.commercial.responsible)}
        ${selectField("interested", "Interesse", ["Oui", "Non", "A verifier"], venue.commercial.interested)}
        ${selectField("contactMethod", "Moyen de contact", ["Telephone", "E-mail", "Visite", "Instagram", "Autre"], venue.commercial.contactMethod)}
        ${inputField("contactName", "Nom du contact", venue.commercial.contactName)}
        ${inputField("contactRole", "Fonction", venue.commercial.contactRole)}
        ${inputField("directEmail", "E-mail direct", venue.commercial.directEmail, "email")}
        ${inputField("firstContactDate", "Premier contact", venue.commercial.firstContactDate, "date")}
        ${inputField("lastContactDate", "Dernier contact", venue.commercial.lastContactDate, "date")}
        ${inputField("nextFollowUpDate", "Prochaine relance", venue.commercial.nextFollowUpDate, "date")}
        ${selectField("status", "Statut commercial", statuses, venue.commercial.status)}
        <label class="wide">Commentaire<textarea name="comment">${escapeHtml(venue.commercial.comment)}</textarea></label>
        <label class="wide">Note d'historique<input name="historyComment" placeholder="Ex: appel effectue, email envoye..." /></label>
        <button class="primary-button wide" type="submit">Enregistrer la fiche commerciale</button>
      </form>
      <section class="history">
        <h3>Historique</h3>
        ${history.map((item) => `<article><strong>${escapeHtml(item.action_type)}</strong><span>${escapeHtml(item.created_at)} - ${escapeHtml(item.user_name)}</span><p>${escapeHtml(item.comment)}</p>${item.status_change ? `<em>${escapeHtml(item.status_change)}</em>` : ""}</article>`).join("")}
      </section>
    </div>
  `;
  $("#commercialForm").addEventListener("submit", saveCommercial);
  $("#publicVenueForm").addEventListener("submit", savePublicVenue);
}

async function saveCommercial(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  await api(`/api/venues/${state.selected.id}`, { method: "PATCH", body: JSON.stringify(body) });
  showBanner("Fiche commerciale enregistree sans ecraser les donnees publiques.");
  await loadDashboard();
  await loadVenues();
}

async function savePublicVenue(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  await api(`/api/public-venue/${state.selected.id}`, { method: "PATCH", body: JSON.stringify(body) });
  showBanner("Verification Kactus et lien Google Maps enregistres.");
  await loadDashboard();
  await loadVenues();
  await window.openVenue(state.selected.id);
}

async function createManualVenue(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  const result = await api("/api/venues", { method: "POST", body: JSON.stringify(body) });
  $("#manualDialog").close();
  event.currentTarget.reset();
  showBanner(result.action === "inserted" ? "Lieu ajoute manuellement." : "Lieu deja present, donnees publiques actualisees.");
  await loadDashboard();
  await loadVenues();
}

async function syncNow() {
  $("#syncButton").disabled = true;
  $("#nextBatchButton").disabled = true;
  showBanner("Synchronisation par lot de 100 en cours...");
  try {
    const summary = await api("/api/sync?limit=100", { method: "POST" });
    showBanner(summary.warning || `${summary.newCount} nouveaux lieux ajoutes - ${summary.duplicateCount} doublons ignores - ${summary.verifyCount} statuts Kactus a verifier - 0 donnee commerciale ecrasee.`);
    await loadDashboard();
    await loadSyncProgress();
    await loadVenues();
  } finally {
    $("#syncButton").disabled = false;
    $("#nextBatchButton").disabled = false;
  }
}

function renderProgress(progress, archives = [], totalVenues = 0) {
  const done = progress.initialCompleted;
  const headline = done
    ? "Synchronisation initiale terminee"
    : `${totalVenues} lieux en base`;
  const subline = done
    ? "Rechercher seulement les nouveaux lieux"
    : `${progress.completedSteps || 0} etapes terminees - ${progress.retrySteps || 0} a reprendre - prochaine : ${progress.nextStep || "-"}`;
  $("#syncButton").textContent = done ? "Rechercher les nouveaux lieux" : "Synchroniser";
  $("#nextBatchButton").classList.toggle("hidden", done || progress.totalFound === 0);
  $("#progressPanel").innerHTML = `
    <div class="progress-head">
      <strong>${escapeHtml(headline)}</strong>
      <span>Derniere actualisation: ${escapeHtml(progress.lastSyncAt || "Aucune")}</span>
    </div>
    <div class="progress-subtitle">${escapeHtml(subline)}</div>
    <div class="progress-track"><span style="width:${Math.max(2, progress.percent)}%"></span></div>
    <div class="progress-meta">
      <span>${progress.percent}% des recherches</span>
      <span>${progress.imported} lieux importes par sync</span>
      <span>${progress.duplicatesIgnored} doublons ignores</span>
      <span>${progress.remaining === null ? "Restant: selon OSM" : `${progress.remaining} restants`}</span>
    </div>
    <div class="progress-steps">
      ${(progress.recentSteps || []).map((step) => `<span>${escapeHtml(step)}</span>`).join("")}
    </div>
    <div class="sync-archives">
      <strong>Archives sync</strong>
      ${(archives || []).slice(0, 5).map((run) => `
        <span>${escapeHtml(run.finished_at || run.started_at)} - +${run.new_count} - doublons/maj ${run.updated_count} - ${escapeHtml(run.message || "")}</span>
      `).join("")}
    </div>
  `;
}

async function api(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const response = await fetch(`${API_BASE}${url}`, { ...options, headers });
  if (response.status === 401) {
    throw new Error("Session expiree");
  }
  if (!response.ok) throw new Error((await response.json()).error || "Erreur API");
  return response.json();
}

function fillSelect(selector, values) {
  const select = $(selector);
  values.forEach((value) => select.insertAdjacentHTML("beforeend", `<option>${value}</option>`));
}

function pill(value) {
  const text = escapeHtml(value || "A verifier");
  const tone = /oui|absent|partenaire|interesse/i.test(text) ? "good" : /incertaine|verifier|relancer|nouveau/i.test(text) ? "warn" : /kactus|non|refuse/i.test(text) ? "bad" : "neutral";
  return `<span class="pill ${tone}">${text}</span>`;
}

function photo(venue) {
  return venue.photos?.[0] || "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80";
}

function googleBusinessUrl(venue) {
  if (venue.mapsUrl) return venue.mapsUrl;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([venue.name, venue.address, venue.city].filter(Boolean).join(", "))}`;
}

function googleBusinessLink(venue, variant = "table") {
  const label = variant === "card" ? "Google Business" : "Google";
  return `<a class="google-business-link ${variant === "card" ? "card-map-link" : ""}" href="${escapeHtml(googleBusinessUrl(venue))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation()" aria-label="Ouvrir la fiche Google Business de ${escapeHtml(venue.name)}">${label}</a>`;
}

function kactusSearchUrl(venue) {
  return `https://www.google.com/search?q=${encodeURIComponent(`${venue.name} Kactus`)}`;
}

function info(label, value) {
  return `<div class="info"><span>${label}</span><strong>${value || "A verifier"}</strong></div>`;
}

function inputField(name, label, value, type = "text") {
  return `<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(value || "")}" /></label>`;
}

function selectField(name, label, options, value) {
  return `<label>${label}<select name="${name}">${options.map((option) => `<option ${option === value ? "selected" : ""}>${option}</option>`).join("")}</select></label>`;
}

function ownerText(owners) {
  return owners.map((owner) => `${owner.responsible}: ${owner.count}`).join(" - ");
}

function showBanner(message) {
  $("#syncBanner").textContent = message;
  $("#syncBanner").classList.remove("hidden");
}

function debounce(fn, wait) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), wait);
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
