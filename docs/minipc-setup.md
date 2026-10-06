# Mini PC Workhorse Setup

**Architecture:** Mini PC (Windows 11 + WSL2) runs all heavy services. Laptop connects via LAN and controls the mini PC with Mouse without Borders.

```
Laptop (controller)
  │  Mouse without Borders — shared keyboard/mouse
  │  Browser → http://<MINIPC_IP>
  │  VS Code Remote SSH → wsl2 session
  │
  └─── LAN ──────────────────────────────────────────────
                       Mini PC (Windows 11 + WSL2)
                         │
                         └─ Docker (inside WSL2)
                               ├── Dify     :80
                               ├── Ollama   :11434
                               └── n8n      :5678
```

---

## Services

| Service | Port | URL from laptop |
|---------|------|-----------------|
| **Dify** (AI agent platform) | 80 | `http://<MINIPC_IP>` |
| **n8n** (workflow automation) | 5678 | `http://<MINIPC_IP>:5678` |
| **Ollama** (local LLMs) | 11434 | `http://<MINIPC_IP>:11434` |
| ClearRoute dev server | 3000 | `http://<MINIPC_IP>:3000` |

---

## First-Time Setup (Mini PC)

### Step 1 — Enable WSL2 and install a Linux distro

In PowerShell (Admin):
```powershell
wsl --install -d Ubuntu-22.04
# Restart when prompted, then set a username/password
```

### Step 2 — Clone the repo in WSL2

Open Ubuntu from Start Menu:
```bash
git clone https://github.com/dlmtthws-oss/clearroute.git ~/clearroute
cd ~/clearroute/docker
```

### Step 3 — Run the setup script

```bash
bash scripts/setup-wsl2.sh
```

This installs Docker Engine, creates `.env` from the example, and guides you through the rest. You may need to run it twice (once to install Docker, once to start services).

### Step 4 — Configure your `.env`

```bash
nano docker/.env
```

Key values to set:
- `MINIPC_IP` — run `ipconfig` in Windows CMD and use the **Ethernet/Wi-Fi IPv4** address (e.g. `192.168.1.50`)
- `DIFY_SECRET_KEY` — generate with `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `DIFY_INIT_PASSWORD` — your Dify admin password
- `POSTGRES_PASSWORD`, `SANDBOX_API_KEY`, `N8N_ENCRYPTION_KEY`, `N8N_PASSWORD` — all unique random strings

### Step 5 — Start the stack

```bash
cd ~/clearroute/docker
docker compose up -d
docker compose ps   # all should show "Up"
```

### Step 6 — Open Windows firewall for LAN access

In PowerShell (Admin) on the mini PC:
```powershell
cd C:\path\to\clearroute\docker\scripts
.\wsl2-network.ps1
```

This finds the WSL2 internal IP and adds port-forwarding rules so your laptop can reach the containers.

**Register as a startup task** (so rules survive reboots):
```powershell
$action  = New-ScheduledTaskAction -Execute "powershell.exe" `
             -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Resolve-Path .\startup-task.ps1)`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "WSL2-ClearRoute-Network" `
    -Action $action -Trigger $trigger -RunLevel Highest -Force
```

### Step 7 — Pull AI models (Qwen upgrade)

```bash
cd ~/clearroute/docker
bash scripts/pull-models.sh
```

Pulled models (choose based on your RAM):

| Model | Size | RAM needed | Use |
|-------|------|------------|-----|
| `qwen2.5:14b` | ~9 GB | 16 GB | General chat, agents |
| `qwen3:14b` | ~9 GB | 16 GB | Reasoning, thinking mode |
| `qwen2.5-coder:14b` | ~9 GB | 16 GB | Code generation |
| `nomic-embed-text` | 274 MB | 1 GB | Dify RAG embeddings |
| `qwen2.5:32b` | ~20 GB | 32 GB+ | Higher quality output |

---

## Connecting Dify to Ollama

1. Open Dify → **Settings → Model Provider → Ollama**
2. API Base URL: `http://ollama:11434`
   - Use the container name `ollama` (not `localhost`) — they share a Docker network
3. Add models: `qwen2.5:14b`, `qwen3:14b`, `qwen2.5-coder:14b`
4. For embeddings: add `nomic-embed-text` as an embedding model

---

## Connecting n8n to Ollama

In n8n → **Settings → AI → Ollama**:
- Base URL: `http://ollama:11434`

Or use the **HTTP Request** node to call `http://ollama:11434/api/generate` directly.

---

## Laptop Control (Mouse without Borders)

Mouse without Borders shares your laptop's keyboard and mouse with the mini PC over LAN — no extra configuration needed for Docker. Just ensure both machines are on the same network segment.

For VS Code remote development on the mini PC from your laptop:
1. Install **Remote - SSH** extension on your laptop's VS Code
2. In WSL2 on the mini PC, install and start SSH:
   ```bash
   sudo apt install openssh-server -y
   sudo service ssh start
   # Auto-start: add "sudo service ssh start" to ~/.bashrc or use /etc/wsl.conf
   ```
3. Connect from laptop VS Code: `ssh <wsl_user>@<MINIPC_IP>`

---

## Daily Operations

```bash
# Start everything (WSL2)
cd ~/clearroute/docker && docker compose up -d

# Stop everything
docker compose down

# View logs
docker compose logs -f dify-api
docker compose logs -f n8n
docker compose logs -f ollama

# Update images to latest
docker compose pull && docker compose up -d

# Check resource usage
docker stats
```

---

## Troubleshooting

**Can't reach mini PC from laptop**
- Re-run `wsl2-network.ps1` (WSL2 IP may have changed after reboot)
- Check: `netsh interface portproxy show all` in Windows CMD
- Confirm mini PC Windows Firewall isn't blocking the ports

**Dify can't connect to Ollama**
- Use `http://ollama:11434` (container name), not localhost or the LAN IP
- Run `docker compose ps` — all services should show "Up"

**Ollama is slow (no GPU)**
- The compose file has GPU passthrough commented out
- If your mini PC has an NVIDIA GPU: install `nvidia-container-toolkit` in WSL2,
  then uncomment the `deploy.resources` block in `compose.yml`

**n8n webhooks not working from laptop**
- Ensure `MINIPC_IP` in `.env` matches the actual Windows LAN IP
- Webhooks need to be reachable from where they're triggered

**Models use too much RAM**
- Switch to smaller variants: `qwen2.5:7b`, `qwen2.5-coder:7b`
- Ollama will automatically unload models not in use after a timeout
