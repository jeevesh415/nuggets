#!/usr/bin/env python3
"""Count tokens used by nuggets at each injection point.

Uses tiktoken (cl100k_base) for estimation. Close enough for Claude/GPT models.
"""

import subprocess
import sys

try:
    import tiktoken
except ImportError:
    print("Installing tiktoken...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "tiktoken", "-q"])
    import tiktoken

# Add nuggets to path
sys.path.insert(0, "/Users/ptdp/Documents/nuggets/src")

from nuggets.shelf import NuggetShelf
from nuggets.hooks import _SESSION_BRIEFING

enc = tiktoken.get_encoding("cl100k_base")


def count(text: str) -> int:
    return len(enc.encode(text))


def main():
    shelf = NuggetShelf()
    shelf.load_all()

    items = shelf.list()
    total_facts = sum(n["fact_count"] for n in items)

    # 1. Session start briefing (injected once at session start)
    briefing = _SESSION_BRIEFING
    briefing_tokens = count(briefing)

    # Simulate the memory summary that gets appended
    nugget_summaries = []
    for n in items:
        if n["fact_count"] > 0:
            nugget_summaries.append(f"{n['name']} ({n['fact_count']} facts)")

    summary = f"\nCurrent memory: {total_facts} facts across {len(nugget_summaries)} nuggets: {', '.join(nugget_summaries)}"
    summary += "\nMemory is auto-recalled from your prompts, or use `nuggets recall <query>` to search directly."
    summary_tokens = count(summary)

    # Learnings section
    learnings_text = ""
    if "learnings" in shelf:
        learnings = shelf.get("learnings").facts()
        if learnings:
            learnings.sort(key=lambda f: f.get("hits", 0), reverse=True)
            learnings = learnings[:20]
            learnings_text = "\n[Key learnings]\n"
            for f in learnings:
                hits = f.get("hits", 0)
                suffix = f" (recalled {hits}x)" if hits > 0 else ""
                learnings_text += f"  - {f['key']}: {f['value']}{suffix}\n"
    learnings_tokens = count(learnings_text) if learnings_text else 0

    session_start_total = briefing_tokens + summary_tokens + learnings_tokens

    # 2. Pre-compact dump (injected before compaction)
    # Simulate the scored facts output
    precompact_text = f"[Nuggets memory — top facts for compaction context]\n"
    precompact_text += f"  Showing up to 50 of {total_facts} total facts (prioritized)\n"

    scored = []
    NUGGET_BASE_WEIGHTS = {"learnings": 100, "preferences": 80}
    MECHANICAL = {"tool_results", "active_files", "bash_results", "errors"}

    for info in items:
        name = info["name"]
        if info["fact_count"] == 0:
            continue
        try:
            nugget = shelf.get(name)
        except KeyError:
            continue
        facts = nugget.facts()
        if not facts:
            continue

        if name in NUGGET_BASE_WEIGHTS:
            base = NUGGET_BASE_WEIGHTS[name]
            label = "IMPORTANT"
        elif name in MECHANICAL:
            base = 10
            label = "cached"
        else:
            base = 50
            label = "user"

        for fact in facts:
            hits = fact.get("hits", 0)
            score = base + (hits * 5)
            scored.append((score, name, fact, label))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:50]

    current_nugget = None
    for score, nugget_name, fact, label in top:
        if nugget_name != current_nugget:
            current_nugget = nugget_name
            precompact_text += f"\n  [{label}] {nugget_name}:\n"
        hits = fact.get("hits", 0)
        suffix = f" (recalled {hits}x)" if hits > 0 else ""
        precompact_text += f"    {fact['key']}: {fact['value']}{suffix}\n"

    precompact_tokens = count(precompact_text)

    # 3. Per-turn recall (variable, estimate worst case of 5 results)
    sample_recall = "[Nuggets memory recall]\n"
    sample_recall += "  - some fact value here (nugget=memory, confidence=0.85)\n" * 5
    recall_per_turn_tokens = count(sample_recall)

    # 4. All facts raw (for reference)
    all_facts_text = ""
    for info in items:
        name = info["name"]
        if info["fact_count"] == 0:
            continue
        try:
            nugget = shelf.get(name)
        except KeyError:
            continue
        facts = nugget.facts()
        for f in facts:
            all_facts_text += f"{name}/{f['key']}: {f['value']}\n"
    all_facts_tokens = count(all_facts_text)

    # Print report
    print("=" * 60)
    print("NUGGETS TOKEN USAGE REPORT")
    print("=" * 60)
    print()
    print(f"Total nuggets: {len(items)}")
    print(f"Total facts:   {total_facts}")
    print()
    print("--- Session Start (once per session) ---")
    print(f"  Briefing instructions:  {briefing_tokens:,} tokens")
    print(f"  Memory summary:         {summary_tokens:,} tokens")
    print(f"  Learnings section:      {learnings_tokens:,} tokens")
    print(f"  TOTAL session start:    {session_start_total:,} tokens")
    print()
    print("--- Per Turn (UserPromptSubmit recall) ---")
    print(f"  Max recall results (5): ~{recall_per_turn_tokens:,} tokens")
    print(f"  (usually 0-3 results, so often less)")
    print()
    print("--- Pre-Compaction Dump (once per compaction) ---")
    print(f"  Top 50 facts dump:      {precompact_tokens:,} tokens")
    print()
    print("--- Reference ---")
    print(f"  All {total_facts} facts raw:      {all_facts_tokens:,} tokens")
    print()
    print("--- Per Nugget Breakdown ---")
    for info in sorted(items, key=lambda x: x["fact_count"], reverse=True):
        name = info["name"]
        if info["fact_count"] == 0:
            continue
        nugget = shelf.get(name)
        facts = nugget.facts()
        nugget_text = "".join(f"{f['key']}: {f['value']}\n" for f in facts)
        tokens = count(nugget_text)
        cap = info["capacity_used_pct"]
        print(f"  {name:20s}  {info['fact_count']:4d} facts  {tokens:6,} tokens  ({cap}% capacity)")

    print()
    print("=" * 60)


if __name__ == "__main__":
    main()
