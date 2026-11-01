"""人脸识别 sidecar：只做检测 / 质量评估 / 特征编码，不碰业务数据。

端点（JSON，图片用 base64 或直接二进制）：
  GET  /health                        -> {ok, model, version}
  POST /analyze  {image: b64, maxFaces?} -> {faces:[{box, landmarks, quality, embedding}]}
  POST /detect   {image: b64}         -> {faces:[{box, landmarks, quality}]}
  POST /embed    {image: b64, box?}   -> {embedding, dim, model}

运行：python3 server.py（默认 0.0.0.0:8899，环境变量 FACE_SIDECAR_PORT 可改）
"""

import base64
import io
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import face_recognition
import numpy as np
from PIL import Image

MODEL_NAME = os.environ.get("FACE_MODEL_NAME", "dlib-resnet-v1")
MODEL_VERSION = os.environ.get("FACE_MODEL_VERSION", "2026.11")
MAX_FACES = int(os.environ.get("FACE_MAX_FACES", "8"))
# 质量门禁阈值（与 Node 侧保持一致的默认值，可由请求覆盖）
MIN_FACE_SIZE = int(os.environ.get("FACE_MIN_SIZE", "80"))
BLUR_WARN_VAR = float(os.environ.get("FACE_BLUR_WARN", "40.0"))


def decode_image(payload):
    if isinstance(payload, bytes):
        raw = payload
    else:
        text = str(payload or "").strip()
        if text.startswith("data:"):
            text = text.split(",", 1)[-1]
        raw = base64.b64decode(text)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def laplacian_variance(gray):
    """拉普拉斯方差：越低越模糊。纯 numpy 实现，避免额外依赖。"""
    arr = np.asarray(gray, dtype=np.float32)
    if arr.ndim != 2 or arr.shape[0] < 3 or arr.shape[1] < 3:
        return 0.0
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    out = np.zeros((arr.shape[0] - 2, arr.shape[1] - 2), dtype=np.float32)
    for dy in range(3):
        for dx in range(3):
            k = kernel[dy, dx]
            if k:
                out += k * arr[dy:dy + out.shape[0], dx:dx + out.shape[1]]
    return float(out.var())


def estimate_yaw(landmarks):
    """用 68 点关键点粗略估计左右偏转（±1，0 为正面）。"""
    if len(landmarks) < 68:
        return 0.0
    left_eye = np.mean(landmarks[36:42], axis=0)
    right_eye = np.mean(landmarks[42:48], axis=0)
    nose = np.mean(landmarks[27:36], axis=0)
    eye_mid = (left_eye + right_eye) / 2.0
    eye_dist = float(np.linalg.norm(right_eye - left_eye)) or 1.0
    return float((nose[0] - eye_mid[0]) / eye_dist)


def quality_of(image, box, landmarks):
    top, right, bottom, left = box
    w = max(0, right - left)
    h = max(0, bottom - top)
    crop = image.crop((max(0, left), max(0, top), max(0, right), max(0, bottom)))
    gray = crop.convert("L") if crop.width and crop.height else None
    blur = laplacian_variance(gray) if gray else 0.0
    brightness = float(np.asarray(gray).mean()) if gray else 0.0
    yaw = estimate_yaw(landmarks)
    return {
        "faceSize": int(min(w, h)),
        "blur": round(blur, 2),
        "brightness": round(brightness, 1),
        "yaw": round(yaw, 3),
        "tooSmall": min(w, h) < MIN_FACE_SIZE,
        "tooBlurry": blur < BLUR_WARN_VAR,
    }


def analyze(image, want_embedding=True):
    started = time.time()
    rgb = np.asarray(image)
    locations = face_recognition.face_locations(rgb, number_of_times_to_upsample=1)
    locations = locations[:MAX_FACES]
    landmarks_list = face_recognition.face_landmarks(rgb, locations)
    encodings = (
        face_recognition.face_encodings(rgb, locations) if want_embedding else []
    )

    faces = []
    for index, box in enumerate(locations):
        landmarks = landmarks_list[index] if index < len(landmarks_list) else {}
        full_points = []
        for part in ("chin", "left_eyebrow", "right_eyebrow", "nose_bridge",
                     "nose_tip", "left_eye", "right_eye", "top_lip", "bottom_lip"):
            full_points.extend(landmarks.get(part, []))
        face = {
            "box": {"top": int(box[0]), "right": int(box[1]), "bottom": int(box[2]), "left": int(box[3])},
            "landmarks": [[float(x), float(y)] for x, y in full_points],
            "quality": quality_of(image, box, full_points),
        }
        if want_embedding and index < len(encodings):
            face["embedding"] = [round(float(v), 6) for v in encodings[index]]
        faces.append(face)

    return {
        "model": MODEL_NAME,
        "version": MODEL_VERSION,
        "dim": 128,
        "costMs": int((time.time() - started) * 1000),
        "faces": faces,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "tzl-face-sidecar/1.0"

    def log_message(self, fmt, *args):
        pass

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.rstrip("/") in ("/health", "/"):
            return self._send(200, {
                "ok": True,
                "model": MODEL_NAME,
                "version": MODEL_VERSION,
                "dim": 128,
                "maxFaces": MAX_FACES,
                "minFaceSize": MIN_FACE_SIZE,
            })
        return self._send(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            payload = json.loads(raw.decode("utf-8")) if raw else {}
            image = decode_image(payload.get("image") or "")
        except Exception as exc:  # noqa: BLE001
            return self._send(400, {"ok": False, "error": "invalid_image", "detail": str(exc)})

        try:
            started = time.time()
            path = self.path.rstrip("/")
            if path == "/detect":
                result = analyze(image, want_embedding=False)
            elif path == "/embed":
                result = analyze(image, want_embedding=True)
                result["faces"] = [f for f in result["faces"] if f.get("embedding")]
                if result["faces"]:
                    result["embedding"] = result["faces"][0]["embedding"]
            elif path == "/analyze":
                result = analyze(image, want_embedding=True)
            else:
                return self._send(404, {"ok": False, "error": "not_found"})
            result["costMs"] = int((time.time() - started) * 1000)
            return self._send(200, {"ok": True, **result})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"ok": False, "error": "internal_error", "detail": str(exc)})


def main():
    port = int(os.environ.get("FACE_SIDECAR_PORT", "8899"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"[face-sidecar] listening on :{port} model={MODEL_NAME}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
