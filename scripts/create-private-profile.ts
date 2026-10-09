/** Local provisioning only. Prints counts, never financial records or credentials. */
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { mapPrivateFinanceExport } from "../src/lib/private-import";
import {
  privateProfileDirectory,
  provisionPrivateProfile,
} from "../src/lib/private-profile-store";

try {
  const sourceFile = process.argv[2];
  if (!sourceFile) throw new Error("Missing source");
  process.env.FINANCE_PRIVATE_ENABLED = "true";
  const parsed = JSON.parse(await readFile(path.resolve(sourceFile), "utf8"));
  const mapped = mapPrivateFinanceExport(parsed, randomUUID());
  const result = await provisionPrivateProfile(mapped.workspace, "My profile");
  const setupURL = `http://127.0.0.1:3000/profile/setup#token=${result.setupToken}`;
  await writeFile(
    path.join(privateProfileDirectory(), "profile-setup.url"),
    `[InternetShortcut]\nURL=${setupURL}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    JSON.stringify({
      prepared: true,
      counts: mapped.counts,
      reviewItems: mapped.warnings.length,
    }),
  );
} catch {
  console.error(
    "Private profile preparation failed. Check the source file and profile setup state.",
  );
  process.exitCode = 1;
}
