import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { randomUUID } from 'crypto';
import sharp = require('sharp');
import { AppError } from '../common/errors';

/**
 * 人工智能生成合成内容标识（GB 45438—2025 第 5.2、6.1 节及附录 E）
 *
 * 本服务在服务端为 AI 生成的图片内容叠加两类标识：
 * 1. 显式标识：画面右下角叠加"AI生成"显著标识，预览、保存后均保留；
 * 2. 隐式标识：写入文件元数据（XMP），记录生成属性、服务提供者、内容编号、
 *    生成时间与模型名称，支持追溯。
 *
 * 字形数据为开发期从 Noto Sans CJK SC（OFL-1.1）提取的矢量路径，运行时不依赖
 * 任何系统字体，可在 Alpine 等精简容器环境中稳定渲染。
 */

const AI_LABEL_NAMESPACE = 'https://tianzhiling.chat/ns/ai-label/1.0/';
const AI_LABEL_TOOL = 'tianzhiling-ai-label/1.0';

// 字形矢量路径，单位：1000-unit em，坐标 y 轴向上（字体坐标系）。
// 开发期提取自 NotoSansCJKsc-Regular.otf，仅包含标识所需的 4 个字形。
const GLYPH_PATHS: ReadonlyArray<{
  key: string;
  advance: number;
  d: string;
}> = [
  {
    key: 'A',
    advance: 608,
    d: 'M4 0L97 0L168 224L436 224L506 0L604 0L355 733L252 733ZM191 297L227 410C253 493 277 572 300 658L304 658C328 573 351 493 378 410L413 297Z',
  },
  { key: 'I', advance: 293, d: 'M101 0L193 0L193 733L101 733Z' },
  {
    key: 'SHENG',
    advance: 1000,
    d: 'M239 824C201 681 136 542 54 453C73 443 106 421 121 408C159 453 194 510 226 573L463 573L463 352L165 352L165 280L463 280L463 25L55 25L55 -48L949 -48L949 25L541 25L541 280L865 280L865 352L541 352L541 573L901 573L901 646L541 646L541 840L463 840L463 646L259 646C281 697 300 752 315 807Z',
  },
  {
    key: 'CHENG',
    advance: 1000,
    d: 'M544 839C544 782 546 725 549 670L128 670L128 389C128 259 119 86 36 -37C54 -46 86 -72 99 -87C191 45 206 247 206 388L206 395L389 395C385 223 380 159 367 144C359 135 350 133 335 133C318 133 275 133 229 138C241 119 249 89 250 68C299 65 345 65 371 67C398 70 415 77 431 96C452 123 457 208 462 433C462 443 463 465 463 465L206 465L206 597L554 597C566 435 590 287 628 172C562 96 485 34 396 -13C412 -28 439 -59 451 -75C528 -29 597 26 658 92C704 -11 764 -73 841 -73C918 -73 946 -23 959 148C939 155 911 172 894 189C888 56 876 4 847 4C796 4 751 61 714 159C788 255 847 369 890 500L815 519C783 418 740 327 686 247C660 344 641 463 630 597L951 597L951 670L626 670C623 725 622 781 622 839ZM671 790C735 757 812 706 850 670L897 722C858 756 779 805 716 836Z',
  },
];

// 字形之间的额外间距（字体单位，0.06em）。
const GLYPH_GAP = 60;

interface AiContentLabelConfig {
  enabled?: boolean;
  providerName?: string;
}

export interface AiContentLabelInput {
  buffer: Buffer;
  mimeType: string;
  modelName: string;
  contentId: string;
  createdAt: Date;
}

export interface AiContentLabelResult {
  buffer: Buffer;
  mimeType: string;
  labeled: boolean;
}

type OutputFormat = 'jpeg' | 'png' | 'webp';

@Provide()
export class AiContentLabelService {
  @Logger()
  logger: ILogger;

  @Config('aiContentLabel')
  config: AiContentLabelConfig;

  /**
   * 为图片内容叠加显式标识并写入隐式标识元数据。
   * 失败时抛错（fail-closed），绝不静默下发未标识的 AI 内容。
   */
  async applyContentLabel(
    input: AiContentLabelInput
  ): Promise<AiContentLabelResult> {
    this.assertEnabled();

    try {
      this.resolveOutputFormat(input.mimeType);
      if (!input.buffer.length || input.buffer.length > 50 * 1024 * 1024) {
        throw new Error('Image exceeds label processing byte limit');
      }
      const decodeOptions = { limitInputPixels: 40_000_000 };
      const metadata = await sharp(input.buffer, decodeOptions).metadata();
      const format = this.resolveOutputFormat(`image/${metadata.format}`);

      if (!metadata.width || !metadata.height) {
        throw new AppError(
          'AI_CONTENT_LABEL_METADATA_FAILED',
          '无法读取图片尺寸，AI 标识处理失败',
          502
        );
      }

      if ((metadata.pages || 1) > 1) {
        throw new Error('Animated images are not supported');
      }
      const swapAxes = (metadata.orientation || 1) >= 5;
      const width = swapAxes ? metadata.height : metadata.width;
      const height = swapAxes ? metadata.width : metadata.height;
      if (Math.min(width, height) < 256) {
        throw new Error('Image is too small for a legible label');
      }
      if (!input.contentId.trim()) {
        throw new Error('Content ID is required');
      }
      const svg = this.buildLabelSvg(width, height);
      const xmp = this.buildXmp({
        providerName: this.resolveProviderName(),
        modelName: input.modelName,
        contentId: input.contentId,
        createdAt: input.createdAt,
      });

      const output = await sharp(input.buffer, decodeOptions)
        .rotate()
        .composite([
          {
            input: Buffer.from(svg),
            left: 0,
            top: 0,
          },
        ])
        .withXmp(xmp)
        .toFormat(format, this.resolveFormatOptions(format))
        .toBuffer();

      return {
        buffer: output,
        mimeType: format === 'jpeg' ? 'image/jpeg' : `image/${format}`,
        labeled: true,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      this.logger?.error(
        '[ai-content-label] apply failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      throw new AppError(
        'AI_CONTENT_LABEL_FAILED',
        '图片 AI 标识处理失败，请稍后重试',
        502,
        error
      );
    }
  }

  assertEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'AI_CONTENT_LABEL_DISABLED',
        '图片标识服务未启用，暂不能生成合照',
        503
      );
    }
  }

  /** 生成唯一内容编号；调用方已提供时直接使用。 */
  buildContentId(externalId?: string): string {
    const source = externalId?.trim() || randomUUID();
    return `tzl-memorial-${source}`;
  }

  private resolveProviderName(): string {
    return this.config?.providerName?.trim() || '武汉市天之灵智能技术有限公司';
  }

  private resolveOutputFormat(mimeType: string): OutputFormat {
    const normalized = mimeType.toLowerCase();

    if (normalized === 'image/jpeg' || normalized === 'image/jpg') {
      return 'jpeg';
    }
    if (normalized === 'image/png') {
      return 'png';
    }
    if (normalized === 'image/webp') {
      return 'webp';
    }

    throw new AppError(
      'AI_CONTENT_LABEL_UNSUPPORTED_FORMAT',
      `不支持的图片格式：${mimeType}`,
      502
    );
  }

  private resolveFormatOptions(format: OutputFormat): {
    quality?: number;
    compressionLevel?: number;
  } {
    if (format === 'jpeg') {
      return { quality: 92 };
    }
    if (format === 'png') {
      return { compressionLevel: 6 };
    }
    return { quality: 90 };
  }

  /**
   * 构建覆盖整图的透明 SVG：右下角叠加深色圆角条 + 白色"AI生成"文字。
   * 文字字形使用内嵌矢量路径，运行时不依赖系统字体。
   */
  private buildLabelSvg(width: number, height: number): string {
    // 按可见字形高度而非底条或字号验收；最矮的 A/I 为 733 字体单位。
    const shortEdge = Math.min(width, height);
    const minInkHeight = Math.ceil(shortEdge * 0.05) + 2;
    const scale = minInkHeight / 733;
    const paddingX = Math.ceil(shortEdge * 0.012);
    const paddingY = Math.ceil(shortEdge * 0.008);
    const barHeight = Math.ceil(927 * scale) + paddingY * 2;
    const margin = Math.ceil(shortEdge * 0.02);

    const glyphKeys: ReadonlyArray<string> = ['A', 'I', 'SHENG', 'CHENG'];
    const totalAdvance =
      glyphKeys.reduce((sum, key) => {
        const glyph = GLYPH_PATHS.find(item => item.key === key);
        return sum + (glyph?.advance ?? 0);
      }, 0) +
      GLYPH_GAP * (glyphKeys.length - 1);

    const barWidth = Math.round(totalAdvance * scale + paddingX * 2);
    const barX = width - barWidth - margin;
    const barY = height - barHeight - margin;
    const textStartX = barX + paddingX;
    const baselineY = barY + paddingY + 840 * scale;

    const textParts: string[] = [];
    let cursor = 0;

    for (let index = 0; index < glyphKeys.length; index += 1) {
      const glyph = GLYPH_PATHS.find(item => item.key === glyphKeys[index]);

      if (!glyph) {
        continue;
      }

      const glyphX = textStartX + Math.round(cursor * scale);
      textParts.push(
        `<g transform="translate(${glyphX} ${baselineY}) scale(${scale} -${scale})"><path d="${glyph.d}"/></g>`
      );
      cursor += glyph.advance + GLYPH_GAP;
    }

    const rectRadius = Math.round(barHeight * 0.15);

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
      `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${barHeight}" rx="${rectRadius}" fill="#202020"/>`,
      `<g fill="#ffffff">${textParts.join('')}</g>`,
      '</svg>',
    ].join('');
  }

  private buildXmp(input: {
    providerName: string;
    modelName: string;
    contentId: string;
    createdAt: Date;
  }): string {
    const escapeXml = (value: string): string => {
      return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const aigc = JSON.stringify({
      AIGC: {
        Label: '1',
        ContentProducer: input.providerName,
        ProduceID: input.contentId,
        ReservedCode1: '',
        ContentPropagator: input.providerName,
        PropagateID: input.contentId,
        ReservedCode2: '',
      },
    });

    return [
      '<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>',
      '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
      '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
      `<rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/" xmlns:tzlai="${AI_LABEL_NAMESPACE}">`,
      `<xmp:CreatorTool>${AI_LABEL_TOOL}</xmp:CreatorTool>`,
      `<xmp:CreateDate>${input.createdAt.toISOString()}</xmp:CreateDate>`,
      `<xmp:AIGC>${escapeXml(aigc)}</xmp:AIGC>`,
      '<tzlai:contentType>image</tzlai:contentType>',
      `<tzlai:provider>${escapeXml(input.providerName)}</tzlai:provider>`,
      `<tzlai:model>${escapeXml(input.modelName)}</tzlai:model>`,
      `<tzlai:contentId>${escapeXml(input.contentId)}</tzlai:contentId>`,
      '</rdf:Description>',
      '</rdf:RDF>',
      '</x:xmpmeta>',
      '<?xpacket end="w"?>',
    ].join('');
  }
}
