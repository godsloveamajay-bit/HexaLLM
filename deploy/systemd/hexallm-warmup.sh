#!/usr/bin/env bash
# Warm both resident engines on boot:
#  - vLLM (hexallm-vllm.service): serves the fast 7B tier — one tiny chat
#    request forces CUDA graph capture so the first real user request is fast.
#  - ollama: qwen3:14b with 12/41 layers on GPU (matches the backend's
#    OLLAMA_NUM_GPU_OFFLOAD policy) → ~3.3GB VRAM, co-resident with vLLM.
set -u
payload14='{"model":"qwen3:14b","keep_alive":-1,"prompt":"hi","stream":false,"options":{"num_predict":1,"num_gpu":12}}'
curl -fsS --max-time 300 localhost:11434/api/generate -d "$payload14" -o /dev/null || echo "warmup failed for qwen3:14b"
curl -fsS --max-time 300 localhost:8001/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"hexa-vllm","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' -o /dev/null || echo "warmup failed for vLLM"