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

## 性能与内存（服务器 4 核实测）

UVR 模型的内存消耗约 **200MB / 秒音频**，整段处理不可行：

| 处理方式 | 峰值内存 | 34s 音频耗时 |
| --- | --- | --- |
| 整段 | 7.2G | 75s |
| 8s 分窗 | 4.9G | 24s |
| **4s 分窗（默认）** | **2.5G** | 28s |

因此 sidecar 默认按 **4 秒窗口 + 0.4 秒交叠** 分窗处理再 crossfade 拼接；
实测分离质量与整段一致（人声相关性 0.997，伴奏降低 11.1dB）。

compose 里 `mem_limit: 3500m` 是硬上限，超过会被 cgroup 杀掉并自动重启。
