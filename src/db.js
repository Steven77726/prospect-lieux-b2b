import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { demoVenues } from "./demo-data.js";

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA journal_mode = WAL");

export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizePhone(value = "") {
  return String(value).replace(/[^\d+]/g, "");
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL DEFAULT 'Prospection'
    );

    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      google_place_id TEXT UNIQUE,
      name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      venue_type TEXT,
      address TEXT,
      normalized_address TEXT,
      city TEXT,
      arrondissement TEXT,
      zone TEXT,
      phone TEXT,
      normalized_phone TEXT,
      website TEXT,
      maps_url TEXT,
      photos_json TEXT NOT NULL DEFAULT '[]',
      rating REAL,
      review_count INTEGER,
      capacity INTEGER,
      private_hire TEXT NOT NULL DEFAULT 'A verifier',
      kactus_status TEXT NOT NULL DEFAULT 'Presence incertaine',
      last_checked_at TEXT,
      source TEXT NOT NULL DEFAULT 'A verifier',
      sync_status TEXT NOT NULL DEFAULT 'Nouveau',
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_venues_place_id ON venues(google_place_id);
    CREATE INDEX IF NOT EXISTS idx_venues_lookup ON venues(normalized_name, normalized_address, normalized_phone);
    CREATE INDEX IF NOT EXISTS idx_venues_filters ON venues(city, arrondissement, venue_type, kactus_status, sync_status);

    CREATE TABLE IF NOT EXISTS commercial_data (
      venue_id INTEGER PRIMARY KEY,
      contacted TEXT NOT NULL DEFAULT 'Non',
      responsible TEXT NOT NULL DEFAULT 'Steven',
      interested TEXT NOT NULL DEFAULT 'A verifier',
      comment TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '',
      contact_role TEXT NOT NULL DEFAULT '',
      direct_email TEXT NOT NULL DEFAULT '',
      contact_method TEXT NOT NULL DEFAULT 'Telephone',
      first_contact_date TEXT NOT NULL DEFAULT '',
      last_contact_date TEXT NOT NULL DEFAULT '',
      next_follow_up_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'Nouveau',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_commercial_status ON commercial_data(status, responsible, contacted, interested, next_follow_up_date);

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      venue_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      comment TEXT NOT NULL DEFAULT '',
      status_change TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      mode TEXT NOT NULL,
      new_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      verify_count INTEGER NOT NULL DEFAULT 0,
      kactus_count INTEGER NOT NULL DEFAULT 0,
      commercial_overwrite_count INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS sync_progress (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_step_index INTEGER NOT NULL DEFAULT 0,
      pending_json TEXT NOT NULL DEFAULT '[]',
      pending_index INTEGER NOT NULL DEFAULT 0,
      total_steps INTEGER NOT NULL DEFAULT 0,
      total_found INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      last_completed_step TEXT NOT NULL DEFAULT '',
      last_endpoint TEXT NOT NULL DEFAULT '',
      initial_completed INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sync_step_status (
      step_key TEXT PRIMARY KEY,
      zone TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'A faire',
      found_count INTEGER NOT NULL DEFAULT 0,
      added_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      endpoint TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  ensureColumn("venues", "kactus_verified_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "kactus_verification_method", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "kactus_result_url", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "kactus_result_summary", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "kactus_validated_by", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "kactus_validated_at", "TEXT NOT NULL DEFAULT ''");
  ensureColumn("venues", "already_done", "INTEGER NOT NULL DEFAULT 0");

  db.prepare("INSERT OR IGNORE INTO users (name) VALUES (?), (?)").run("Steven", "Gabriel");
  db.prepare(`
    UPDATE sync_runs
    SET finished_at = CURRENT_TIMESTAMP,
        message = 'Synchronisation interrompue avant la fin. Aucune donnee commerciale modifiee.'
    WHERE finished_at IS NULL
  `).run();
  db.prepare(`
    UPDATE sync_runs
    SET message = 'Ancienne initialisation demo. La synchronisation actuelle utilise OpenStreetMap / Overpass.'
    WHERE message LIKE '%GOOGLE_PLACES_API_KEY%' OR message LIKE '%Google Places%'
  `).run();
  db.prepare(`
    UPDATE sync_runs
    SET message = 'Overpass public etait temporairement indisponible. Aucun lieu ajoute, aucune donnee commerciale modifiee.'
    WHERE message LIKE 'Erreur Overpass:%'
  `).run();
  db.prepare("INSERT OR IGNORE INTO sync_progress (id) VALUES (1)").run();
  seedDemoData();
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some((item) => item.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function saveSyncStepStatus(step) {
  db.prepare(`
    INSERT INTO sync_step_status (
      step_key, zone, category, status, found_count, added_count, duplicate_count, endpoint, error, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(step_key) DO UPDATE SET
      zone = excluded.zone,
      category = excluded.category,
      status = excluded.status,
      found_count = excluded.found_count,
      added_count = excluded.added_count,
      duplicate_count = excluded.duplicate_count,
      endpoint = excluded.endpoint,
      error = excluded.error,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    step.stepKey,
    step.zone,
    step.category,
    step.status,
    step.foundCount || 0,
    step.addedCount || 0,
    step.duplicateCount || 0,
    step.endpoint || "",
    step.error || ""
  );
}

export function getSyncStepStatuses(limit = 12) {
  return db.prepare(`
    SELECT step_key, zone, category, status, found_count, added_count, duplicate_count, endpoint, error, updated_at
    FROM sync_step_status
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit);
}

function seedDemoData() {
  const count = db.prepare("SELECT COUNT(*) AS count FROM venues").get().count;
  if (count > 0) return;
  const run = createSyncRun("demo");
  let added = 0;
  for (const venue of demoVenues) {
    const result = upsertVenue(venue, { isDemo: true, userName: "Steven" });
    if (result.action === "inserted") added += 1;
  }
  finishSyncRun(run.id, {
    newCount: added,
    updatedCount: 0,
    verifyCount: 0,
    kactusCount: demoVenues.filter((item) => item.kactusStatus === "Present sur Kactus").length,
    message: "Mode demonstration initialise avec des donnees fictives."
  });
}

export function createSyncRun(mode) {
  const result = db.prepare("INSERT INTO sync_runs (mode, message) VALUES (?, ?)").run(mode, "Synchronisation en cours");
  return { id: Number(result.lastInsertRowid) };
}

export function finishSyncRun(id, summary) {
  db.prepare(`
    UPDATE sync_runs
    SET finished_at = CURRENT_TIMESTAMP,
        new_count = ?,
        updated_count = ?,
        verify_count = ?,
        kactus_count = ?,
        commercial_overwrite_count = 0,
        message = ?
    WHERE id = ?
  `).run(
    summary.newCount || 0,
    summary.updatedCount || 0,
    summary.verifyCount || 0,
    summary.kactusCount || 0,
    summary.message || "Synchronisation terminee",
    id
  );
}

export function getSyncProgress() {
  const row = db.prepare("SELECT * FROM sync_progress WHERE id = 1").get();
  return {
    currentStepIndex: row.current_step_index,
    pending: JSON.parse(row.pending_json || "[]"),
    pendingIndex: row.pending_index,
    totalSteps: row.total_steps,
    totalFound: row.total_found,
    addedCount: row.added_count,
    duplicateCount: row.duplicate_count,
    lastCompletedStep: row.last_completed_step,
    lastEndpoint: row.last_endpoint,
    initialCompleted: Boolean(row.initial_completed),
    lastSyncAt: row.last_sync_at,
    updatedAt: row.updated_at
  };
}

export function saveSyncProgress(progress) {
  db.prepare(`
    UPDATE sync_progress
    SET current_step_index = ?,
        pending_json = ?,
        pending_index = ?,
        total_steps = ?,
        total_found = ?,
        added_count = ?,
        duplicate_count = ?,
        last_completed_step = ?,
        last_endpoint = ?,
        initial_completed = ?,
        last_sync_at = COALESCE(?, last_sync_at),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    progress.currentStepIndex,
    JSON.stringify(progress.pending || []),
    progress.pendingIndex || 0,
    progress.totalSteps || 0,
    progress.totalFound || 0,
    progress.addedCount || 0,
    progress.duplicateCount || 0,
    progress.lastCompletedStep || "",
    progress.lastEndpoint || "",
    progress.initialCompleted ? 1 : 0,
    progress.lastSyncAt || null
  );
}

export function upsertVenue(rawVenue, options = {}) {
  const venue = normalizeVenue(rawVenue);
  const existing = findExistingVenue(venue);
  if (existing) {
    db.prepare(`
      UPDATE venues SET
        google_place_id = COALESCE(?, google_place_id),
        name = ?, normalized_name = ?, venue_type = ?, address = ?,
        normalized_address = ?, city = ?, arrondissement = ?, zone = ?,
        phone = ?, normalized_phone = ?, website = ?, maps_url = ?,
        photos_json = ?, rating = ?, review_count = ?, capacity = COALESCE(?, capacity),
        private_hire = ?, kactus_status = ?, last_checked_at = CURRENT_TIMESTAMP,
        source = ?, sync_status = CASE WHEN sync_status = 'Nouveau' THEN 'Nouveau' ELSE 'Actualise' END,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      venue.googlePlaceId,
      venue.name,
      venue.normalizedName,
      venue.venueType,
      venue.address,
      venue.normalizedAddress,
      venue.city,
      venue.arrondissement,
      venue.zone,
      venue.phone,
      venue.normalizedPhone,
      venue.website,
      venue.mapsUrl,
      JSON.stringify(venue.photos),
      venue.rating,
      venue.reviewCount,
      venue.capacity,
      venue.privateHire,
      venue.kactusStatus,
      venue.source,
      existing.id
    );
    addHistory(existing.id, options.userName || "Steven", "Synchronisation", "Donnees publiques actualisees.", "");
    return { action: "updated", id: existing.id };
  }

  const result = db.prepare(`
    INSERT INTO venues (
      google_place_id, name, normalized_name, venue_type, address, normalized_address,
      city, arrondissement, zone, phone, normalized_phone, website, maps_url, photos_json,
      rating, review_count, capacity, private_hire, kactus_status, last_checked_at,
      source, sync_status, is_demo
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'Nouveau', ?)
  `).run(
    venue.googlePlaceId,
    venue.name,
    venue.normalizedName,
    venue.venueType,
    venue.address,
    venue.normalizedAddress,
    venue.city,
    venue.arrondissement,
    venue.zone,
    venue.phone,
    venue.normalizedPhone,
    venue.website,
    venue.mapsUrl,
    JSON.stringify(venue.photos),
    venue.rating,
    venue.reviewCount,
    venue.capacity,
    venue.privateHire,
    venue.kactusStatus,
    venue.source,
    options.isDemo ? 1 : 0
  );
  const id = Number(result.lastInsertRowid);
  const commercial = rawVenue.commercial || {};
  db.prepare(`
    INSERT INTO commercial_data (
      venue_id, contacted, responsible, interested, comment, contact_name, contact_role,
      direct_email, contact_method, first_contact_date, last_contact_date, next_follow_up_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    commercial.contacted || "Non",
    commercial.responsible || "Steven",
    commercial.interested || "A verifier",
    commercial.comment || "",
    commercial.contactName || "",
    commercial.contactRole || "",
    commercial.directEmail || "",
    commercial.contactMethod || "Telephone",
    commercial.firstContactDate || "",
    commercial.lastContactDate || "",
    commercial.nextFollowUpDate || "",
    commercial.status || (venue.kactusStatus === "Present sur Kactus" ? "Present sur Kactus" : "Nouveau")
  );
  addHistory(id, options.userName || "Steven", "Creation", "Lieu ajoute a la base.", commercial.status || "Nouveau");
  return { action: "inserted", id };
}

function normalizeVenue(raw) {
  const address = raw.address || "";
  const city = raw.city || detectCity(address);
  const arrondissement = raw.arrondissement || detectArrondissement(address);
  return {
    googlePlaceId: raw.googlePlaceId || raw.google_place_id || null,
    name: raw.name || "Lieu sans nom",
    normalizedName: normalizeText(raw.name || ""),
    venueType: raw.venueType || raw.venue_type || "Lieu atypique",
    address,
    normalizedAddress: normalizeText(address),
    city,
    arrondissement,
    zone: raw.zone || (city === "Paris" && arrondissement ? `Paris ${arrondissement}` : city),
    phone: raw.phone || "",
    normalizedPhone: normalizePhone(raw.phone || ""),
    website: raw.website || "",
    mapsUrl: raw.mapsUrl || raw.maps_url || "",
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    rating: raw.rating ?? null,
    reviewCount: raw.reviewCount ?? raw.review_count ?? null,
    capacity: raw.capacity ?? null,
    privateHire: raw.privateHire || raw.private_hire || "A verifier",
    kactusStatus: raw.kactusStatus || raw.kactus_status || "Presence incertaine",
    source: raw.source || "Saisie manuelle"
  };
}

function findExistingVenue(venue) {
  if (venue.googlePlaceId) {
    const byPlaceId = db.prepare("SELECT id FROM venues WHERE google_place_id = ?").get(venue.googlePlaceId);
    if (byPlaceId) return byPlaceId;
  }
  if (venue.normalizedPhone) {
    const byPhone = db.prepare("SELECT id FROM venues WHERE normalized_phone = ?").get(venue.normalizedPhone);
    if (byPhone) return byPhone;
  }
  if (venue.normalizedName && venue.normalizedAddress) {
    return db.prepare("SELECT id FROM venues WHERE normalized_name = ? AND normalized_address = ?").get(venue.normalizedName, venue.normalizedAddress);
  }
  return null;
}

export function addHistory(venueId, userName, actionType, comment, statusChange = "") {
  db.prepare(`
    INSERT INTO history (venue_id, user_name, action_type, comment, status_change)
    VALUES (?, ?, ?, ?, ?)
  `).run(venueId, userName, actionType, comment || "", statusChange || "");
}

function detectCity(address) {
  if (/boulogne/i.test(address)) return "Boulogne-Billancourt";
  if (/paris/i.test(address) || /750\d{2}/.test(address)) return "Paris";
  return "A verifier";
}

function detectArrondissement(address) {
  const match = String(address).match(/750(\d{2})/);
  if (!match) return "";
  return `${Number(match[1])}e`;
}

export function mapVenueRow(row) {
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
      contacted: row.contacted,
      responsible: row.responsible,
      interested: row.interested,
      comment: row.comment,
      contactName: row.contact_name,
      contactRole: row.contact_role,
      directEmail: row.direct_email,
      contactMethod: row.contact_method,
      firstContactDate: row.first_contact_date,
      lastContactDate: row.last_contact_date,
      nextFollowUpDate: row.next_follow_up_date,
      status: row.status
    }
  };
}
