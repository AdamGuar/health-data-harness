import { execFileSync } from "node:child_process";

const forbiddenRules = [
  {
    name: ".env files",
    matches: (path) => path === ".env" || path.startsWith(".env.")
  },
  {
    name: "private health data",
    matches: (path) => path === "data" || path.startsWith("data/")
  },
  {
    name: "runtime files",
    matches: (path) => path === ".runtime" || path.startsWith(".runtime/")
  },
  {
    name: "dependencies",
    matches: (path) => path === "node_modules" || path.startsWith("node_modules/")
  },
  {
    name: "ngrok config",
    matches: (path) =>
      path === "ngrok.yml" ||
      path === "ngrok.yaml" ||
      path.startsWith(".ngrok")
  },
  {
    name: "health artifacts",
    matches: (path) =>
      isGeneratedHealthArtifact(path) &&
      path !== "artifacts/health/reports/.gitkeep" &&
      path !== "artifacts/health/conversations/.gitkeep"
  }
];

const stagedPaths = getStagedPaths();
const violations = stagedPaths.flatMap((path) =>
  forbiddenRules
    .filter((rule) => rule.matches(path))
    .map((rule) => ({ path, rule: rule.name }))
);

if (violations.length > 0) {
  console.error("Refusing to commit private/generated local files:");
  for (const violation of violations) {
    console.error(`- ${violation.path} (${violation.rule})`);
  }
  console.error("");
  console.error("Unstage them with: git restore --staged <path>");
  process.exit(1);
}

console.log(`precommit: private path check passed (${stagedPaths.length} staged files)`);

function getStagedPaths() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "-z"],
    { encoding: "utf8" }
  );

  return output
    .split("\0")
    .filter(Boolean)
    .map((path) => path.replaceAll("\\", "/"));
}

function isGeneratedHealthArtifact(path) {
  return (
    path.startsWith("artifacts/health/reports/") ||
    path.startsWith("artifacts/health/conversations/")
  );
}
