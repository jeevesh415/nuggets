export type MemoryKind = "user" | "project" | "agent";

export const MEMORY_KIND_ORDER: MemoryKind[] = ["user", "project", "agent"];

export const DEFAULT_KIND_NAMES: Record<MemoryKind, string> = {
  user: "user",
  project: "project",
  agent: "agent",
};

export function inferMemoryKind(key: string, value = ""): MemoryKind {
  const lowerKey = key.toLowerCase();
  const lowerValue = value.toLowerCase();

  if (
    lowerKey.startsWith("pref:") ||
    lowerKey.startsWith("learn") ||
    lowerKey.includes("user") ||
    lowerKey.includes("favorite") ||
    lowerKey.startsWith("likes-")
  ) {
    return "user";
  }

  if (
    lowerKey.startsWith("file:") ||
    lowerKey.startsWith("edited:") ||
    lowerKey.startsWith("cmd:") ||
    lowerKey.startsWith("project:") ||
    lowerKey.includes("path") ||
    lowerKey.includes("repo") ||
    lowerKey.includes("script") ||
    lowerKey.includes("test") ||
    lowerKey === "_task" ||
    lowerValue.includes("/")
  ) {
    return "project";
  }

  return "agent";
}
