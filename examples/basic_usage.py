"""Basic Nuggets usage — single memory unit."""

from nuggets import Nugget

# Create a nugget (auto-saves to ~/.nuggets/)
n = Nugget("demo", D=1024, banks=4)

# Store some facts
n.remember("wifi_password", "hunter2")
n.remember("db_host", "localhost:5432")
n.remember("deploy_cmd", "git push origin main")
n.remember("test_cmd", "pytest tests/ -v")
n.remember("python_version", "3.11.9")

# Recall facts
for query in ["wifi_password", "test_cmd", "python_version", "deploy_cmd"]:
    result = n.recall(query)
    print(f"Q: {query}")
    print(f"A: {result['answer']}  (conf={result['confidence']:.3f}, margin={result['margin']:.3f})")
    print()

# Check status
print("Status:", n.status())

# List all facts
print("\nAll facts:")
for f in n.facts():
    print(f"  {f['key']} -> {f['value']}")

# Forget a fact
n.forget("wifi_password")
print(f"\nAfter forgetting wifi_password: {n.recall('wifi_password')}")

# Clean up demo
n.clear()
