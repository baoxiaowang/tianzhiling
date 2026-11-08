/**
 * 语音输出的 WAV 规范化工具。
 *
 * 背景（2026-11-07）：qwen TTS 返回的 wav 是「流式写出」的，RIFF 头和 data
 * 长度字段被写成 0x7FFFFFDF 这类占位值（约 2GB），实际文件只有几百 KB。
 * 严格按头部解码的播放器（例如 Python wave、部分小程序/系统播放器）会得到
 * 几十小时的错误时长，个别设备会因此提前结束播放，听起来就是「最后几个字没声」。
 *
 * 这里做两件事：
 * 1. 按真实字节数重写 RIFF/data 长度；
 * 2. 在末尾补一小段静音（默认 300ms），避免播放器在最后一个音节的衰减段直接
 *    结束导致听感上被截断。
 */

export interface NormalizeWavOptions {
  /** 末尾补的静音时长，默认 300ms；<=0 表示不补 */
  tailSilenceMs?: number;
}

const DEFAULT_TAIL_SILENCE_MS = 300;
const MAX_TAIL_SILENCE_MS = 2000;

interface WavLayout {
  sampleRate: number;
  blockAlign: number;
  fmtChunk: Buffer;
  dataPayload: Buffer;
}

function readWavLayout(buffer: Buffer): WavLayout | null {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    return null;
  }

  let offset = 12;
  let fmtChunk: Buffer | null = null;
  let dataPayload: Buffer | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const payloadStart = offset + 8;
    // 流式 wav 的 data 长度是占位值，不能拿它算结尾；一律取到文件末尾。
    const payloadEnd =
      chunkId === 'data'
        ? buffer.length
        : Math.min(payloadStart + chunkSize, buffer.length);

    if (chunkId === 'fmt ' && !fmtChunk) {
      fmtChunk = buffer.subarray(payloadStart, payloadEnd);
    } else if (chunkId === 'data' && !dataPayload) {
      dataPayload = buffer.subarray(payloadStart, payloadEnd);
      break;
    }

    if (chunkSize > buffer.length) {
      break;
    }
    offset = payloadStart + chunkSize + (chunkSize % 2);
  }

  if (!fmtChunk || !dataPayload || fmtChunk.length < 16) {
    return null;
  }

  const sampleRate = fmtChunk.readUInt32LE(4);
  const blockAlign = fmtChunk.readUInt16LE(12);

  if (!sampleRate || !blockAlign) {
    return null;
  }

  return { sampleRate, blockAlign, fmtChunk, dataPayload };
}

function normalizeTailSilenceMs(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TAIL_SILENCE_MS;
  }
  return Math.max(0, Math.min(Math.trunc(value as number), MAX_TAIL_SILENCE_MS));
}

/**
 * 重写 wav 头，并在末尾补静音。
 * 非 wav / 非 PCM 的输入原样返回，保证调用方无感知。
 */
export function normalizeWavAudioBuffer(
  buffer: Buffer,
  options: NormalizeWavOptions = {}
): Buffer {
  const layout = readWavLayout(buffer);
  if (!layout) {
    return buffer;
  }

  const tailSilenceMs = normalizeTailSilenceMs(options.tailSilenceMs);
  const silenceFrames = Math.round(
    (layout.sampleRate * tailSilenceMs) / 1000
  );
  const silenceBytes = Math.max(0, silenceFrames) * layout.blockAlign;

  const dataSize = layout.dataPayload.length + silenceBytes;
  const totalSize = 12 + 8 + layout.fmtChunk.length + 8 + dataSize;
  const output = Buffer.alloc(totalSize);

  output.write('RIFF', 0, 'ascii');
  output.writeUInt32LE(totalSize - 8, 4);
  output.write('WAVE', 8, 'ascii');

  output.write('fmt ', 12, 'ascii');
  output.writeUInt32LE(layout.fmtChunk.length, 16);
  layout.fmtChunk.copy(output, 20);

  const dataHeaderOffset = 20 + layout.fmtChunk.length;
  output.write('data', dataHeaderOffset, 'ascii');
  output.writeUInt32LE(dataSize, dataHeaderOffset + 4);
  layout.dataPayload.copy(output, dataHeaderOffset + 8);

  // Buffer.alloc 已经是 0，末尾静音区天然为静音，无需再写。
  return output;
}
