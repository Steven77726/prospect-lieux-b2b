// @ts-nocheck
const PASSWORD = "prospect2026";
const COOKIE_NAME = "plb2b_auth";
const COOKIE_VALUE = "ok-prospect2026";
const GITHUB_RAW = "https://raw.githubusercontent.com/Steven77726/prospect-lieux-b2b/main/public";
const GITHUB_CDN = "https://cdn.jsdelivr.net/gh/Steven77726/prospect-lieux-b2b@main/public";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/prospect-lieux-b2b/, "")
    .replace(/^\/prospect-lieux-b2b/, "") || "/";

  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders("text/plain") });
  if (path === "/login" && req.method === "POST") return login(req);
  if (path.startsWith("/api/") && !isAuthorized(req) && !hasPasswordHeader(req)) return json({ error: "Mot de passe requis" }, 401);
  if (!isAuthorized(req) && !(path.startsWith("/api/") && hasPasswordHeader(req))) return loginPage();

  try {
    if (path === "/" && req.method === "GET") return home();
    if (path.startsWith("/api/")) return api(req, url, path);
    return json({ error: "Route introuvable" }, 404);
  } catch (error) {
    return json({ error: error?.message || "Erreur serveur" }, 500);
  }
});

async function login(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData()).entries());
  if (String(body.password || "") !== PASSWORD) return loginPage("Mot de passe incorrect");
  return new Response(null, {
    status: 303,
    headers: {
      "Location": "/functions/v1/prospect-lieux-b2b/",
      "Set-Cookie": `${COOKIE_NAME}=${COOKIE_VALUE}; Path=/functions/v1/prospect-lieux-b2b; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
    }
  });
}

function isAuthorized(req: Request) {
  return (req.headers.get("cookie") || "").includes(`${COOKIE_NAME}=${COOKIE_VALUE}`);
}

function hasPasswordHeader(req: Request) {
  return req.headers.get("x-prospect-password") === PASSWORD;
}

function loginPage(error = "") {
  return html(`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prospect Lieux B2B</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,Arial,sans-serif;background:#f6f7fb;color:#172033}
      form{width:min(380px,calc(100vw - 32px));display:grid;gap:14px;padding:28px;border:1px solid #dde2ea;border-radius:24px;background:white;box-shadow:0 24px 70px rgba(25,35,55,.12)}
      h1{margin:0;font-size:1.5rem} input,button{min-height:44px;border-radius:14px;border:1px solid #d8dee8;padding:0 12px;font:inherit}
      button{border:0;background:#0a7cff;color:white;font-weight:800;cursor:pointer}.error{color:#b42318;font-weight:700}
    </style>
  </head>
  <body>
    <form method="post" action="/functions/v1/prospect-lieux-b2b/login">
      <h1>Prospect Lieux B2B</h1>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
      <input name="password" type="password" placeholder="Mot de passe" autofocus />
      <button type="submit">Entrer</button>
    </form>
    <script>
      document.querySelector("form").addEventListener("submit", async (event) => {
        event.preventDefault();
        const password = document.querySelector("input").value;
        const response = await fetch("/functions/v1/prospect-lieux-b2b/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password })
        });
        if (response.redirected) location.href = response.url;
        else location.reload();
      });
    </script>
  </body>
</html>`);
}

async function home() {
  const source = await fetch(`${GITHUB_RAW}/index.html`).then((res) => res.text());
  return html(source
    .replace('href="/styles.css"', `href="${GITHUB_CDN}/styles.css"`)
    .replace('src="/app.js"', `src="${GITHUB_CDN}/app.js"`));
}

async function api(req: Request, url: URL, path: string) {
  if (path === "/api/dashboard" && req.method === "GET") return json(await dashboard());
  if (path === "/api/venues" && req.method === "GET") return json(await listVenues(url));
  if (path === "/api/venues" && req.method === "POST") return json(await createVenue(await req.json()), 201);
  if (path === "/api/sync-progress" && req.method === "GET") return json(await syncProgress());
  if (path === "/api/sync-runs" && req.method === "GET") return json(await rest("sync_runs", { order: "started_at.desc", limit: "10" }));
  if (path === "/api/sync" && req.method === "POST") return json({ warning: "Synchronisation en ligne a relancer depuis le poste principal pour eviter de saturer Overpass.", newCount: 0, duplicateCount: 0, verifyCount: 0 });
  if (path === "/api/sync-test" && req.method === "POST") return json({ warning: "Test Overpass disponible sur la version locale.", newCount: 0 });
  if (path === "/api/export.csv" && req.method === "GET") return exportRows(url, "csv");
  if (path === "/api/export.xls" && req.method === "GET") return exportRows(url, "xls");

  const detail = path.match(/^\/api\/venues\/(\d+)$/);
  if (detail && req.method === "GET") return json(await getVenue(Number(detail[1])));
  if (detail && req.method === "PATCH") return json(await updateCommercial(Number(detail[1]), await req.json()));

  const publicVenue = path.match(/^\/api\/public-venue\/(\d+)$/);
  if (publicVenue && req.method === "PATCH") return json(await updatePublicVenue(Number(publicVenue[1]), await req.json()));

  const done = path.match(/^\/api\/venues\/(\d+)\/already-done$/);
  if (done && req.method === "PATCH") return json(await updateAlreadyDone(Number(done[1]), await req.json()));

  return json({ error: "Route introuvable" }, 404);
}

async function dashboard() {
  const venues = await allVenues();
  const stats = {
    total: venues.length,
    newVenues: venues.filter((v) => v.commercial.status === "Nouveau").length,
    absentKactus: venues.filter((v) => v.kactusStatus === "Absent de Kactus").length,
    neverContacted: venues.filter((v) => v.commercial.contacted === "Non").length,
    contacted: venues.filter((v) => v.commercial.contacted === "Oui").length,
    interested: venues.filter((v) => ["Interesse", "Intéressé"].includes(v.commercial.status)).length,
    partners: venues.filter((v) => v.commercial.status === "Partenaire").length,
    refused: venues.filter((v) => ["Refuse", "Refus"].includes(v.commercial.status)).length,
    dueToday: venues.filter((v) => isDueToday(v.commercial.nextFollowUpDate) && !["Partenaire", "Refuse", "Refus", "Present sur Kactus"].includes(v.commercial.status)).length
  };
  const owners = Object.values(venues.reduce((acc, venue) => {
    const responsible = venue.commercial.responsible || "Steven";
    acc[responsible] ||= { responsible, count: 0 };
    acc[responsible].count += 1;
    return acc;
  }, {} as Record<string, { responsible: string; count: number }>));
  const priorities = venues
    .filter((v) => v.kactusStatus === "Absent de Kactus" && (["A contacter", "A relancer", "Nouveau"].includes(v.commercial.status) || isDueOrLate(v.commercial.nextFollowUpDate)))
    .slice(0, 8);
  return { stats, owners, priorities };
}

async function listVenues(url: URL) {
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 25), 10), 100);
  const filtered = filterVenues(await allVenues(), url);
  const offset = (page - 1) * pageSize;
  return { items: filtered.slice(offset, offset + pageSize), total: filtered.length, page, pageSize };
}

async function getVenue(id: number) {
  const venue = (await allVenues()).find((item) => item.id === id);
  if (!venue) throw new Error("Lieu introuvable");
  const history = await rest("history", { venue_id: `eq.${id}`, order: "created_at.desc" });
  return { venue, history };
}

async function updateAlreadyDone(id: number, body: Record<string, unknown>) {
  await patchRow("venues", { already_done: Boolean(body.alreadyDone), updated_at: new Date().toISOString() }, { id: `eq.${id}` });
  await addHistory(id, "Déjà fait", body.alreadyDone ? "Lieu marqué comme déjà fait." : "Lieu retiré des déjà faits.", body.alreadyDone ? "Non -> Oui" : "Oui -> Non", String(body.userName || "Steven"));
  return getVenue(id);
}

async function updateCommercial(id: number, body: Record<string, string>) {
  const map: Record<string, string> = {
    contactName: "contact_name",
    contactRole: "contact_role",
    directEmail: "direct_email",
    contactMethod: "contact_method",
    firstContactDate: "first_contact_date",
    lastContactDate: "last_contact_date",
    nextFollowUpDate: "next_follow_up_date"
  };
  const allowed = ["contacted", "responsible", "interested", "comment", "contactName", "contactRole", "directEmail", "contactMethod", "firstContactDate", "lastContactDate", "nextFollowUpDate", "status"];
  const update: Record<string, string> = {};
  for (const key of allowed) if (Object.hasOwn(body, key)) update[map[key] || key] = String(body[key] || "");
  update.updated_at = new Date().toISOString();
  await patchRow("commercial_data", update, { venue_id: `eq.${id}` });
  await addHistory(id, body.actionType || "Mise a jour commerciale", body.historyComment || "Fiche commerciale modifiee.", "", body.userName || "Steven");
  return getVenue(id);
}

async function updatePublicVenue(id: number, body: Record<string, string>) {
  const update: Record<string, string> = { updated_at: new Date().toISOString(), last_checked_at: new Date().toISOString() };
  if (Object.hasOwn(body, "kactusStatus")) update.kactus_status = String(body.kactusStatus || "");
  if (Object.hasOwn(body, "mapsUrl")) update.maps_url = String(body.mapsUrl || "");
  await patchRow("venues", update, { id: `eq.${id}` });
  await addHistory(id, "Verification Kactus", "Statut Kactus ou lien Google Maps mis a jour manuellement.", "", body.userName || "Steven");
  return getVenue(id);
}

async function createVenue(body: Record<string, string>) {
  const name = String(body.name || "").trim();
  if (!name) throw new Error("Le nom du lieu est obligatoire");
  const venue = {
    google_place_id: body.externalId || null,
    name,
    normalized_name: normalizeText(name),
    venue_type: body.venueType || "Lieu atypique",
    address: body.address || "",
    normalized_address: normalizeText(body.address || ""),
    city: body.city || "Paris",
    arrondissement: body.arrondissement || "",
    zone: body.zone || body.city || "Paris",
    phone: body.phone || "",
    normalized_phone: normalizePhone(body.phone || ""),
    website: body.website || "",
    maps_url: body.mapsUrl || googleMapsSearchUrl(name, body.address || ""),
    photos_json: "[]",
    private_hire: "A verifier",
    kactus_status: body.kactusStatus || "Presence incertaine",
    source: "Saisie manuelle",
    sync_status: "Nouveau",
    is_demo: false,
    already_done: false
  };
  const rows = await restWrite("venues", "POST", [venue], "return=representation");
  const id = rows[0].id;
  await restWrite("commercial_data", "POST", [{
    venue_id: id,
    contacted: "Non",
    responsible: body.responsible || "Steven",
    interested: "A verifier",
    comment: body.comment || "",
    contact_method: "Telephone",
    status: body.status || "Nouveau"
  }], "return=minimal");
  await addHistory(id, "Creation", "Lieu ajoute a la base.", body.status || "Nouveau", body.userName || "Steven");
  return { id, action: "inserted" };
}

async function syncProgress() {
  const rows = await rest("sync_progress", { id: "eq.1", limit: "1" });
  const row = rows[0] || {};
  const recent = await rest("sync_step_status", { order: "updated_at.desc", limit: "12" });
  const completedSteps = recent.filter((s) => s.status === "Termine").length;
  const retrySteps = recent.filter((s) => s.status === "A reprendre").length;
  return {
    currentStepIndex: row.current_step_index || 0,
    totalSteps: row.total_steps || 0,
    percent: row.total_steps ? Math.round(((row.current_step_index || 0) / row.total_steps) * 100) : 0,
    completedSteps,
    retrySteps,
    nextStep: row.last_completed_step || "",
    imported: row.added_count || 0,
    duplicatesIgnored: row.duplicate_count || 0,
    remaining: null,
    initialCompleted: Boolean(row.initial_completed),
    lastSyncAt: row.last_sync_at || "",
    totalFound: row.total_found || 0,
    recentSteps: recent.map((s) => `${s.zone} — ${s.category} — ${s.status}`)
  };
}

async function exportRows(url: URL, format: "csv" | "xls") {
  const rows = filterVenues(await allVenues(), url).map((v) => ({
    name: v.name,
    venue_type: v.venueType,
    zone: v.zone,
    address: v.address,
    phone: v.phone,
    direct_email: v.commercial.directEmail,
    capacity: v.capacity,
    private_hire: v.privateHire,
    kactus_status: v.kactusStatus,
    contacted: v.commercial.contacted,
    responsible: v.commercial.responsible,
    interested: v.commercial.interested,
    next_follow_up_date: v.commercial.nextFollowUpDate,
    status: v.commercial.status,
    comment: v.commercial.comment,
    "Déjà fait": v.alreadyDone ? "Oui" : "Non",
    website: v.website,
    maps_url: v.mapsUrl,
    source: v.source
  }));
  const headers = Object.keys(rows[0] || {});
  if (format === "xls") {
    return new Response(`<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`, {
      headers: { "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=prospect-lieux-b2b.xls" }
    });
  }
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(","))].join("\n");
  return new Response(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=prospect-lieux-b2b.csv" } });
}

async function allVenues() {
  const rows = await rest("venues", { select: "*,commercial_data(*)", limit: "1000", order: "created_at.desc" });
  return rows.map(mapVenue);
}

function filterVenues(venues: ReturnType<typeof mapVenue>[], url: URL) {
  let items = venues;
  if (url.searchParams.get("kactusQueue") === "true") items = items.filter((v) => v.kactusStatus === "Presence incertaine");
  else if (url.searchParams.get("includeKactus") !== "true") items = items.filter((v) => v.kactusStatus === "Absent de Kactus");
  const eqFilters: [string, (v: ReturnType<typeof mapVenue>) => string][] = [
    ["city", (v) => v.city],
    ["arrondissement", (v) => v.arrondissement],
    ["venueType", (v) => v.venueType],
    ["kactusStatus", (v) => v.kactusStatus],
    ["syncStatus", (v) => v.syncStatus],
    ["contacted", (v) => v.commercial.contacted],
    ["responsible", (v) => v.commercial.responsible],
    ["interested", (v) => v.commercial.interested],
    ["status", (v) => v.commercial.status]
  ];
  for (const [param, getter] of eqFilters) {
    const value = url.searchParams.get(param);
    if (value) items = items.filter((v) => getter(v) === value);
  }
  if (url.searchParams.get("absentKactusOnly") === "true") items = items.filter((v) => v.kactusStatus === "Absent de Kactus");
  if (url.searchParams.get("doneStatus") === "done") items = items.filter((v) => v.alreadyDone);
  if (url.searchParams.get("doneStatus") === "todo") items = items.filter((v) => !v.alreadyDone);
  const minCapacity = Number(url.searchParams.get("minCapacity") || 0);
  if (minCapacity) items = items.filter((v) => Number(v.capacity || 0) >= minCapacity);
  const minRating = Number(url.searchParams.get("minRating") || 0);
  if (minRating) items = items.filter((v) => Number(v.rating || 0) >= minRating);
  if (url.searchParams.get("followUp") === "today") items = items.filter((v) => isDueToday(v.commercial.nextFollowUpDate) && !["Partenaire", "Refuse", "Refus", "Present sur Kactus"].includes(v.commercial.status));
  if (url.searchParams.get("followUp") === "late") items = items.filter((v) => isLate(v.commercial.nextFollowUpDate));
  const q = normalizeText(url.searchParams.get("q") || "");
  if (q) items = items.filter((v) => normalizeText(`${v.name} ${v.address} ${v.phone} ${v.commercial.directEmail}`).includes(q));
  return items;
}

function mapVenue(row: Record<string, any>) {
  const commercial = Array.isArray(row.commercial_data) ? row.commercial_data[0] : row.commercial_data || {};
  return {
    id: row.id,
    googlePlaceId: row.google_place_id,
    name: row.name,
    venueType: row.venue_type,
    address: row.address,
    city: row.city,
    arrondissement: row.arrondissement,
    zone: row.zone,
    phone: row.phone,
    website: row.website,
    mapsUrl: row.maps_url,
    photos: JSON.parse(row.photos_json || "[]"),
    rating: row.rating,
    reviewCount: row.review_count,
    capacity: row.capacity,
    privateHire: row.private_hire,
    kactusStatus: row.kactus_status,
    kactusVerifiedAt: row.kactus_verified_at || "",
    kactusVerificationMethod: row.kactus_verification_method || "",
    kactusResultUrl: row.kactus_result_url || "",
    kactusResultSummary: row.kactus_result_summary || "",
    kactusValidatedBy: row.kactus_validated_by || "",
    kactusValidatedAt: row.kactus_validated_at || "",
    lastCheckedAt: row.last_checked_at,
    source: row.source,
    syncStatus: row.sync_status,
    isDemo: Boolean(row.is_demo),
    alreadyDone: Boolean(row.already_done),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    commercial: {
      contacted: commercial.contacted || "Non",
      responsible: commercial.responsible || "Steven",
      interested: commercial.interested || "A verifier",
      comment: commercial.comment || "",
      contactName: commercial.contact_name || "",
      contactRole: commercial.contact_role || "",
      directEmail: commercial.direct_email || "",
      contactMethod: commercial.contact_method || "Telephone",
      firstContactDate: commercial.first_contact_date || "",
      lastContactDate: commercial.last_contact_date || "",
      nextFollowUpDate: commercial.next_follow_up_date || "",
      status: commercial.status || "Nouveau"
    }
  };
}

async function rest(table: string, params: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { headers: restHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function restWrite(table: string, method: string, body: unknown, prefer = "return=minimal", onConflict = "") {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (onConflict) url.searchParams.set("on_conflict", onConflict);
  const response = await fetch(url, { method, headers: { ...restHeaders(), "Prefer": prefer }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.status === 204 ? [] : response.json();
}

async function patchRow(table: string, body: Record<string, unknown>, filters: Record<string, string>) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(filters)) url.searchParams.set(key, value);
  const response = await fetch(url, { method: "PATCH", headers: { ...restHeaders(), "Prefer": "return=minimal" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
}

async function addHistory(venueId: number, actionType: string, comment: string, statusChange = "", userName = "Steven") {
  await restWrite("history", "POST", [{ venue_id: venueId, user_name: userName, action_type: actionType, comment, status_change: statusChange }], "return=minimal");
}

function restHeaders() {
  return {
    "apikey": SERVICE_KEY,
    "Authorization": `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json"
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders("application/json; charset=utf-8") });
}

function html(body: string) {
  return new Response(body, { headers: responseHeaders("text/html; charset=utf-8") });
}

function responseHeaders(contentType: string) {
  return {
    "content-type": contentType,
    "connection": "keep-alive",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "content-type,x-prospect-password"
  };
}

function isDueToday(value = "") {
  return value !== "" && value === new Date().toISOString().slice(0, 10);
}

function isLate(value = "") {
  return value !== "" && value < new Date().toISOString().slice(0, 10);
}

function isDueOrLate(value = "") {
  return value !== "" && value <= new Date().toISOString().slice(0, 10);
}

function normalizeText(value = "") {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePhone(value = "") {
  return String(value).replace(/[^\d+]/g, "");
}

function googleMapsSearchUrl(name: string, address = "") {
  const query = encodeURIComponent([name, address].filter(Boolean).join(", "));
  return query ? `https://www.google.com/maps/search/?api=1&query=${query}` : "";
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char] || char));
}
