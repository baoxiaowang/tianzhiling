# voice-separator（去背景音乐）

用 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 的 `OfflineSourceSeparation` 加载
`UVR-MDX-NET-Voc_FT.onnx`，把素材里的**人声轨**分离出来，去掉背景音乐/伴奏。

## 端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 模型、线程数、最大处理秒数 |
| POST | `/separate` | `{audio: base64}` → `{ok, audio: base64(wav 24k mono), durationSeconds, truncated, costMs}` |

输入支持 mp3/m4a/mp4/wav（内部用 ffmpeg 转 44.1k 单声道）；输出统一 **24kHz 单声道 PCM16 wav**。

## 模型准备（关键）

官方 UVR 模型**不带** sherpa-onnx 需要的元数据，直接加载会报
`'model_type' does not exist in the metadata`。需要补上：

```python
import onnx
m = onnx.load('UVR-MDX-NET-Voc_FT.onnx')
for k, v in {
    'model_type': 'UVR', 'stems': '2', 'sample_rate': '44100',
    'n_fft': '7680', 'center': '1', 'win_length': '7680',
    'hop_length': '1024', 'dim_t': '256', 'dim_f': '3072',
    'dim_c': '4', 'window_type': 'hann',
}.items():
    e = m.metadata_props.add(); e.key = k; e.value = v
onnx.save(m, 'UVR-MDX-NET-Voc_FT.onnx')
```

模型文件放在服务器 `volumes/models/uvr/UVR-MDX-NET-Voc_FT.onnx`（gitignore，不进仓库）。

## 性能（服务器 4 核实测）

| 线程 | 30s 音频耗时 | RTF |
| --- | --- | --- |
| 2 | ~50s | 1.68 |
| 4 | ~40s | 1.33 |
| 8 | ~63s | 2.12 |

默认 `SEP_THREADS=2`：给 node 留 CPU。素材超过 `SEP_MAX_SECONDS`（默认 120）只处理前段。
