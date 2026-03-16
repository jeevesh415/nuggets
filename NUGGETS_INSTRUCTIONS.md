# Nuggets — Holographic Memory for LLM Agents

## What is Nuggets?

Nuggets is a **fast key-value memory** backed by Holographic Reduced Representations (HRR). It stores facts as superposed complex-valued tensors and retrieves them algebraically in microseconds. It is NOT a database, vector store, or RAG system — it is a fixed-capacity associative cache.

Think of it as **L1 cache for your agent**: tiny, fast, lossy, and associative.

## CLI (primary interface)

After `pip install nuggets`, these commands are available immediately:

```bash
nuggets remember <nugget> <key> <value>    # Store a fact (auto-creates nugget)
nuggets recall <query> [--nugget <name>]   # Query memory (searches all nuggets by default)
nuggets forget <nugget> <key>              # Remove a fact
nuggets list                               # List all nuggets
nuggets status                             # Overall status
nuggets facts <nugget>                     # List facts in a nugget
nuggets clear <nugget>                     # Clear all facts from a nugget
```

Add `--json` to `recall`, `list`, `status`, or `facts` for machine-readable output.

## The recall-first pattern

**Always try `nuggets recall` before expensive operations.** This is the core usage pattern:

1. Agent gets a question or needs to find something
2. `nuggets recall "the question"` — check memory first (free, instant)
3. If found → use the answer
4. If not found → do the expensive search/API call/file read
5. `nuggets remember <topic> "key" "answer"` — cache for next time

## When to use it

- **Before file searches**: Check if you already know where something is
- **Caching learned facts**: Project patterns, user preferences, code locations
- **Remembering past fixes**: Store diagnosis + fix for recurring bugs
- **Cross-session memory**: Facts persist to `~/.nuggets/` and survive restarts

## When NOT to use it

- Large documents or code blocks (values should be short strings)
- More than ~250 facts per nugget (create multiple nuggets instead)
- Anything requiring exact text retrieval (HRR is approximate)
- Structured queries, joins, or filtering (use a real database)

## Suggested nugget organization

| Nugget name | What to store | Examples |
|---|---|---|
| `project` | Build commands, tech stack, deploy process | "test command" → "pytest src/ -v" |
| `prefs` | User preferences and conventions | "indent style" → "2 spaces" |
| `locations` | Where things are defined | "auth handler" → "src/auth/middleware.ts:47" |
| `debug` | Past bug diagnoses | "CORS error" → "add origin to allowlist in config.ts" |

## Optional: Python API

```python
from nuggets import Nugget

n = Nugget("my_memory")
n.remember("wifi_password", "test123")
result = n.recall("what is the wifi password")
print(result)  # {answer: "test123", confidence: 0.85, ...}
```

## Capacity guidelines

| Dimension (D) | Facts per nugget | Memory |
|---|---|---|
| 1024 | ~128 | ~16 KB |
| 2048 (default) | ~180 | ~32 KB |
| 4096 | ~256 | ~64 KB |
| 8192 | ~360 | ~128 KB |

When a nugget gets full, create a new one with a different topic. Broadcast recall searches across all of them automatically.
