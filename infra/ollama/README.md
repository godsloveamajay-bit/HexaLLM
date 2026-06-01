# Ollama in Docker — staged for portability / GPU

**Status: STAGED, not active.** Ollama currently runs as the native systemd
service `ollama.service` (user `ollama`, models at
`/usr/share/ollama/.ollama/models`, ~80GB). That's tuned and working; on a
CPU-only box a container is the same speed, so don't cut over for its own sake.

This config exists so that **GPU day is a one-line change**, not a migration.
The same GGUF model blobs run on CPU and GPU, and they're bind-mounted in — so
**nothing re-downloads**.

---

## Cutover NOW (still CPU — only if you want the container regardless)

```bash
sudo apt-get install -y docker-compose-plugin          # compose plugin (not yet installed)
sudo systemctl disable --now ollama.service            # free port 11434 + the model files
cd /home/ubuntu/nebulaxai/infra/ollama
docker compose up -d
curl -s localhost:11434/api/tags | head               # same models, no re-pull
```
The backend talks to `localhost:11434` either way, so nothing else changes.
To revert: `docker compose down && sudo systemctl enable --now ollama.service`.

> Plain-Docker equivalent (no compose plugin):
> ```bash
> docker run -d --name ollama --restart unless-stopped \
>   -p 127.0.0.1:11434:11434 \
>   -v /usr/share/ollama/.ollama/models:/root/.ollama/models \
>   -e OLLAMA_KEEP_ALIVE=-1 -e OLLAMA_MAX_LOADED_MODELS=5 -e OLLAMA_NUM_PARALLEL=1 \
>   ollama/ollama:latest
> ```

## GPU cutover (when a GPU is attached)

1. Install the NVIDIA stack on the host (driver + container toolkit):
   ```bash
   # driver per your GPU, then:
   sudo apt-get install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   docker run --rm --gpus all ubuntu nvidia-smi        # sanity check
   ```
2. Uncomment the `deploy.resources...devices` block in `docker-compose.yml`.
3. `docker compose up -d` (or add `--gpus all` to the `docker run`).

Ollama auto-detects the GPU and offloads layers — tok/s jumps from the ~1.7
CPU ceiling. Models are unchanged; only the runtime moved. If you'd rather run
vLLM for throughput, this is also where it slots in (see [[nebulax-vllm-migration]]).

## Gotchas
- **Never publish 11434 beyond 127.0.0.1** — the Ollama API is unauthenticated.
- The container writes its keys/history as root into `/root/.ollama`; the
  bind-mounted `models/` stays owned by host `ollama:ollama` and is read fine.
- Keep exactly one of {native service, container} running — both want port 11434.
- No `mem_limit`: a hard cap can OOM-kill pinned models. Let the 64GB host +
  `vm.swappiness=10` be the guardrail (see [[nebulax-ollama-models]]).
