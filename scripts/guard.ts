import { runGuard } from "./lib/guard-core.ts";
import { listTrackedFiles } from "./lib/list-files.ts";

const main = (): void => {
  const files = listTrackedFiles(process.cwd());
  const violations = runGuard(files);
  if (violations.length === 0) {
    console.log("guard: OK");
    process.exit(0);
  }
  for (const violation of violations) {
    console.error(`${violation.file}:${violation.line}: [${violation.rule}] ${violation.detail}`);
  }
  console.error(`guard: ${violations.length} violation(s)`);
  process.exit(1);
};

main();
