# Nuggets

Holographic memory for LLM agents. Stores key-value facts as superposed complex-valued vectors (HRR) and retrieves them via algebraic unbinding. No database, no embeddings API — just math.

## Setup

```bash
git clone <repo>
cd nuggets
npm install
npm run setup   # interactive wizard — configures .env
npm run dev
```

## Architecture

```
src/
  nuggets/              # Memory engine (pure TypeScript, zero deps)
    core.ts             # HRR math: bind, unbind, FFT-free complex ops
    memory.ts           # Nugget class: remember, recall, forget
    shelf.ts            # NuggetShelf: multi-nugget manager
    promote.ts          # MEMORY.md promotion (3+ recall threshold)
    index.ts            # Public API

  gateway/              # Messaging gateway
    main.ts             # Entry point
    config.ts           # Environment config
    router.ts           # Message routing + proactive events
    pi-rpc.ts           # Pi subprocess (JSONL RPC)
    pi-pool.ts          # Per-user process pool
    telegram.ts         # Telegram bot (grammY)
    whatsapp.ts         # WhatsApp (Baileys)
    event-queue.ts      # Proactive event bus
    cron.ts             # Cron scheduler
    heartbeat.ts        # Periodic check-ins

  setup.ts              # Interactive setup wizard

.pi/extensions/
  nuggets.ts            # Pi extension (imports src/nuggets directly)
  proactive.ts          # Scheduling tool
```

## How it works

Each fact is a key-value pair stored as a complex-valued binding in a holographic vector. Multiple facts superpose into one fixed-size memory vector. Recall unbinds the query and matches against the vocabulary using cosine similarity.

- **Storage**: `~/.nuggets/*.nugget.json` (human-readable JSON)
- **Deterministic**: Same name + same facts = same memory (seeded PRNG, no tensors serialized)
- **Capacity**: ~500 facts per nugget at D=16384 with 4 banks

## Testing

```bash
npm test
```

## Scripts

| Command | Description |
|---|---|
| `npm run setup` | Interactive setup wizard — configures `.env` |
| `npm run dev` | Start gateway (Telegram/WhatsApp) |
| `npm test` | Run tests |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Compile to `dist/` |
