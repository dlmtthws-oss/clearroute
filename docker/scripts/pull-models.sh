#!/usr/bin/env bash
# Pull Ollama models into the running ollama container.
# Run this after "docker compose up -d" in the docker/ directory.
#
# Qwen models — upgraded for expanded RAM on mini PC:
#   qwen2.5:14b  ~9 GB  great balance of speed and quality
#   qwen2.5:32b  ~20 GB recommended if you have 32 GB+ RAM
#   qwen3:14b    ~9 GB  latest Qwen3, strong reasoning
#
# Coding-focused:
#   qwen2.5-coder:14b  code generation, debugging, review

set -euo pipefail

CONTAINER=${1:-clearroute-minipc-ollama-1}

echo "==> Pulling models into container: $CONTAINER"
echo "    (This may take a while on first run — models are several GB each)"
echo ""

# ── General chat / agent models ──────────────────────────────
# NUCBOX M5 Ultra — 32 GB RAM config:
#   qwen2.5:32b  main workhorse model (~20 GB)
#   qwen3:14b    reasoning/thinking mode (~9 GB)
# Only one large model runs at a time; Ollama unloads idle models.

echo "--- Pulling qwen2.5:32b (32 GB RAM upgrade — main workhorse model) ---"
docker exec "$CONTAINER" ollama pull qwen2.5:32b

echo "--- Pulling qwen3:14b (latest Qwen with thinking/reasoning mode) ---"
docker exec "$CONTAINER" ollama pull qwen3:14b

# ── Coding model ──────────────────────────────────────────────
echo "--- Pulling qwen2.5-coder:14b (code generation & review) ---"
docker exec "$CONTAINER" ollama pull qwen2.5-coder:14b

# ── Embedding model (needed for Dify knowledge bases) ─────────
echo "--- Pulling nomic-embed-text (text embeddings for Dify RAG) ---"
docker exec "$CONTAINER" ollama pull nomic-embed-text

echo ""
echo "==> Done. Available models:"
docker exec "$CONTAINER" ollama list
echo ""
echo "Configure Dify to use Ollama:"
echo "  Settings → Model Provider → Ollama"
echo "  Base URL: http://ollama:11434"
echo "  (use this URL from within the Docker network)"
echo ""
echo "From your laptop browser, the Ollama API is at:"
echo "  http://<MINIPC_IP>:11434"
