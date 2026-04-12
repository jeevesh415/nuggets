import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SAVE_DIR, DEFAULT_KIND_NAMES, inferMemoryKind, type MemoryKind } from "./nuggets/index.js";

interface Fact {
  key: string;
  value: string;
  hits?: number;
  last_hit_session?: string;
}

interface NuggetFile {
  version: number;
  name: string;
  D: number;
  banks: number;
  ensembles: number;
  max_facts: number;
  facts: Fact[];
  config: {
    sharpen_p: number;
    corvacs_a: number;
    temp_T: number;
    orth_iters: number;
  };
}

const saveDir = DEFAULT_SAVE_DIR;
const legacyPath = join(saveDir, "memory.nugget.json");

function loadNuggetFile(path: string): NuggetFile | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8")) as NuggetFile;
}

function saveNuggetFile(path: string, data: NuggetFile): void {
  writeFileSync(path, JSON.stringify(data) + "\n");
}

function baseNugget(name: string, source?: NuggetFile): NuggetFile {
  return {
    version: source?.version ?? 3,
    name,
    D: source?.D ?? 16384,
    banks: source?.banks ?? 4,
    ensembles: source?.ensembles ?? 1,
    max_facts: source?.max_facts ?? 0,
    facts: [],
    config: source?.config ?? {
      sharpen_p: 1,
      corvacs_a: 0,
      temp_T: 0.9,
      orth_iters: 1,
    },
  };
}

function mergeFact(target: Fact[], incoming: Fact): void {
  const idx = target.findIndex((f) => f.key.toLowerCase() === incoming.key.toLowerCase());
  if (idx === -1) {
    target.push({
      key: incoming.key,
      value: incoming.value,
      hits: incoming.hits ?? 0,
      last_hit_session: incoming.last_hit_session ?? "",
    });
    return;
  }

  const existing = target[idx];
  target[idx] = {
    key: incoming.key,
    value: incoming.value,
    hits: Math.max(existing.hits ?? 0, incoming.hits ?? 0),
    last_hit_session: incoming.last_hit_session || existing.last_hit_session || "",
  };
}

function targetPath(kind: MemoryKind): string {
  return join(saveDir, `${DEFAULT_KIND_NAMES[kind]}.nugget.json`);
}

function classifyFacts(facts: Fact[]): Record<MemoryKind, Fact[]> {
  const buckets: Record<MemoryKind, Fact[]> = {
    user: [],
    project: [],
    agent: [],
  };

  for (const fact of facts) {
    const kind = inferMemoryKind(fact.key, fact.value);
    buckets[kind].push(fact);
  }

  return buckets;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function main(): void {
  if (!existsSync(legacyPath)) {
    console.log(`no legacy memory file at ${legacyPath}`);
    return;
  }

  mkdirSync(saveDir, { recursive: true });
  const legacy = loadNuggetFile(legacyPath);
  if (!legacy) {
    console.log(`failed to load ${legacyPath}`);
    return;
  }

  const backupPath = join(saveDir, `memory.pre-migration.${timestamp()}.bak.json`);
  copyFileSync(legacyPath, backupPath);

  const buckets = classifyFacts(legacy.facts || []);
  const summary: string[] = [];

  for (const kind of Object.keys(buckets) as MemoryKind[]) {
    const path = targetPath(kind);
    const existing = loadNuggetFile(path);
    const next = existing ? { ...existing, facts: [...existing.facts] } : baseNugget(DEFAULT_KIND_NAMES[kind], legacy);

    for (const fact of buckets[kind]) {
      mergeFact(next.facts, fact);
    }

    saveNuggetFile(path, next);
    summary.push(`${kind}=${buckets[kind].length}`);
  }

  const archivedPath = join(saveDir, `memory.migrated.${timestamp()}.json`);
  renameSync(legacyPath, archivedPath);

  console.log(`backup: ${backupPath}`);
  console.log(`archived legacy: ${archivedPath}`);
  console.log(`migrated ${legacy.facts.length} facts -> ${summary.join(", ")}`);
}

main();
