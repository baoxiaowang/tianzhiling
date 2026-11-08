import {
  normalizeWavAudioBuffer,
} from '../../src/service/voice-wav-output.util';

/** 构造一个「流式 wav」：头部长度字段是占位值，实际数据只有 payload 那么长。 */
function buildStreamingWav(payload: Buffer, sampleRate = 24000): Buffer {
  const blockAlign = 2;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); // PCM
  fmt.writeUInt16LE(1, 2); // mono
  fmt.writeUInt32LE(sampleRate, 4);
  fmt.writeUInt32LE(sampleRate * blockAlign, 8);
  fmt.writeUInt16LE(blockAlign, 12);
  fmt.writeUInt16LE(16, 14);

  const buffer = Buffer.alloc(12 + 8 + fmt.length + 8 + payload.length);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(0x7fffffdf, 4); // 流式占位
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(fmt.length, 16);
  fmt.copy(buffer, 20);
  const dataOffset = 20 + fmt.length;
  buffer.write('data', dataOffset, 'ascii');
  buffer.writeUInt32LE(0x7fffffdb, dataOffset + 4); // 流式占位
  payload.copy(buffer, dataOffset + 8);
  return buffer;
}

function readChunks(buffer: Buffer) {
  const riffSize = buffer.readUInt32LE(4);
  const dataOffset = 20 + buffer.readUInt32LE(16);
  const dataSize = buffer.readUInt32LE(dataOffset + 4);
  return { riffSize, dataOffset, dataSize };
}

describe('normalizeWavAudioBuffer', () => {
  const originalTail = process.env.NODE_VOICE_TTS_TAIL_SILENCE_MS;

  afterAll(() => {
    if (originalTail === undefined) {
      delete process.env.NODE_VOICE_TTS_TAIL_SILENCE_MS;
    } else {
      process.env.NODE_VOICE_TTS_TAIL_SILENCE_MS = originalTail;
    }
  });

  it('重写流式占位长度并补齐末尾静音', () => {
    const payload = Buffer.alloc(24000 * 2 * 1); // 1s 24kHz mono pcm16
    payload.fill(0x11);
    const input = buildStreamingWav(payload);

    const output = normalizeWavAudioBuffer(input, { tailSilenceMs: 300 });
    const { riffSize, dataOffset, dataSize } = readChunks(output);

    expect(output.length).toBe(input.length + 24000 * 2 * 0.3);
    expect(riffSize).toBe(output.length - 8);
    expect(dataSize).toBe(24000 * 2 + 24000 * 2 * 0.3);
    expect(output.readUInt32LE(dataOffset + 4)).toBe(dataSize);
    expect(output.subarray(output.length - 200).equals(Buffer.alloc(200))).toBe(
      true
    );
  });

  it('tailSilenceMs=0 时不补静音但头长度正确', () => {
    const payload = Buffer.alloc(2400);
    const input = buildStreamingWav(payload);
    const output = normalizeWavAudioBuffer(input, { tailSilenceMs: 0 });
    const { riffSize, dataSize } = readChunks(output);

    expect(output.length).toBe(input.length);
    expect(riffSize).toBe(output.length - 8);
    expect(dataSize).toBe(2400);
  });

  it('非 wav 输入原样返回', () => {
    const mp3 = Buffer.from('ID3mock-data');
    expect(normalizeWavAudioBuffer(mp3)).toBe(mp3);
  });
});
