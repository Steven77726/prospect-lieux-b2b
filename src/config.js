import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function loadEnvFile() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...valueParts] = trimmed.split("=");
    if (!process.env[key]) process.env[key] = valueParts.join("=").trim();
  }
}

loadEnvFile();

export const config = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  port: Number(process.env.PORT || 4317),
  databasePath: path.resolve(rootDir, process.env.DATABASE_PATH || "./data/prospect-lieux-b2b.sqlite"),
  overpassEndpoint: process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter",
  syncLimit: Number(process.env.SYNC_LIMIT || 20),
  autoSyncWeekly: String(process.env.AUTO_SYNC_WEEKLY || "false").toLowerCase() === "true"
};
