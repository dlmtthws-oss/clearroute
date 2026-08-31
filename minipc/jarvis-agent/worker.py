"""
Jarvis agent worker — the always-on half of the pull-model bridge.

Runs on the user's private machine (the minipc). It polls the Supabase
`jarvis_agent_jobs` table over *outbound* HTTPS, claims queued jobs, runs them
locally (local LLM via Ollama, plus read-only file access), and writes the
result back. Nothing reaches into this machine — no tunnel, no open ports — so
it works behind any home router and survives reboots (run it with
restart: unless-stopped).

Environment:
  SUPABASE_URL                e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_ROLE_KEY   service_role key (kept only on this machine)
  OLLAMA_URL                  default http://ollama:11434
  OLLAMA_MODEL                optional; else the first installed model is used
  FILES_ROOT                  folder the agent may read, default /files
  POLL_INTERVAL               seconds between polls, default 2
"""

import os
import time
import json
import traceback
import requests

SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://ollama:11434").rstrip("/")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "").strip()
FILES_ROOT = os.path.realpath(os.environ.get("FILES_ROOT", "/files"))
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "2"))
TABLE = "jarvis_agent_jobs"

BASE_HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": f"Bearer {SERVICE_KEY}",
    "Content-Type": "application/json",
}


def rest(method, path, extra_headers=None, **kw):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = dict(BASE_HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    return requests.request(method, url, headers=headers, timeout=60, **kw)


# --- local capabilities ----------------------------------------------------

def pick_model():
    if OLLAMA_MODEL:
        return OLLAMA_MODEL
    try:
        r = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        models = [m["name"] for m in r.json().get("models", [])]
        return models[0] if models else ""
    except Exception:
        return ""


def ask_ollama(prompt):
    model = pick_model()
    if not model:
        return ("(No Ollama model is installed on the agent machine. "
                "Install one, e.g. `ollama pull llama3.2`, then try again.)")
    r = requests.post(
        f"{OLLAMA_URL}/api/generate",
        json={"model": model, "prompt": prompt, "stream": False},
        timeout=300,
    )
    r.raise_for_status()
    return (r.json().get("response") or "").strip() or "(the model returned an empty response)"


def safe_path(rel):
    rel = (rel or "").lstrip("/\\")
    full = os.path.realpath(os.path.join(FILES_ROOT, rel))
    if full != FILES_ROOT and not full.startswith(FILES_ROOT + os.sep):
        raise ValueError("Path is outside the allowed files folder")
    return full


def op_file_list(params):
    base = safe_path(params.get("path", ""))
    out = []
    for root, _dirs, files in os.walk(base):
        for f in files:
            out.append(os.path.relpath(os.path.join(root, f), FILES_ROOT))
            if len(out) >= 500:
                return {"files": out, "truncated": True}
    return {"files": out, "count": len(out)}


def op_file_read(params):
    full = safe_path(params.get("path", ""))
    with open(full, "r", encoding="utf-8", errors="replace") as fh:
        data = fh.read(20000)
    return {"path": params.get("path"), "content": data}


def op_file_search(params):
    q = (params.get("query") or "").lower()
    matches = []
    for root, _dirs, files in os.walk(FILES_ROOT):
        for f in files:
            fp = os.path.join(root, f)
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as fh:
                    for i, line in enumerate(fh, 1):
                        if q and q in line.lower():
                            matches.append({
                                "file": os.path.relpath(fp, FILES_ROOT),
                                "line": i,
                                "text": line.strip()[:200],
                            })
                            if len(matches) >= 100:
                                return {"matches": matches, "truncated": True}
            except Exception:
                continue
    return {"matches": matches, "count": len(matches)}


def process_job(job):
    op = job["op"]
    params = job.get("params") or {}
    if op in ("process", "coordinate"):
        return {"response": ask_ollama(params.get("task", ""))}
    if op == "file_list":
        return op_file_list(params)
    if op == "file_read":
        return op_file_read(params)
    if op == "file_search":
        return op_file_search(params)
    return {"error": f"Unknown op: {op}"}


# --- queue plumbing --------------------------------------------------------

def claim_one():
    r = rest("GET", f"{TABLE}?status=eq.queued&order=created_at.asc&limit=1")
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return None
    job = rows[0]
    # Atomically claim: only succeeds if the row is still 'queued'.
    c = rest(
        "PATCH",
        f"{TABLE}?id=eq.{job['id']}&status=eq.queued",
        extra_headers={"Prefer": "return=representation"},
        data=json.dumps({"status": "running"}),
    )
    c.raise_for_status()
    claimed = c.json()
    return claimed[0] if claimed else None


def finish(job_id, result=None, error=None):
    body = {"status": "error" if error else "done"}
    if error:
        body["error"] = str(error)[:2000]
    else:
        body["result"] = result
    rest("PATCH", f"{TABLE}?id=eq.{job_id}", data=json.dumps(body)).raise_for_status()


def main():
    print(
        f"[jarvis-agent] worker started. files={FILES_ROOT} "
        f"ollama={OLLAMA_URL} model={pick_model() or 'none'}",
        flush=True,
    )
    while True:
        try:
            job = claim_one()
            if not job:
                time.sleep(POLL_INTERVAL)
                continue
            print(f"[jarvis-agent] running job {job['id']} op={job['op']}", flush=True)
            try:
                finish(job["id"], result=process_job(job))
            except Exception as e:  # job-level failure -> record on the row
                finish(job["id"], error=f"{e}\n{traceback.format_exc()}")
        except Exception as e:  # poll-level failure -> back off and retry
            print(f"[jarvis-agent] poll error: {e}", flush=True)
            time.sleep(POLL_INTERVAL * 3)


if __name__ == "__main__":
    main()
