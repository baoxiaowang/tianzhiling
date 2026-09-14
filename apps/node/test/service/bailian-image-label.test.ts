import sharp = require('sharp');
import { BailianImageService } from '../../src/service/bailian-image.service';
import { AiContentLabelService } from '../../src/service/ai-content-label.service';

function setup(enabled = true) {
  const label = new AiContentLabelService();
  label.config = { enabled };
  const service = new BailianImageService();
  service.config = { apiKey: 'test-key', model: 'test-model' };
  service.logger = { info: jest.fn(), error: jest.fn() } as any;
  service.aiContentLabelService = label;
  const request = jest.spyOn(service as any, 'requestJson').mockResolvedValue({
    request_id: 'supplier-request',
    output: {
      choices: [
        {
          message: {
            content: [{ image: 'https://example.invalid/unlabelled.png' }],
          },
        },
      ],
    },
  });
  const download = jest.spyOn(service as any, 'downloadImage');
  return { service, request, download };
}
const input = {
  agentPhotoUrls: ['https://example.invalid/reference.png'],
  userPhotoUrl: 'https://example.invalid/user.png',
};
it('only returns labeled bytes for COS storage, never an unlabelled URL fallback', async () => {
  const { service, download } = setup();
  const buffer = await sharp({
    create: { width: 512, height: 512, channels: 3, background: '#788ca0' },
  })
    .png()
    .toBuffer();
  download.mockResolvedValue({
    body: buffer,
    headers: { 'content-type': 'image/png' },
  });
  const result = await service.generateMemorialPhoto(input);
  expect(result.imageUrl).toBe('');
  expect(result.imageBuffer.equals(buffer)).toBe(false);
  expect(
    (await sharp(result.imageBuffer).metadata()).xmp!.toString()
  ).toContain('xmp:AIGC');
  expect(result.requestId).toBe('supplier-request');
  expect(result.contentId).toBe('tzl-memorial-supplier-request');
});
it('rejects before supplier billing if labeling is disabled', async () => {
  const { service, request } = setup(false);
  await expect(service.generateMemorialPhoto(input)).rejects.toMatchObject({
    code: 'AI_CONTENT_LABEL_DISABLED',
  });
  expect(request).not.toHaveBeenCalled();
});
it('does not return unlabelled content if labeling fails', async () => {
  const { service, download } = setup();
  download.mockResolvedValue({
    body: Buffer.from('invalid image'),
    headers: { 'content-type': 'image/png' },
  });
  await expect(service.generateMemorialPhoto(input)).rejects.toMatchObject({
    code: 'AI_CONTENT_LABEL_FAILED',
  });
});
