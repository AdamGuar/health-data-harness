import { importIncomingDirectory } from "./importer.js";

const result = importIncomingDirectory();

console.log(
  JSON.stringify(
    {
      ok: true,
      dbPath: result.dbPath,
      importedFiles: result.importedFiles,
      skippedFiles: result.skippedFiles,
      points: result.points,
      files: result.files
    },
    null,
    2
  )
);
