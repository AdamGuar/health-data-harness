import { importIncomingDirectory } from "./importer.js";

const result = importIncomingDirectory();

console.log(JSON.stringify({ ok: true, ...result }, null, 2));
