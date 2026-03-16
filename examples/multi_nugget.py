"""Multi-nugget usage with NuggetShelf — broadcast recall across topics."""

from nuggets import NuggetShelf

shelf = NuggetShelf()

# Create topic-specific nuggets
shelf.create("project", D=1024, banks=4)
shelf.create("user_prefs", D=512, banks=2)
shelf.create("debug_log", D=1024, banks=4)

# Store facts in different nuggets
shelf.remember("project", "framework", "FastAPI")
shelf.remember("project", "database", "PostgreSQL")
shelf.remember("project", "test_runner", "pytest")

shelf.remember("user_prefs", "editor", "neovim")
shelf.remember("user_prefs", "theme", "catppuccin")
shelf.remember("user_prefs", "indent", "2 spaces")

shelf.remember("debug_log", "last_error", "CORS missing origin header")
shelf.remember("debug_log", "fix_applied", "added origin to allowlist")

# Targeted recall (search specific nugget)
result = shelf.recall("framework", nugget_name="project")
print(f"Project framework: {result['answer']}  (nugget: {result['nugget_name']})")

# Broadcast recall (search ALL nuggets)
for query in ["editor", "database", "last_error", "indent"]:
    result = shelf.recall(query)
    print(f"Q: {query:>12}  A: {result['answer']:<30}  nugget: {result['nugget_name']}")

# List all nuggets
print("\nNuggets:")
for s in shelf.list():
    print(f"  {s['name']}: {s['fact_count']} facts, D={s['dimension']}, "
          f"{s['capacity_used_pct']}% capacity used")

# Clean up
for name in ["project", "user_prefs", "debug_log"]:
    shelf.remove(name)
