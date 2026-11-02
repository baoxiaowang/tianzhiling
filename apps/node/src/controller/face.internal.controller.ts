import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { UserKnownPersonFaceSource } from '@tzl/entities';
import { FaceRecognitionService } from '../service/face-recognition.service';

/**
 * 内部接口：供管理后台维护「家人相册」并做识别测试。
 * 需携带与 .env INTERNAL_API_SECRET 一致的 x-internal-secret 请求头。
 */
@Controller('/system')
export class FaceInternalController {
  @Inject()
  ctx: Context;

  @Inject()
  faceRecognitionService: FaceRecognitionService;

  private authorized(): boolean {
    const expected = process.env.INTERNAL_API_SECRET;
    return Boolean(expected) && this.ctx.get('x-internal-secret') === expected;
  }

  @Post('/face/analyze')
  async analyze(
    @Body() body: { objectKey?: string; imageBase64?: string }
  ) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    try {
      const buffer = body?.imageBase64
        ? Buffer.from(body.imageBase64, 'base64')
        : undefined;
      const result = await this.faceRecognitionService.analyze({
        buffer,
        objectKey: body?.objectKey,
      });
      return { ok: true, data: result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('/face/register')
  async register(
    @Body()
    body: {
      userId: string;
      personId: string;
      objectKeys?: string[];
      imageBase64s?: string[];
      source?: UserKnownPersonFaceSource;
    }
  ) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    try {
      const images = [
        ...(body?.objectKeys || []).map(objectKey => ({ objectKey })),
        ...(body?.imageBase64s || []).map(imageBase64 => ({
          buffer: Buffer.from(imageBase64, 'base64'),
        })),
      ];
      const result = await this.faceRecognitionService.registerFaces({
        userId: body.userId,
        personId: body.personId,
        images,
        source: body?.source || UserKnownPersonFaceSource.admin,
        consentAt: new Date(),
      });
      return { ok: true, data: result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('/face/recognize')
  async recognize(
    @Body()
    body: {
      userId: string;
      agentId?: string;
      objectKey?: string;
      imageBase64?: string;
    }
  ) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    try {
      const buffer = body?.imageBase64
        ? Buffer.from(body.imageBase64, 'base64')
        : undefined;
      const result = await this.faceRecognitionService.recognize({
        userId: body.userId,
        agentId: body.agentId,
        objectKey: body.objectKey,
        buffer,
      });
      return { ok: true, data: result };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('/face/person/faces')
  async listFaces(@Body() body: { userId: string; personId: string }) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const data = await this.faceRecognitionService.listPersonFaces({
      userId: body.userId,
      personId: body.personId,
    });
    return { ok: true, data };
  }

  @Post('/face/person/merge')
  async mergePersons(
    @Body()
    body: { userId: string; sourcePersonId: string; targetPersonId: string }
  ) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    try {
      const data = await this.faceRecognitionService.mergePersons({
        userId: body.userId,
        sourcePersonId: body.sourcePersonId,
        targetPersonId: body.targetPersonId,
      });
      return { ok: true, data };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  @Post('/face/person/delete')
  async deleteFaces(@Body() body: { userId: string; personId: string }) {
    if (!this.authorized()) {
      return { ok: false, error: 'UNAUTHORIZED' };
    }
    const data = await this.faceRecognitionService.deletePersonFaces({
      userId: body.userId,
      personId: body.personId,
    });
    return { ok: true, data };
  }
}
