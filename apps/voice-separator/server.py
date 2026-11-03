"""人声分离 sidecar：用 UVR-MDX-NET（onnx）把背景音乐/伴奏从人声里分离出去。

只做一件事：输入一段音频（mp3/m4a/mp4/wav 等），输出「人声轨」wav（24kHz 单声道 PCM16）。
检测/降噪仍在 node 侧；这里失败不影响主流程，调用方会回退到降噪后的音频。

端点：
  GET  /health          -> {ok, model, threads, maxSeconds}
  POST /separate        -> {ok, audio: base64(wav), durationSeconds, costMs, rtf, truncated}

环境变量：
  SEP_MODEL_PATH   默认 /models/UVR-MDX-NET-Voc_FT.onnx
  SEP_THREADS      默认 2（服务器只有 4 核，留出余量给 node）
  SEP_MAX_SECONDS  默认 120（超过则只处理前 N 秒，响应 truncated=true）
  SEP_HTTP_PORT    默认 8900
"""

import base64
import io
import json
import os
import subprocess
import tempfile
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import sherpa_onnx

MODEL_PATH = os.environ.get("SEP_MODEL_PATH", "/models/UVR-MDX-NET-Voc_FT.onnx")
THREADS = int(os.environ.get("SEP_THREADS", "2"))
MAX_SECONDS = int(os.environ.get("SEP_MAX_SECONDS", "120"))
OUTPUT_SAMPLE_RATE = 24000
MODEL_SAMPLE_RATE = 44100

_separator = None


def get_separator():
    global _separator
    if _separator is None:
        config = sherpa_onnx.OfflineSourceSeparationConfig(
            model=sherpa_onnx.OfflineSourceSeparationModelConfig(
                uvr=sherpa_onnx.OfflineSourceSeparationUvrModelConfig(
                    model=MODEL_PATH
                ),
                num_threads=THREADS,
            )
        )
        _separator = sherpa_onnx.OfflineSourceSeparation(config)
    return _separator


def decode_to_wav(raw: bytes) -> tuple[str, float]:
    """用 ffmpeg 把任意音频/视频转成 44.1k 单声道 wav，超过 MAX_SECONDS 只取前段。"""
    tmpdir = tempfile.mkdtemp(prefix="sep-")
    src = os.path.join(tmpdir, "input.bin")
    dst = os.path.join(tmpdir, "input.wav")
    with open(src, "wb") as handle:
        handle.write(raw)
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", src,
        "-t", str(MAX_SECONDS),
        "-ac", "1", "-ar", str(MODEL_SAMPLE_RATE),
        "-f", "wav", dst,
    ]
    subprocess.run(cmd, check=True, timeout=120)
    return dst, tmpdir


def read_wav(path: str) -> np.ndarray:
    import soundfile as sf

    data, _ = sf.read(path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    return data.astype(np.float32)


def write_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    # 线性重采样到 24k（训练链路统一 24k 单声道）
    if sample_rate != OUTPUT_SAMPLE_RATE and len(samples) > 1:
        target_len = max(1, int(len(samples) * OUTPUT_SAMPLE_RATE / sample_rate))
        idx = np.linspace(0, len(samples) - 1, target_len)
        samples = np.interp(idx, np.arange(len(samples)), samples).astype(
            np.float32
        )
    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 1.0:
        samples = samples / peak
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(OUTPUT_SAMPLE_RATE)
        handle.writeframes(pcm.tobytes())
    return buffer.getvalue()


def separate(raw: bytes) -> dict:
    started = time.time()
    wav_path, tmpdir = decode_to_wav(raw)
    try:
        samples = read_wav(wav_path)
    finally:
        for name in os.listdir(tmpdir):
            os.remove(os.path.join(tmpdir, name))
        os.rmdir(tmpdir)

    duration = len(samples) / MODEL_SAMPLE_RATE if len(samples) else 0.0
    truncated = duration >= MAX_SECONDS - 0.5

    separator = get_separator()
    output = separator.process(
        MODEL_SAMPLE_RATE, np.asarray(samples, dtype=np.float32).reshape(1, -1)
    )
    stems = output.stems
    vocals = np.asarray(stems[0].data[0], dtype=np.float32)
    cost_ms = int((time.time() - started) * 1000)
    return {
        "ok": True,
        "audio": base64.b64encode(
            write_wav_bytes(vocals, MODEL_SAMPLE_RATE)
        ).decode(),
        "durationSeconds": round(duration, 2),
        "truncated": truncated,
        "costMs": cost_ms,
        "rtf": round((cost_ms / 1000.0) / max(duration, 1e-6), 2),
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "tzl-voice-separator/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/"):
            return self._send(
                200,
                {
                    "ok": True,
                    "model": os.path.basename(MODEL_PATH),
                    "threads": THREADS,
                    "maxSeconds": MAX_SECONDS,
                    "outputSampleRate": OUTPUT_SAMPLE_RATE,
                },
            )
        return self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        if self.path.rstrip("/") != "/separate":
            return self._send(404, {"ok": False, "error": "not_found"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            raw = base64.b64decode(payload.get("audio") or "")
            if not raw:
                raise ValueError("audio is required")
        except Exception as exc:  # noqa: BLE001
            return self._send(400, {"ok": False, "error": "invalid_request", "detail": str(exc)})

        try:
            return self._send(200, separate(raw))
        except subprocess.CalledProcessError as exc:
            return self._send(422, {"ok": False, "error": "decode_failed", "detail": str(exc)})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"ok": False, "error": "separate_failed", "detail": str(exc)})


def main():
    port = int(os.environ.get("SEP_HTTP_PORT", "8900"))
    print(f"[voice-separator] listening on :{port} model={MODEL_PATH}", flush=True)
    # 预热：避免首个请求等模型加载
    try:
        get_separator()
        print("[voice-separator] model warmed up", flush=True)
    except Exception as exc:  # noqa: BLE001
        print(f"[voice-separator] warmup failed: {exc}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
