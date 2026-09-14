import sharp = require('sharp');
import { AiContentLabelService } from '../../src/service/ai-content-label.service';
const PROVIDER = '武汉市天之灵智能技术有限公司';
function service(enabled = true) {
  const value = new AiContentLabelService();
  value.config = { enabled, providerName: PROVIDER };
  return value;
}
function input(buffer: Buffer, mimeType = 'image/png') {
  return {
    buffer,
    mimeType,
    modelName: 'wan2.7-image-pro',
    contentId: 'test-id',
    createdAt: new Date('2026-09-14T08:00:00Z'),
  };
}
function source(width = 1024, height = 768) {
  return sharp({
    create: { width, height, channels: 3, background: '#788ca0' },
  });
}
function readAigc(xmp: string) {
  const encoded = xmp.match(/<xmp:AIGC>(.*?)<\/xmp:AIGC>/)?.[1];
  expect(encoded).toBeDefined();
  return JSON.parse(
    encoded!
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  ).AIGC;
}
describe('memorial photo labels', () => {
  it.each(['jpeg', 'png', 'webp'] as const)(
    'writes one standard AIGC record into actual %s',
    async format => {
      const original = await source().toFormat(format).toBuffer();
      const output = await service().applyContentLabel(
        input(original, `image/${format}`)
      );
      const meta = await sharp(output.buffer).metadata();
      const xmp = meta.xmp!.toString('utf8');
      expect(xmp.match(/<xmp:AIGC>/g)).toHaveLength(1);
      expect(readAigc(xmp)).toEqual({
        Label: '1',
        ContentProducer: PROVIDER,
        ProduceID: 'test-id',
        ReservedCode1: '',
        ContentPropagator: PROVIDER,
        PropagateID: 'test-id',
        ReservedCode2: '',
      });
      expect(meta.format).toBe(format);
      expect([meta.width, meta.height]).toEqual([1024, 768]);
      expect(output.mimeType).toBe(`image/${format}`);
      expect(output.labeled).toBe(true);
    }
  );
  it.each([
    [1024, 768],
    [768, 1024],
    [4096, 512],
    [256, 256],
  ])(
    'keeps every visible glyph >=5%% of short edge (%i x %i)',
    async (width, height) => {
      const output = await service().applyContentLabel(
        input(await source(width, height).png().toBuffer())
      );
      const { data, info } = await sharp(output.buffer)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const columns: Array<{ x: number; min: number; max: number }> = [];
      for (let x = 0; x < info.width; x++) {
        let min = height,
          max = -1;
        for (let y = 0; y < height; y++) {
          const i = (y * width + x) * 3;
          if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230) {
            min = Math.min(min, y);
            max = Math.max(max, y);
          }
        }
        if (max >= 0) columns.push({ x, min, max });
      }
      const glyphs: Array<{ last: number; min: number; max: number }> = [];
      for (const col of columns) {
        const prev = glyphs[glyphs.length - 1];
        if (prev && col.x === prev.last + 1) {
          prev.last = col.x;
          prev.min = Math.min(prev.min, col.min);
          prev.max = Math.max(prev.max, col.max);
        } else {
          glyphs.push({ last: col.x, min: col.min, max: col.max });
        }
      }
      expect(glyphs).toHaveLength(4);
      for (const glyph of glyphs)
        expect(glyph.max - glyph.min + 1).toBeGreaterThanOrEqual(
          Math.ceil(Math.min(width, height) * 0.05)
        );
      expect(columns[0].x).toBeGreaterThan(width / 2);
      expect(Math.min(...glyphs.map(g => g.min))).toBeGreaterThan(height / 2);
      const corner = await sharp(output.buffer)
        .extract({ left: 0, top: 0, width: 16, height: 16 })
        .raw()
        .toBuffer();
      expect(corner[0]).toBe(120);
    }
  );
  it('normalizes orientation before positioning', async () => {
    const original = await source(800, 600)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(
      (
        await service().applyContentLabel(input(original, 'image/jpeg'))
      ).buffer
    ).metadata();
    expect([meta.width, meta.height]).toEqual([600, 800]);
    expect(meta.orientation || 1).toBe(1);
  });
  it('replaces prior metadata with one AIGC record', async () => {
    const label = service();
    const first = await label.applyContentLabel(
      input(await source().png().toBuffer())
    );
    const second = await label.applyContentLabel({
      ...input(first.buffer),
      contentId: 'second-id',
    });
    const xmp = (await sharp(second.buffer).metadata()).xmp!.toString();
    expect(xmp.match(/<xmp:AIGC>/g)).toHaveLength(1);
    expect(readAigc(xmp).ProduceID).toBe('second-id');
    expect(xmp).not.toContain('test-id');
  });
  it('escapes XML and JSON', async () => {
    const label = service();
    label.config.providerName = 'Test & "Company" <provider>';
    const output = await label.applyContentLabel(
      input(await source().png().toBuffer())
    );
    expect(
      readAigc((await sharp(output.buffer).metadata()).xmp!.toString())
        .ContentProducer
    ).toBe(label.config.providerName);
  });
  it('blocks generation when disabled', async () => {
    await expect(
      service(false).applyContentLabel(input(await source().png().toBuffer()))
    ).rejects.toMatchObject({ code: 'AI_CONTENT_LABEL_DISABLED' });
  });
  it.each(['image/gif', 'image/svg+xml'])(
    'rejects unsupported format %s',
    async mime => {
      await expect(
        service().applyContentLabel(
          input(await source().png().toBuffer(), mime)
        )
      ).rejects.toMatchObject({ code: 'AI_CONTENT_LABEL_UNSUPPORTED_FORMAT' });
    }
  );
  it('fails closed for corrupt and tiny images', async () => {
    await expect(
      service().applyContentLabel(input(Buffer.from('bad')))
    ).rejects.toMatchObject({ code: 'AI_CONTENT_LABEL_FAILED' });
    await expect(
      service().applyContentLabel(input(await source(32, 32).png().toBuffer()))
    ).rejects.toMatchObject({ code: 'AI_CONTENT_LABEL_FAILED' });
  });
  it('returns actual MIME when supplier header is wrong', async () => {
    const result = await service().applyContentLabel(
      input(await source().jpeg().toBuffer(), 'image/png')
    );
    expect(result.mimeType).toBe('image/jpeg');
  });
  it('creates distinct fallback IDs', () => {
    const label = service();
    expect(label.buildContentId()).not.toBe(label.buildContentId());
    expect(label.buildContentId(' req-1 ')).toBe('tzl-memorial-req-1');
  });
});
