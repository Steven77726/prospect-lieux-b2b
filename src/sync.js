import {
  createSyncRun,
  finishSyncRun,
  getSyncProgress,
  getSyncStepStatuses,
  saveSyncProgress,
  saveSyncStepStatus,
  upsertVenue
} from "./db.js";

const batchSize = 100;
const miniLimit = 25;
const pauseMs = 2500;
const maxRunMs = 110000;

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

export async function runVenueSync(options = {}) {
  const limit = Math.min(Math.max(Number(options.limit || batchSize), 1), batchSize);
  const onlySteps = Array.isArray(options.onlySteps) ? options.onlySteps : null;
  const progress = hydrateProgress(getSyncProgress());
  const run = createSyncRun(onlySteps ? "openstreetmap_overpass_test" : "openstreetmap_overpass_batch");
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
  const startedAt = Date.now();

  for (const step of stepSource) {
    if (!onlySteps && newCount >= limit) break;
    if (!onlySteps && Date.now() - startedAt > maxRunMs) break;
    const result = await runMiniStep(step, workingEndpoint);
    workingEndpoint = result.workingEndpoint || workingEndpoint;
    Object.assign(errorsByEndpoint, result.errorsByEndpoint);
    stepsTried += 1;

    if (!result.ok) {
      retrySteps.push(`${step.zone.name} — ${step.search.type}`);
      saveSyncStepStatus({
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
        saveProgress(progress, workingEndpoint);
      }
      continue;
    }

    const counts = saveCandidates(result.candidates, limit - newCount);
    newCount += counts.newCount;
    duplicateCount += counts.duplicateCount;
    updatedCount += counts.duplicateCount;
    verifyCount += counts.verifyCount;
    progress.totalFound += result.candidates.length;
    progress.addedCount += counts.newCount;
    progress.duplicateCount += counts.duplicateCount;
    successfulSteps.push(`${step.zone.name} — ${step.search.type} — Termine`);
    saveSyncStepStatus({
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
      saveProgress(progress, workingEndpoint);
    }

    await pause();
  }

  if (!onlySteps && progress.currentStepIndex >= steps.length) progress.initialCompleted = true;
  progress.lastSyncAt = new Date().toISOString();
  saveProgress(progress, workingEndpoint);
  finishSyncRun(run.id, {
    newCount,
    updatedCount,
    verifyCount,
    kactusCount: 0,
    message: progress.initialCompleted
      ? `Synchronisation initiale terminee. Serveur: ${workingEndpoint}`
      : `Lot termine. ${newCount} nouveaux, ${duplicateCount} doublons, ${stepsTried} mini-etapes.`
  });

  return buildSummary({
    progress,
    newCount,
    updatedCount,
    duplicateCount,
    verifyCount,
    workingEndpoint,
    errorsByEndpoint,
    successfulSteps,
    retrySteps
  });
}

export async function runTargetedSync() {
  const zone = zones.find((item) => item.name === "Paris 8e");
  const wanted = new Set(["Hotel", "Centre de conference", "Auditorium", "Lieu de reception", "Espace atypique"]);
  const targeted = searchPlan
    .filter((search) => wanted.has(search.type))
    .map((search) => ({ zone, search, key: `test::${zone.name}::${search.type}::${search.key}::${search.value}` }));
  return runVenueSync({ limit: batchSize, onlySteps: targeted });
}

export function getProgressSummary() {
  return summarizeProgress(hydrateProgress(getSyncProgress()));
}

async function runMiniStep(step, preferredEndpoint) {
  const query = buildQuery(step);
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

function buildQuery(step) {
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
      "User-Agent": "Prospect-Lieux-B2B/0.5 (local CRM; 25-result mini batch)"
    },
    body: new URLSearchParams({ data: query }).toString(),
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status}: ${body.replace(/\s+/g, " ").slice(0, 220)}`);
  }

  const json = await response.json();
  return json.elements || [];
}

function saveCandidates(candidates, remainingNewTarget) {
  let newCount = 0;
  let duplicateCount = 0;
  let verifyCount = 0;
  for (const candidate of candidates) {
    if (newCount >= remainingNewTarget) break;
    const result = upsertVenue(candidate, { isDemo: false, userName: "Steven" });
    if (result.action === "inserted") newCount += 1;
    else duplicateCount += 1;
    if (candidate.kactusStatus === "Presence incertaine") verifyCount += 1;
  }
  return { newCount, duplicateCount, verifyCount };
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

function hydrateProgress(progress) {
  return {
    ...progress,
    totalSteps: steps.length || progress.totalSteps,
    pending: [],
    pendingIndex: 0,
    currentStepIndex: Math.min(progress.currentStepIndex || 0, steps.length)
  };
}

function saveProgress(progress, workingEndpoint) {
  progress.pending = [];
  progress.pendingIndex = 0;
  progress.totalSteps = steps.length;
  progress.lastEndpoint = workingEndpoint || progress.lastEndpoint || "";
  saveSyncProgress(progress);
}

function buildSummary({ progress, newCount, updatedCount, duplicateCount, verifyCount, workingEndpoint, errorsByEndpoint, successfulSteps, retrySteps }) {
  return {
    newCount,
    updatedCount,
    duplicateCount,
    verifyCount,
    kactusCount: 0,
    commercialOverwriteCount: 0,
    source: "OpenStreetMap / Overpass",
    limit: batchSize,
    workingEndpoint,
    errorsByEndpoint,
    successfulSteps,
    retrySteps,
    progress: summarizeProgress(progress)
  };
}

function summarizeProgress(progress) {
  const current = steps[progress.currentStepIndex];
  const percent = progress.totalSteps ? Math.min(100, Math.round((progress.currentStepIndex / progress.totalSteps) * 100)) : 0;
  const stepStatuses = getSyncStepStatuses(500);
  const completedSteps = stepStatuses.filter((step) => step.status === "Termine").length;
  const retrySteps = stepStatuses.filter((step) => step.status === "A reprendre").length;
  return {
    percent: progress.initialCompleted ? 100 : percent,
    imported: progress.addedCount,
    duplicatesIgnored: progress.duplicateCount,
    completedSteps,
    retrySteps,
    totalSteps: steps.length,
    totalFound: progress.totalFound,
    remaining: progress.initialCompleted ? 0 : null,
    currentZone: current?.zone.name || "",
    currentCategory: current?.search.type || "",
    nextStep: progress.initialCompleted ? "Synchronisation initiale terminee" : current ? `${current.zone.name} / ${current.search.type}` : "",
    lastCompletedStep: progress.lastCompletedStep,
    initialCompleted: progress.initialCompleted,
    lastEndpoint: progress.lastEndpoint,
    lastSyncAt: progress.lastSyncAt,
    recentSteps: stepStatuses.slice(0, 10).map((step) => `${step.zone} — ${step.category} — ${step.status}`)
  };
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

function isFoodService(tags = {}) {
  const foodAmenities = new Set(["restaurant", "cafe", "bar", "pub", "fast_food", "food_court", "biergarten"]);
  return foodAmenities.has(String(tags.amenity || "").toLowerCase());
}

function readCapacity(tags) {
  const raw = tags.capacity || tags["capacity:persons"] || tags.seats || "";
  const value = Number(String(raw).match(/\d+/)?.[0] || 0);
  return value || null;
}

function formatEndpointErrors(errorsByEndpoint) {
  return Object.entries(errorsByEndpoint).map(([endpoint, error]) => `${endpoint}: ${error}`).join(" | ");
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, pauseMs));
}

export function startWeeklySync() {
  const week = 7 * 24 * 60 * 60 * 1000;
  return setInterval(() => {
    runVenueSync().catch((error) => {
      console.error("[weekly-sync]", error);
    });
  }, week);
}
