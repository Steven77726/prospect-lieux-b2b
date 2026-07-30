// @ts-nocheck
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const batchSize = 100;
const miniLimit = 25;
const pauseMs = 2500;

const overpassEndpoints = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

const zones = [
  { name: "Paris 1er", city: "Paris", arrondissement: "1e", bbox: "48.856,2.330,48.866,2.350" },
  { name: "Paris 2e", city: "Paris", arrondissement: "2e", bbox: "48.863,2.335,48.872,2.353" },
  { name: "Paris 3e", city: "Paris", arrondissement: "3e", bbox: "48.858,2.352,48.868,2.367" },
  { name: "Paris 4e", city: "Paris", arrondissement: "4e", bbox: "48.848,2.350,48.861,2.370" },
  { name: "Paris 5e", city: "Paris", arrondissement: "5e", bbox: "48.839,2.335,48.853,2.365" },
  { name: "Paris 6e", city: "Paris", arrondissement: "6e", bbox: "48.843,2.318,48.858,2.345" },
  { name: "Paris 7e", city: "Paris", arrondissement: "7e", bbox: "48.850,2.285,48.866,2.330" },
  { name: "Paris 8e", city: "Paris", arrondissement: "8e", bbox: "48.865,2.295,48.883,2.335" },
  { name: "Paris 9e", city: "Paris", arrondissement: "9e", bbox: "48.872,2.325,48.885,2.350" },
  { name: "Paris 10e", city: "Paris", arrondissement: "10e", bbox: "48.868,2.350,48.884,2.380" },
  { name: "Paris 11e", city: "Paris", arrondissement: "11e", bbox: "48.850,2.365,48.870,2.395" },
  { name: "Paris 12e", city: "Paris", arrondissement: "12e", bbox: "48.825,2.370,48.850,2.420" },
  { name: "Paris 13e", city: "Paris", arrondissement: "13e", bbox: "48.815,2.335,48.845,2.390" },
  { name: "Paris 14e", city: "Paris", arrondissement: "14e", bbox: "48.815,2.300,48.845,2.345" },
  { name: "Paris 15e", city: "Paris", arrondissement: "15e", bbox: "48.825,2.275,48.855,2.315" },
  { name: "Paris 16e", city: "Paris", arrondissement: "16e", bbox: "48.840,2.240,48.885,2.295" },
  { name: "Paris 17e", city: "Paris", arrondissement: "17e", bbox: "48.875,2.285,48.900,2.335" },
  { name: "Paris 18e", city: "Paris", arrondissement: "18e", bbox: "48.880,2.325,48.900,2.370" },
  { name: "Paris 19e", city: "Paris", arrondissement: "19e", bbox: "48.870,2.370,48.895,2.410" },
  { name: "Paris 20e", city: "Paris", arrondissement: "20e", bbox: "48.850,2.385,48.875,2.430" },
  { name: "Boulogne-Billancourt", city: "Boulogne-Billancourt", arrondissement: "", bbox: "48.817,2.220,48.850,2.270" }
];

const searchPlan = [
  { key: "tourism", value: "hotel", type: "Hotel" },
  { key: "building", value: "hotel", type: "Hotel" },
  { key: "tourism", value: "hostel", type: "Hotel" },
  { key: "tourism", value: "apartment", type: "Hotel" },
  { key: "amenity", value: "conference_centre", type: "Centre de conference" },
  { key: "amenity", value: "exhibition_centre", type: "Centre de conference" },
  { key: "name", value: "conference|conférence|congres|congrès|seminaire|séminaire|meeting", type: "Centre de conference", regex: true },
  { key: "room", value: "meeting", type: "Salle de reunion" },
  { key: "room", value: "conference", type: "Salle de reunion" },
  { key: "name", value: "auditorium", type: "Auditorium", regex: true },
  { key: "tourism", value: "museum", type: "Musee" },
  { key: "amenity", value: "arts_centre", type: "Centre culturel" },
  { key: "amenity", value: "community_centre", type: "Salle polyvalente" },
  { key: "amenity", value: "public_building", type: "Salle polyvalente" },
  { key: "building", value: "public", type: "Salle polyvalente" },
  { key: "name", value: "rooftop", type: "Rooftop", regex: true },
  { key: "amenity", value: "events_venue", type: "Lieu de reception" },
  { key: "name", value: "reception|réception|seminaire|séminaire|événement|evenement|event|salons?", type: "Lieu de reception", regex: true },
  { key: "amenity", value: "coworking_space", type: "Coworking" },
  { key: "office", value: "coworking", type: "Coworking" },
  { key: "amenity", value: "theatre", type: "Theatre" },
  { key: "amenity", value: "cinema", type: "Auditorium" },
  { key: "amenity", value: "music_venue", type: "Lieu de reception" },
  { key: "leisure", value: "dance", type: "Lieu de reception" },
  { key: "tourism", value: "gallery", type: "Galerie" },
  { key: "shop", value: "art", type: "Galerie" },
  { key: "name", value: "loft|atypique|showroom|studio|terrasse|penthouse|privatisation|privatisable|salon", type: "Espace atypique", regex: true }
];

const steps = zones.flatMap((zone) => searchPlan.map((search) => ({
  zone,
  search,
  key: `${zone.name}::${search.type}::${search.key}::${search.value}`
})));

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1\/prospect-lieux-b2b/, "")
    .replace(/^\/prospect-lieux-b2b/, "") || "/";

  if (req.method === "OPTIONS") return new Response("ok", { headers: responseHeaders("text/plain") });

  try {
    if (path.startsWith("/api/")) return api(req, url, path);
    return json({ ok: true, message: "API Prospect Lieux B2B" });
  } catch (error) {
    return json({ error: error?.message || "Erreur serveur" }, 500);
  }
});

async function api(req: Request, url: URL, path: string) {
  if (path === "/api/dashboard" && req.method === "GET") return json(await dashboard());
  if (path === "/api/venues" && req.method === "GET") return json(await listVenues(url));
  if (path === "/api/venues" && req.method === "POST") return json(await createVenue(await req.json()), 201);
  if (path === "/api/sync-progress" && req.method === "GET") return json(await syncProgress());
  if (path === "/api/sync-runs" && req.method === "GET") return json(await rest("sync_runs", { order: "started_at.desc", limit: "10" }));
  if (path === "/api/sync" && req.method === "POST") return json(await runVenueSync({ limit: Number(url.searchParams.get("limit") || 100) }));
  if (path === "/api/sync-test" && req.method === "POST") return json(await runTargetedSync());
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
  else if (url.searchParams.get("includeKactus") !== "true") items = items.filter((v) => v.kactusStatus !== "Present sur Kactus");
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

async function runVenueSync(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || batchSize), 1), batchSize);
  const onlySteps = Array.isArray(options.onlySteps) ? options.onlySteps : null;
  const progress = await hydrateProgress();
  const run = await createSyncRun(onlySteps ? "openstreetmap_overpass_test" : "openstreetmap_overpass_batch");
  const errorsByEndpoint = {};
  let newCount = 0;
  let duplicateCount = 0;
  let updatedCount = 0;
  let verifyCount = 0;
  let stepsTried = 0;
  let workingEndpoint = progress.lastEndpoint || "";
  const successfulSteps = [];
  const retrySteps = [];
  const stepSource = onlySteps || steps.slice(progress.currentStepIndex);

  for (const step of stepSource) {
    if (!onlySteps && newCount >= limit) break;
    const result = await runMiniStep(step, workingEndpoint);
    workingEndpoint = result.workingEndpoint || workingEndpoint;
    Object.assign(errorsByEndpoint, result.errorsByEndpoint);
    stepsTried += 1;

    if (!result.ok) {
      retrySteps.push(`${step.zone.name} — ${step.search.type}`);
      await saveSyncStepStatus({
        stepKey: step.key,
        zone: step.zone.name,
        category: step.search.type,
        status: "A reprendre",
        error: formatEndpointErrors(result.errorsByEndpoint)
      });
      await pause();
      if (!onlySteps) {
        progress.currentStepIndex += 1;
        progress.lastCompletedStep = `${step.zone.name} — ${step.search.type} — A reprendre`;
        await saveProgress(progress, workingEndpoint);
      }
      continue;
    }

    const counts = await saveCandidates(result.candidates, limit - newCount);
    newCount += counts.newCount;
    duplicateCount += counts.duplicateCount;
    updatedCount += counts.duplicateCount;
    verifyCount += counts.verifyCount;
    progress.totalFound += result.candidates.length;
    progress.addedCount += counts.newCount;
    progress.duplicateCount += counts.duplicateCount;
    successfulSteps.push(`${step.zone.name} — ${step.search.type} — Termine`);
    await saveSyncStepStatus({
      stepKey: step.key,
      zone: step.zone.name,
      category: step.search.type,
      status: "Termine",
      foundCount: result.candidates.length,
      addedCount: counts.newCount,
      duplicateCount: counts.duplicateCount,
      endpoint: workingEndpoint
    });

    if (!onlySteps) {
      progress.currentStepIndex += 1;
      progress.lastCompletedStep = `${step.zone.name} — ${step.search.type} — Termine`;
      if (progress.currentStepIndex >= steps.length) progress.initialCompleted = true;
      await saveProgress(progress, workingEndpoint);
    }

    await pause();
  }

  if (!onlySteps && progress.currentStepIndex >= steps.length) progress.initialCompleted = true;
  progress.lastSyncAt = new Date().toISOString();
  await saveProgress(progress, workingEndpoint);
  await finishSyncRun(run.id, {
    newCount,
    updatedCount,
    verifyCount,
    kactusCount: 0,
    message: progress.initialCompleted
      ? `Synchronisation initiale terminee. Serveur: ${workingEndpoint}`
      : `Lot termine. ${newCount} nouveaux, ${duplicateCount} doublons, ${stepsTried} mini-etapes.`
  });

  return {
    newCount,
    updatedCount,
    duplicateCount,
    verifyCount,
    kactusCount: 0,
    commercialOverwriteCount: 0,
    source: "OpenStreetMap / Overpass",
    limit,
    workingEndpoint,
    errorsByEndpoint,
    successfulSteps,
    retrySteps,
    progress: await syncProgress()
  };
}

function runTargetedSync() {
  const zone = zones.find((item) => item.name === "Paris 8e");
  const wanted = new Set(["Hotel", "Centre de conference", "Auditorium", "Lieu de reception", "Espace atypique"]);
  const targeted = searchPlan
    .filter((search) => wanted.has(search.type))
    .map((search) => ({ zone, search, key: `test::${zone.name}::${search.type}::${search.key}::${search.value}` }));
  return runVenueSync({ limit: batchSize, onlySteps: targeted });
}

async function runMiniStep(step, preferredEndpoint) {
  const query = buildOverpassQuery(step);
  const errorsByEndpoint = {};
  const endpoints = preferredEndpoint
    ? [preferredEndpoint, ...overpassEndpoints.filter((endpoint) => endpoint !== preferredEndpoint)]
    : overpassEndpoints;

  for (const endpoint of endpoints) {
    try {
      const elements = await fetchOverpassEndpoint(endpoint, query);
      const candidates = elements
        .filter((element) => element.tags?.name && !isFoodService(element.tags))
        .map((element) => mapOsmElement(element, step));
      return { ok: true, candidates, workingEndpoint: endpoint, errorsByEndpoint };
    } catch (error) {
      errorsByEndpoint[endpoint] = error.message;
      await pause();
    }
  }
  return { ok: false, candidates: [], workingEndpoint: preferredEndpoint, errorsByEndpoint };
}

function buildOverpassQuery(step) {
  const { zone, search } = step;
  const selector = search.regex ? `["${search.key}"~"${search.value}",i]` : `["${search.key}"="${search.value}"]`;
  if (search.geometry === "all") {
    return `[out:json][timeout:20];(node${selector}(${zone.bbox});way${selector}(${zone.bbox});relation${selector}(${zone.bbox}););out center ${miniLimit};`;
  }
  return `[out:json][timeout:20];node${selector}(${zone.bbox});out tags ${miniLimit};`;
}

async function fetchOverpassEndpoint(endpoint, query) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "User-Agent": "Prospect-Lieux-B2B/1.0 (Supabase Edge Function; 25-result mini batch)"
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body.replace(/\s+/g, " ").slice(0, 220)}`);
  }

  const data = await response.json();
  return data.elements || [];
}

async function saveCandidates(candidates, remainingNewTarget) {
  let newCount = 0;
  let duplicateCount = 0;
  let verifyCount = 0;
  for (const candidate of candidates) {
    if (newCount >= remainingNewTarget) break;
    const result = await upsertSyncedVenue(candidate);
    if (result.action === "inserted") newCount += 1;
    else duplicateCount += 1;
    if (candidate.kactusStatus === "Presence incertaine") verifyCount += 1;
  }
  return { newCount, duplicateCount, verifyCount };
}

async function upsertSyncedVenue(candidate) {
  const venue = normalizeVenue(candidate);
  const existing = await findExistingVenue(venue);
  if (existing) {
    await patchRow("venues", {
      google_place_id: venue.googlePlaceId || existing.google_place_id,
      name: venue.name,
      normalized_name: venue.normalizedName,
      venue_type: venue.venueType,
      address: venue.address,
      normalized_address: venue.normalizedAddress,
      city: venue.city,
      arrondissement: venue.arrondissement,
      zone: venue.zone,
      phone: venue.phone,
      normalized_phone: venue.normalizedPhone,
      website: venue.website,
      maps_url: venue.mapsUrl,
      photos_json: JSON.stringify(venue.photos),
      rating: venue.rating,
      review_count: venue.reviewCount,
      capacity: venue.capacity || existing.capacity,
      private_hire: venue.privateHire,
      kactus_status: venue.kactusStatus,
      last_checked_at: new Date().toISOString(),
      source: venue.source,
      sync_status: existing.sync_status === "Nouveau" ? "Nouveau" : "Actualise",
      updated_at: new Date().toISOString()
    }, { id: `eq.${existing.id}` });
    await addHistory(existing.id, "Synchronisation", "Donnees publiques actualisees.", "", "Steven");
    return { action: "updated", id: existing.id };
  }

  const rows = await restWrite("venues", "POST", [{
    google_place_id: venue.googlePlaceId,
    name: venue.name,
    normalized_name: venue.normalizedName,
    venue_type: venue.venueType,
    address: venue.address,
    normalized_address: venue.normalizedAddress,
    city: venue.city,
    arrondissement: venue.arrondissement,
    zone: venue.zone,
    phone: venue.phone,
    normalized_phone: venue.normalizedPhone,
    website: venue.website,
    maps_url: venue.mapsUrl,
    photos_json: JSON.stringify(venue.photos),
    rating: venue.rating,
    review_count: venue.reviewCount,
    capacity: venue.capacity,
    private_hire: venue.privateHire,
    kactus_status: venue.kactusStatus,
    last_checked_at: new Date().toISOString(),
    source: venue.source,
    sync_status: "Nouveau",
    is_demo: false,
    already_done: false
  }], "return=representation");
  const id = rows[0].id;
  await restWrite("commercial_data", "POST", [{
    venue_id: id,
    contacted: "Non",
    responsible: "Steven",
    interested: "A verifier",
    comment: "",
    contact_method: "Telephone",
    status: "Nouveau"
  }], "return=minimal");
  await addHistory(id, "Synchronisation", "Nouveau lieu importe depuis OpenStreetMap.", "Nouveau", "Steven");
  return { action: "inserted", id };
}

async function findExistingVenue(venue) {
  if (venue.googlePlaceId) {
    const byPlaceId = await rest("venues", { select: "id,google_place_id,capacity,already_done,sync_status", google_place_id: `eq.${venue.googlePlaceId}`, limit: "1" });
    if (byPlaceId[0]) return byPlaceId[0];
  }
  const byName = await rest("venues", {
    select: "id,google_place_id,capacity,already_done,sync_status",
    normalized_name: `eq.${venue.normalizedName}`,
    normalized_address: `eq.${venue.normalizedAddress}`,
    limit: "1"
  });
  return byName[0] || null;
}

function mapOsmElement(element, step) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  const address = formatAddress(tags);
  const mapsQuery = encodeURIComponent(address ? `${tags.name}, ${address}` : `${tags.name} ${lat || ""},${lon || ""}`);

  return {
    googlePlaceId: `osm:${element.type}:${element.id}`,
    name: tags.name,
    venueType: inferVenueType(tags, step.search.type),
    address,
    city: step.zone.city,
    arrondissement: step.zone.arrondissement,
    zone: step.zone.name,
    phone: tags.phone || tags["contact:phone"] || "",
    website: tags.website || tags["contact:website"] || "",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
    photos: [],
    rating: null,
    reviewCount: null,
    capacity: readCapacity(tags),
    privateHire: "A verifier",
    kactusStatus: "Presence incertaine",
    source: `OpenStreetMap / Overpass (${element.type} ${element.id})`
  };
}

function normalizeVenue(raw) {
  return {
    googlePlaceId: raw.googlePlaceId || "",
    name: String(raw.name || "").trim(),
    normalizedName: normalizeText(raw.name || ""),
    venueType: raw.venueType || "Espace atypique",
    address: raw.address || "",
    normalizedAddress: normalizeText(raw.address || ""),
    city: raw.city || "Paris",
    arrondissement: raw.arrondissement || "",
    zone: raw.zone || raw.city || "Paris",
    phone: raw.phone || "",
    normalizedPhone: normalizePhone(raw.phone || ""),
    website: raw.website || "",
    mapsUrl: raw.mapsUrl || googleMapsSearchUrl(raw.name || "", raw.address || ""),
    photos: raw.photos || [],
    rating: raw.rating || null,
    reviewCount: raw.reviewCount || null,
    capacity: raw.capacity || null,
    privateHire: raw.privateHire || "A verifier",
    kactusStatus: raw.kactusStatus || "Presence incertaine",
    source: raw.source || "OpenStreetMap / Overpass"
  };
}

async function hydrateProgress() {
  const rows = await rest("sync_progress", { id: "eq.1", limit: "1" });
  const row = rows[0] || {};
  return {
    currentStepIndex: Math.min(row.current_step_index || 0, steps.length),
    totalSteps: steps.length,
    totalFound: row.total_found || 0,
    addedCount: row.added_count || 0,
    duplicateCount: row.duplicate_count || 0,
    lastCompletedStep: row.last_completed_step || "",
    lastEndpoint: row.last_endpoint || "",
    initialCompleted: Boolean(row.initial_completed),
    lastSyncAt: row.last_sync_at || ""
  };
}

async function saveProgress(progress, workingEndpoint) {
  await patchRow("sync_progress", {
    current_step_index: progress.currentStepIndex,
    pending_json: "[]",
    pending_index: 0,
    total_steps: steps.length,
    total_found: progress.totalFound,
    added_count: progress.addedCount,
    duplicate_count: progress.duplicateCount,
    last_completed_step: progress.lastCompletedStep || "",
    last_endpoint: workingEndpoint || progress.lastEndpoint || "",
    initial_completed: progress.initialCompleted,
    last_sync_at: progress.lastSyncAt || null,
    updated_at: new Date().toISOString()
  }, { id: "eq.1" });
}

async function createSyncRun(mode) {
  const rows = await restWrite("sync_runs", "POST", [{ mode, message: "Synchronisation en cours" }], "return=representation");
  return { id: rows[0].id };
}

async function finishSyncRun(id, summary) {
  await patchRow("sync_runs", {
    finished_at: new Date().toISOString(),
    new_count: summary.newCount || 0,
    updated_count: summary.updatedCount || 0,
    verify_count: summary.verifyCount || 0,
    kactus_count: summary.kactusCount || 0,
    commercial_overwrite_count: 0,
    message: summary.message || "Synchronisation terminee"
  }, { id: `eq.${id}` });
}

async function saveSyncStepStatus(step) {
  await restWrite("sync_step_status", "POST", [{
    step_key: step.stepKey,
    zone: step.zone,
    category: step.category,
    status: step.status,
    found_count: step.foundCount || 0,
    added_count: step.addedCount || 0,
    duplicate_count: step.duplicateCount || 0,
    endpoint: step.endpoint || "",
    error: step.error || ""
  }], "resolution=merge-duplicates", "step_key");
}

function formatAddress(tags) {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const postcode = tags["addr:postcode"] || "";
  const city = tags["addr:city"] || "";
  return [street, [postcode, city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

function inferVenueType(tags, fallback) {
  const joined = Object.entries(tags).map(([key, value]) => `${key}=${value}`).join(" ").toLowerCase();
  if (joined.includes("restaurant")) return "Restaurant";
  if (joined.includes("hotel")) return "Hotel";
  if (joined.includes("conference")) return "Centre de conference";
  if (joined.includes("auditorium")) return "Auditorium";
  if (joined.includes("museum")) return "Musee";
  if (joined.includes("arts_centre")) return "Centre culturel";
  if (joined.includes("community_centre")) return "Salle polyvalente";
  if (joined.includes("rooftop")) return "Rooftop";
  if (joined.includes("events_venue")) return "Lieu de reception";
  if (joined.includes("coworking")) return "Coworking";
  if (joined.includes("theatre") || joined.includes("théâtre")) return "Theatre";
  if (joined.includes("gallery") || joined.includes("galerie")) return "Galerie";
  if (joined.includes("loft") || joined.includes("atypique")) return "Espace atypique";
  if (joined.includes("meeting")) return "Salle de reunion";
  return fallback || "Espace atypique";
}

function readCapacity(tags) {
  const raw = tags.capacity || tags["capacity:persons"] || tags.seats || "";
  const value = Number(String(raw).match(/\d+/)?.[0] || 0);
  return value || null;
}

function isFoodService(tags = {}) {
  const foodAmenities = new Set(["restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "biergarten"]);
  return foodAmenities.has(String(tags.amenity || "").toLowerCase());
}

function formatEndpointErrors(errorsByEndpoint) {
  return Object.entries(errorsByEndpoint).map(([endpoint, error]) => `${endpoint}: ${error}`).join(" | ");
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, pauseMs));
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
  const text = await response.text();
  return text ? JSON.parse(text) : [];
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
    "access-control-allow-headers": "content-type"
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
