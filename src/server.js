import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import express from "express";
import multer from "multer";

import { importSavedJsonFile } from "./importer.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const incomingDir = path.join(projectRoot, "data", "incoming");

const port = Number.parseInt(process.env.PORT ?? "8080", 10);
const authHeader = (process.env.HEALTH_AUTH_HEADER ?? "x-health-auth").toLowerCase();
const ingestKey = process.env.HEALTH_INGEST_KEY;
const maxUploadMb = Number.parseInt(process.env.MAX_UPLOAD_MB ?? "100", 10);
const maxUploadBytes = maxUploadMb * 1024 * 1024;

if (!ingestKey || ingestKey === "replace-with-a-long-random-secret") {
  throw new Error("Set HEALTH_INGEST_KEY in .env before starting the server.");
}

fs.mkdirSync(incomingDir, { recursive: true });

const app = express();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, incomingDir),
    filename: (_req, file, cb) => {
      cb(null, `${timestamp()}-${randomId()}-${safeName(file.originalname || "upload.bin")}`);
    }
  }),
  limits: {
    fileSize: maxUploadBytes,
    files: 20
  }
});

app.use((req, res, next) => {
  if (req.path === "/health") {
    next();
    return;
  }

  const suppliedKey = req.get(authHeader);
  if (!suppliedKey || !constantTimeEquals(suppliedKey, ingestKey)) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/ingest", upload.any(), async (req, res, next) => {
  try {
    const files = req.files ?? [];
    if (files.length > 0) {
      const importedFiles = files.map((file) => ({
        field: file.fieldname,
        originalName: file.originalname,
        savedAs: path.basename(file.path),
        bytes: file.size,
        import: maybeImportJson(file.path)
      }));

      res.status(201).json({
        ok: true,
        mode: "multipart",
        files: importedFiles
      });
      return;
    }

    const saved = await saveRawRequest(req);
    res.status(201).json({
      ok: true,
      mode: "raw",
      file: saved.name,
      bytes: saved.bytes,
      import: maybeImportJson(saved.path)
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 500;
  res.status(status).json({
    error: status === 413 ? `upload too large, max ${maxUploadMb}MB` : "internal_error"
  });
});

app.listen(port, () => {
  console.log(`Health ingest server listening on http://localhost:${port}`);
  console.log(`Send uploads to POST /ingest with header ${authHeader}: <HEALTH_INGEST_KEY>`);
});

function saveRawRequest(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.get("content-type") ?? "application/octet-stream";
    const extension = extensionFromContentType(contentType);
    const name = `${timestamp()}-${randomId()}${extension}`;
    const filePath = path.join(incomingDir, name);
    const stream = fs.createWriteStream(filePath);
    let bytes = 0;

    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > maxUploadBytes) {
        stream.destroy();
        req.destroy();
        reject(Object.assign(new Error("upload too large"), { code: "LIMIT_FILE_SIZE" }));
        return;
      }
      stream.write(chunk);
    });

    req.on("end", () => {
      stream.end(() => resolve({ name, path: filePath, bytes }));
    });

    req.on("error", reject);
    stream.on("error", reject);
  });
}

function extensionFromContentType(contentType) {
  if (contentType.includes("json")) return ".json";
  if (contentType.includes("xml")) return ".xml";
  if (contentType.includes("zip")) return ".zip";
  if (contentType.includes("csv")) return ".csv";
  if (contentType.includes("text/plain")) return ".txt";
  return ".bin";
}

function safeName(name) {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function randomId() {
  return crypto.randomBytes(6).toString("hex");
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function maybeImportJson(filePath) {
  if (!filePath.toLowerCase().endsWith(".json")) {
    return {
      skipped: true,
      reason: "not_json"
    };
  }

  return importSavedJsonFile(filePath);
}
