# face-sidecar

人脸检测 + 质量评估 + 128 维特征编码（dlib / face_recognition，CPU，无 GPU）。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查（模型名、维度、阈值默认值） |
| POST | `/detect` | 只检测：人脸框 + 68 点关键点 + 质量分 |
| POST | `/embed` | 检测 + 取第一张脸的 128 维向量 |
| POST | `/analyze` | 检测 + 每张脸都给向量（一次调用完成识别） |

## 请求

```json
{ "image": "<base64 或 data:image/...;base64,...>" }
```

## 响应（/analyze）

```json
{
  "ok": true, "model": "dlib-resnet-v1", "dim": 128, "costMs": 210,
  "faces": [{
    "box": {"top": 40, "right": 180, "bottom": 180, "left": 40},
    "landmarks": [[x, y], ...],
    "quality": {"faceSize": 140, "blur": 85.2, "brightness": 118.3, "yaw": 0.02, "tooSmall": false, "tooBlurry": false},
    "embedding": [0.031, ...]
  }]
}
```

## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `FACE_SIDECAR_PORT` | 8899 | 监听端口 |
| `FACE_MAX_FACES` | 8 | 单图最多处理人脸数 |
| `FACE_MIN_SIZE` | 80 | 低于该边长视为 `tooSmall` |
| `FACE_BLUR_WARN` | 40 | 低于该拉普拉斯方差视为 `tooBlurry` |

## 构建 / 运行

```bash
docker build -t tzl-face-sidecar apps/face-sidecar
docker run -d --name tzl_face_sidecar --network tzl-network tzl-face-sidecar
```

模型随 wheel 走（`face-recognition-models`），**不需要额外下载**。
