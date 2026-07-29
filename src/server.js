import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { addHistory, db, initDb, mapVenueRow, normalizeText, upsertVenue } from "./db.js";
import { getProgressSummary, runTargetedSync, runVenueSync, startWeeklySync } from "./sync.js";

initDb();
if (config.autoSyncWeekly) startWeeklySync();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Erreur serveur" });
  }
});

server.listen(config.port, () => {
  console.log(`Prospect Lieux B2B disponible sur http://localhost:${config.port}`);
});

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/venues") return listVenues(res, url);
  if (req.method === "POST" && url.pathname === "/api/venues") return createManualVenue(req, res);
  if (req.method === "POST" && /^\/api\/venues\/\d+\/kactus-check$/.test(url.pathname)) return verifyKactus(req, res, url.pathname);
  if (req.method === "POST" && /^\/api\/venues\/\d+\/kactus-confirm$/.test(url.pathname)) return confirmKactus(req, res, url.pathname);
  if (req.method === "PATCH" && /^\/api\/venues\/\d+\/already-done$/.test(url.pathname)) return updateAlreadyDone(req, res, url.pathname);
  if (req.method === "GET" && url.pathname.startsWith("/api/venues/")) return getVenue(res, url.pathname);
  if (req.method === "PATCH" && url.pathname.startsWith("/api/venues/")) return updateCommercial(req, res, url.pathname);
  if (req.method === "PATCH" && url.pathname.startsWith("/api/public-venue/")) return updatePublicVenue(req, res, url.pathname);
  if (req.method === "POST" && url.pathname === "/api/import.csv") return importCsv(req, res);
  if (req.method === "POST" && url.pathname === "/api/sync") return syncNow(req, res, url);
  if (req.method === "POST" && url.pathname === "/api/sync-test") return syncTest(res);
  if (req.method === "GET" && url.pathname === "/api/sync-progress") return syncProgress(res);
  if (req.method === "GET" && url.pathname === "/api/dashboard") return dashboard(res);
  if (req.method === "GET" && url.pathname === "/api/sync-runs") return syncRuns(res);
  if (req.method === "GET" && url.pathname === "/api/export.csv") return exportRows(res, url, "csv");
  if (req.method === "GET" && url.pathname === "/api/export.xls") return exportRows(res, url, "xls");
  sendJson(res, 404, { error: "Route introuvable" });
}

function listVenues(res, url) {
  const { where, values } = buildVenueWhere(url);
  const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
  const pageSize = Math.min(Math.max(Number(url.searchParams.get("pageSize") || 25), 10), 100);
  const offset = (page - 1) * pageSize;
  const total = db.prepare(`SELECT COUNT(*) AS total FROM venues v JOIN commercial_data c ON c.venue_id = v.id ${where}`).get(...values).total;
  const rows = db.prepare(`
    SELECT v.*, c.* FROM venues v
    JOIN commercial_data c ON c.venue_id = v.id
    ${where}
    ORDER BY
      CASE WHEN c.next_follow_up_date != '' AND date(c.next_follow_up_date) <= date('now') THEN 0 ELSE 1 END,
      v.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, offset);
  sendJson(res, 200, { items: rows.map(mapVenueRow), total, page, pageSize });
}

function getVenue(res, pathname) {
  const id = Number(pathname.split("/").at(-1));
  const row = db.prepare("SELECT v.*, c.* FROM venues v JOIN commercial_data c ON c.venue_id = v.id WHERE v.id = ?").get(id);
  if (!row) return sendJson(res, 404, { error: "Lieu introuvable" });
  const history = db.prepare("SELECT * FROM history WHERE venue_id = ? ORDER BY created_at DESC").all(id);
  sendJson(res, 200, { venue: mapVenueRow(row), history });
}

async function updateCommercial(req, res, pathname) {
  const id = Number(pathname.split("/").at(-1));
  const body = await readJson(req);
  const before = db.prepare("SELECT status FROM commercial_data WHERE venue_id = ?").get(id);
  if (!before) return sendJson(res, 404, { error: "Lieu introuvable" });

  const fields = [
    "contacted",
    "responsible",
    "interested",
    "comment",
    "contactName",
    "contactRole",
    "directEmail",
    "contactMethod",
    "firstContactDate",
    "lastContactDate",
    "nextFollowUpDate",
    "status"
  ];
  const dbNames = {
    contactName: "contact_name",
    contactRole: "contact_role",
    directEmail: "direct_email",
    contactMethod: "contact_method",
    firstContactDate: "first_contact_date",
    lastContactDate: "last_contact_date",
    nextFollowUpDate: "next_follow_up_date"
  };
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (Object.hasOwn(body, field)) {
      updates.push(`${dbNames[field] || field} = ?`);
      values.push(String(body[field] ?? ""));
    }
  }
  if (updates.length) {
    db.prepare(`UPDATE commercial_data SET ${updates.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE venue_id = ?`).run(...values, id);
  }
  const statusChange = body.status && body.status !== before.status ? `${before.status} -> ${body.status}` : "";
  addHistory(id, body.userName || "Steven", body.actionType || "Mise a jour commerciale", body.historyComment || "Fiche commerciale modifiee.", statusChange);
  getVenue(res, `/api/venues/${id}`);
}

async function updatePublicVenue(req, res, pathname) {
  const id = Number(pathname.split("/").at(-1));
  const body = await readJson(req);
  const before = db.prepare("SELECT kactus_status, maps_url FROM venues WHERE id = ?").get(id);
  if (!before) return sendJson(res, 404, { error: "Lieu introuvable" });

  const fields = [
    "kactusStatus",
    "mapsUrl",
    "kactusVerificationMethod",
    "kactusResultUrl",
    "kactusResultSummary",
    "kactusValidatedBy"
  ];
  const dbNames = {
    kactusStatus: "kactus_status",
    mapsUrl: "maps_url",
    kactusVerificationMethod: "kactus_verification_method",
    kactusResultUrl: "kactus_result_url",
    kactusResultSummary: "kactus_result_summary",
    kactusValidatedBy: "kactus_validated_by"
  };
  const updates = [];
  const values = [];
  for (const field of fields) {
    if (Object.hasOwn(body, field)) {
      updates.push(`${dbNames[field]} = ?`);
      values.push(String(body[field] ?? ""));
    }
  }
  if (Object.hasOwn(body, "kactusStatus")) {
    updates.push("kactus_verified_at = CURRENT_TIMESTAMP");
  }
  if (body.kactusValidatedBy) {
    updates.push("kactus_validated_at = CURRENT_TIMESTAMP");
  }
  if (!updates.length) return getVenue(res, `/api/venues/${id}`);
  db.prepare(`UPDATE venues SET ${updates.join(", ")}, last_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
  const statusChange = body.kactusStatus && body.kactusStatus !== before.kactus_status ? `${before.kactus_status} -> ${body.kactusStatus}` : "";
  addHistory(id, body.userName || "Steven", "Verification Kactus", "Statut Kactus ou lien Google Maps mis a jour manuellement.", statusChange);
  getVenue(res, `/api/venues/${id}`);
}

async function verifyKactus(req, res, pathname) {
  const id = Number(pathname.split("/").at(-2));
  const body = await readJson(req);
  const row = db.prepare("SELECT * FROM venues WHERE id = ?").get(id);
  if (!row) return sendJson(res, 404, { error: "Lieu introuvable" });
  const venue = mapVenueRow({ ...row, contacted: "", responsible: "", interested: "", comment: "", contact_name: "", contact_role: "", direct_email: "", contact_method: "", first_contact_date: "", last_contact_date: "", next_follow_up_date: "", status: "" });
  const result = await runKactusSearch(venue, body);
  saveKactusVerification(id, result, body.userName || "");
  addHistory(id, body.userName || "Steven", "Verification Kactus", result.summary, `${row.kactus_status} -> ${result.status}`);
  getVenue(res, `/api/venues/${id}`);
}

async function confirmKactus(req, res, pathname) {
  const id = Number(pathname.split("/").at(-2));
  const body = await readJson(req);
  const status = body.status === "Present sur Kactus" ? "Present sur Kactus" : "Absent de Kactus";
  const before = db.prepare("SELECT kactus_status FROM venues WHERE id = ?").get(id);
  if (!before) return sendJson(res, 404, { error: "Lieu introuvable" });
  const summary = status === "Absent de Kactus"
    ? "Absence confirmee manuellement apres verification Kactus."
    : "Presence confirmee manuellement apres verification Kactus.";
  db.prepare(`
    UPDATE venues
    SET kactus_status = ?,
        kactus_verified_at = CURRENT_TIMESTAMP,
        kactus_verification_method = ?,
        kactus_result_url = COALESCE(?, kactus_result_url),
        kactus_result_summary = ?,
        kactus_validated_by = ?,
        kactus_validated_at = CURRENT_TIMESTAMP,
        last_checked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, "Validation manuelle", body.resultUrl || "", summary, body.userName || "Steven", id);
  addHistory(id, body.userName || "Steven", "Validation Kactus", summary, `${before.kactus_status} -> ${status}`);
  getVenue(res, `/api/venues/${id}`);
}

async function updateAlreadyDone(req, res, pathname) {
  const id = Number(pathname.split("/").at(-2));
  const body = await readJson(req);
  const alreadyDone = body.alreadyDone ? 1 : 0;
  const before = db.prepare("SELECT already_done FROM venues WHERE id = ?").get(id);
  if (!before) return sendJson(res, 404, { error: "Lieu introuvable" });
  db.prepare("UPDATE venues SET already_done = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(alreadyDone, id);
  if (Number(before.already_done || 0) !== alreadyDone) {
    addHistory(
      id,
      body.userName || "Steven",
      "Déjà fait",
      alreadyDone ? "Lieu marqué comme déjà fait." : "Lieu retiré des déjà faits.",
      alreadyDone ? "Non -> Oui" : "Oui -> Non"
    );
  }
  getVenue(res, `/api/venues/${id}`);
}

async function createManualVenue(req, res) {
  const body = await readJson(req);
  const name = String(body.name || "").trim();
  if (!name) return sendJson(res, 400, { error: "Le nom du lieu est obligatoire" });
  const result = upsertVenue({
    ...body,
    googlePlaceId: body.externalId || "",
    mapsUrl: body.mapsUrl || googleMapsSearchUrl(name, body.address || ""),
    kactusStatus: body.kactusStatus || "Presence incertaine",
    source: "Saisie manuelle",
    commercial: {
      responsible: body.responsible || "Steven",
      status: body.status || "Nouveau",
      comment: body.comment || "",
      contacted: "Non",
      interested: "A verifier"
    }
  }, { isDemo: false, userName: body.userName || "Steven" });
  sendJson(res, 201, { id: result.id, action: result.action });
}

async function importCsv(req, res) {
  const body = await readJson(req);
  const rows = parseCsv(String(body.csv || ""));
  if (!rows.length) return sendJson(res, 400, { error: "Aucune ligne CSV lisible" });

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const venue = csvRowToVenue(row);
    if (!venue.name) continue;
    const result = upsertVenue(venue, { isDemo: false, userName: body.userName || "Steven" });
    if (result.action === "inserted") inserted += 1;
    if (result.action === "updated") updated += 1;
  }
  sendJson(res, 200, { inserted, updated, commercialOverwriteCount: 0 });
}

async function syncNow(req, res, url) {
  const limit = Number(url.searchParams.get("limit") || 100);
  const summary = await runVenueSync({ limit });
  sendJson(res, 200, summary);
}

async function syncTest(res) {
  const summary = await runTargetedSync();
  sendJson(res, 200, summary);
}

function syncProgress(res) {
  sendJson(res, 200, getProgressSummary());
}

function dashboard(res) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(c.status = 'Nouveau') AS newVenues,
      SUM(v.kactus_status = 'Absent de Kactus') AS absentKactus,
      SUM(c.contacted = 'Non') AS neverContacted,
      SUM(c.contacted = 'Oui') AS contacted,
      SUM(c.status IN ('Interesse', 'Intéressé')) AS interested,
      SUM(c.status = 'Partenaire') AS partners,
      SUM(c.status IN ('Refuse', 'Refus')) AS refused,
      SUM(
        c.next_follow_up_date != ''
        AND date(c.next_follow_up_date) = date('now')
        AND c.status NOT IN ('Partenaire', 'Refuse', 'Refus', 'Present sur Kactus')
      ) AS dueToday
    FROM venues v JOIN commercial_data c ON c.venue_id = v.id
  `).get();
  const owners = db.prepare("SELECT responsible, COUNT(*) AS count FROM commercial_data GROUP BY responsible").all();
  const priorities = db.prepare(`
    SELECT v.*, c.* FROM venues v JOIN commercial_data c ON c.venue_id = v.id
    WHERE v.kactus_status = 'Absent de Kactus'
      AND (c.status IN ('A contacter', 'A relancer', 'Nouveau') OR (c.next_follow_up_date != '' AND date(c.next_follow_up_date) <= date('now')))
    ORDER BY c.next_follow_up_date = '', c.next_follow_up_date ASC, v.created_at DESC
    LIMIT 8
  `).all().map(mapVenueRow);
  sendJson(res, 200, { stats, owners, priorities });
}

function syncRuns(res) {
  const rows = db.prepare("SELECT * FROM sync_runs ORDER BY started_at DESC LIMIT 10").all();
  sendJson(res, 200, rows);
}

function exportRows(res, url, format) {
  const { where, values } = buildVenueWhere(url);
  const rows = db.prepare(`
    SELECT v.name, v.venue_type, v.zone, v.address, v.phone, c.direct_email, v.capacity,
           v.private_hire, v.kactus_status, c.contacted, c.responsible, c.interested,
           c.next_follow_up_date, c.status, c.comment, CASE WHEN v.already_done = 1 THEN 'Oui' ELSE 'Non' END AS "Déjà fait",
           v.website, v.maps_url, v.source
    FROM venues v JOIN commercial_data c ON c.venue_id = v.id
    ${where}
    ORDER BY v.created_at DESC
  `).all(...values);
  const headers = Object.keys(rows[0] || {
    name: "", venue_type: "", zone: "", address: "", phone: "", direct_email: "",
    capacity: "", private_hire: "", kactus_status: "", contacted: "", responsible: "",
    interested: "", next_follow_up_date: "", status: "", comment: "", "Déjà fait": "", website: "", maps_url: "", source: ""
  });
  if (format === "xls") {
    const html = `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((h) => `<td>${escapeHtml(row[h] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    res.writeHead(200, { "Content-Type": "application/vnd.ms-excel", "Content-Disposition": "attachment; filename=prospect-lieux-b2b.xls" });
    res.end(html);
    return;
  }
  const csv = [headers.join(","), ...rows.map((row) => headers.map((h) => csvCell(row[h])).join(","))].join("\n");
  res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=prospect-lieux-b2b.csv" });
  res.end(`\uFEFF${csv}`);
}

function buildVenueWhere(url) {
  const clauses = ["1 = 1"];
  const values = [];
  if (url.searchParams.get("kactusQueue") === "true") {
    clauses.push("v.kactus_status = 'Presence incertaine'");
  } else if (url.searchParams.get("includeKactus") !== "true") {
    clauses.push("v.kactus_status = 'Absent de Kactus'");
  }
  const filters = {
    city: "v.city",
    arrondissement: "v.arrondissement",
    venueType: "v.venue_type",
    kactusStatus: "v.kactus_status",
    syncStatus: "v.sync_status",
    contacted: "c.contacted",
    responsible: "c.responsible",
    interested: "c.interested",
    status: "c.status"
  };
  for (const [param, column] of Object.entries(filters)) {
    const value = url.searchParams.get(param);
    if (value) {
      clauses.push(`${column} = ?`);
      values.push(value);
    }
  }
  const minCapacity = url.searchParams.get("minCapacity");
  if (minCapacity) {
    clauses.push("COALESCE(v.capacity, 0) >= ?");
    values.push(Number(minCapacity));
  }
  const minRating = url.searchParams.get("minRating");
  if (minRating) {
    clauses.push("COALESCE(v.rating, 0) >= ?");
    values.push(Number(minRating));
  }
  if (url.searchParams.get("followUp") === "late") clauses.push("c.next_follow_up_date != '' AND date(c.next_follow_up_date) < date('now')");
  if (url.searchParams.get("followUp") === "today") clauses.push("c.next_follow_up_date != '' AND date(c.next_follow_up_date) = date('now') AND c.status NOT IN ('Partenaire', 'Refuse', 'Refus', 'Present sur Kactus')");
  if (url.searchParams.get("absentKactusOnly") === "true") clauses.push("v.kactus_status = 'Absent de Kactus'");
  if (url.searchParams.get("doneStatus") === "done") clauses.push("v.already_done = 1");
  if (url.searchParams.get("doneStatus") === "todo") clauses.push("v.already_done = 0");
  const q = url.searchParams.get("q");
  if (q) {
    clauses.push("(v.name LIKE ? OR v.address LIKE ? OR v.phone LIKE ? OR c.direct_email LIKE ?)");
    values.push(...Array(4).fill(`%${q}%`));
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, values };
}

function saveKactusVerification(id, result, userName = "") {
  db.prepare(`
    UPDATE venues
    SET kactus_status = ?,
        kactus_verified_at = CURRENT_TIMESTAMP,
        kactus_verification_method = ?,
        kactus_result_url = ?,
        kactus_result_summary = ?,
        kactus_validated_by = CASE WHEN ? != '' THEN ? ELSE kactus_validated_by END,
        kactus_validated_at = CASE WHEN ? != '' THEN CURRENT_TIMESTAMP ELSE kactus_validated_at END,
        last_checked_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    result.status,
    result.method,
    result.resultUrl || "",
    result.summary,
    userName,
    userName,
    userName,
    id
  );
}

async function runKactusSearch(venue, body = {}) {
  const queryParts = [
    venue.name,
    body.variants || "",
    venue.city,
    venue.arrondissement,
    venue.address
  ].filter(Boolean);
  const query = `site:kactus.com ${queryParts.join(" ")}`;
  const method = `Recherche domaine kactus.com: ${query}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Prospect Lieux B2B Kactus Verification/1.0",
        "Accept": "text/html"
      }
    });
    clearTimeout(timeout);
    if (!response.ok) {
      return {
        status: "Presence incertaine",
        method,
        resultUrl: "",
        summary: `Recherche Kactus echouee (${response.status}). Statut conserve en presence incertaine.`
      };
    }
    const html = await response.text();
    const candidates = extractKactusCandidates(html);
    const match = chooseKactusMatch(venue, candidates);
    if (match.status === "present") {
      return {
        status: "Present sur Kactus",
        method,
        resultUrl: match.url,
        summary: `Correspondance probable retrouvee sur Kactus: ${match.title || match.url}`
      };
    }
    if (match.status === "ambiguous") {
      return {
        status: "Presence incertaine",
        method,
        resultUrl: match.url || "",
        summary: `Resultat ambigu sur Kactus: ${match.title || "correspondance insuffisante"}. Validation manuelle necessaire.`
      };
    }
    return {
      status: "Absent de Kactus",
      method,
      resultUrl: "",
      summary: "Recherche Kactus terminee sans correspondance suffisante."
    };
  } catch (error) {
    return {
      status: "Presence incertaine",
      method,
      resultUrl: "",
      summary: `Recherche Kactus interrompue (${error.name === "AbortError" ? "timeout" : error.message}). Statut conserve en presence incertaine.`
    };
  }
}

function extractKactusCandidates(html) {
  const candidates = [];
  const links = html.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi);
  for (const link of links) {
    const rawUrl = decodeHtml(link[1] || "");
    const title = stripHtml(link[2] || "");
    const url = normalizeSearchUrl(rawUrl);
    if (!url || !/\/\/([^/]+\.)?kactus\.com\//i.test(url)) continue;
    if (/duckduckgo\.com|google\./i.test(url)) continue;
    candidates.push({ url, title });
  }
  return candidates.slice(0, 10);
}

function chooseKactusMatch(venue, candidates) {
  const venueName = normalizeText(venue.name);
  const venueAddress = normalizeText(venue.address);
  const venueCity = normalizeText([venue.city, venue.arrondissement].filter(Boolean).join(" "));
  let ambiguous = null;
  for (const candidate of candidates) {
    const haystack = normalizeText(`${candidate.title} ${candidate.url}`);
    const nameHit = venueName && (haystack.includes(venueName) || venueName.includes(haystack.split(" ").slice(0, 4).join(" ")));
    const locationHit = venueCity && haystack.includes(venueCity);
    const addressTokens = venueAddress.split(" ").filter((token) => token.length > 2);
    const addressScore = addressTokens.filter((token) => haystack.includes(token)).length;
    if (nameHit && (locationHit || addressScore >= 2)) return { status: "present", ...candidate };
    if (nameHit || addressScore >= 2) ambiguous = { status: "ambiguous", ...candidate };
  }
  return ambiguous || { status: "absent" };
}

function normalizeSearchUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    if (url.includes("/l/?")) {
      const wrapped = new URL(url, "https://duckduckgo.com");
      return wrapped.searchParams.get("uddg") || "";
    }
    return new URL(url, "https://duckduckgo.com").href;
  } catch {
    return "";
  }
}

function stripHtml(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(config.publicDir, requested));
  if (!filePath.startsWith(config.publicDir)) return sendJson(res, 403, { error: "Acces refuse" });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return sendJson(res, 404, { error: "Page introuvable" });
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers = rows.shift()?.map((header) => normalizeHeader(header)) || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function csvRowToVenue(row) {
  const name = row.name || row.nom || row.lieu || row.nom_du_lieu || "";
  const address = row.address || row.adresse || "";
  return {
    name,
    venueType: row.venue_type || row.type || row.type_de_lieu || "Lieu atypique",
    address,
    city: row.city || row.ville || "",
    arrondissement: row.arrondissement || "",
    zone: row.zone || "",
    phone: row.phone || row.telephone || "",
    website: row.website || row.site || row.site_internet || "",
    mapsUrl: row.maps_url || row.lien_google_maps || googleMapsSearchUrl(name, address),
    capacity: row.capacity || row.capacite || null,
    privateHire: row.private_hire || row.privatisable || "A verifier",
    kactusStatus: row.kactus_status || row.statut_kactus || "Presence incertaine",
    source: "Import CSV",
    commercial: {
      responsible: row.responsible || row.responsable || "Steven",
      status: row.status || row.statut || row.statut_commercial || "Nouveau",
      comment: row.comment || row.commentaire || "",
      contacted: row.contacted || row.contact || "Non",
      interested: row.interested || row.interesse || "A verifier",
      directEmail: row.direct_email || row.email || row.e_mail || ""
    }
  };
}

function googleMapsSearchUrl(name, address = "") {
  const query = encodeURIComponent([name, address].filter(Boolean).join(", "));
  return query ? `https://www.google.com/maps/search/?api=1&query=${query}` : "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}
