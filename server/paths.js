const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..");

function resolveProjectPath(relativeOrAbsolute, defaultRelative) {
  const value = relativeOrAbsolute || defaultRelative;
  if (path.isAbsolute(value)) return value;
  return path.join(PROJECT_ROOT, value.replace(/^\.\//, ""));
}

const dbPath = resolveProjectPath(process.env.DATABASE_PATH, "data/cludy.db");
const uploadDir = resolveProjectPath(process.env.UPLOAD_DIR, "uploads");
const vouchesPath = resolveProjectPath(process.env.DISCORD_VOUCHES_PATH, "data/vouches.json");

module.exports = { PROJECT_ROOT, dbPath, uploadDir, vouchesPath };
