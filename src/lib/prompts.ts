import { readFileSync } from "fs";
import { join } from "path";

const CLINICAL_PROMPT_VERSION = "v2.1";

export function cargarPromptClinico(): string {
  const path = join(
    process.cwd(),
    "prompts",
    `clinical_note_${CLINICAL_PROMPT_VERSION}.md`,
  );
  return readFileSync(path, "utf-8");
}

export function versionPromptClinico(): string {
  return CLINICAL_PROMPT_VERSION;
}
