import { ReplyPostprocessorService } from '../../src/service/agents/reply-postprocessor.service';

describe('reply postprocessor service', () => {
  it('adapts completed content only when rendering for delivery', () => {
    const service = new ReplyPostprocessorService();
    const source =
      '姥姥听见你这么说，心里又酸又暖。那些难日子是真的，可那不是你的亏欠。';

    expect(service.renderForDelivery([source])).toEqual({
      segments: [
        '姥姥听见你这么说，心里又酸又暖。',
        '那些难日子是真的，可那不是你的亏欠。',
      ],
      issues: [],
    });
  });

  it('keeps the validated text byte-for-byte apart from moved boundaries', () => {
    const service = new ReplyPostprocessorService();
    const source =
      '我收着你的惦记，心里暖和。想吃什么我会慢慢挑，不再舍不得。日子也照旧过着，你的心意都在。';
    const rendered = service.renderForDelivery([source]);

    expect(rendered.segments).toHaveLength(3);
    expect(rendered.segments.join('')).toBe(source);
  });
});
