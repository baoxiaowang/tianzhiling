import { Body, Controller, Files, Get, Inject, Param, Post } from '@midwayjs/core';
import { UploadFileInfo, UploadMiddleware } from '@midwayjs/busboy';
import { AppError } from '@tzl/shared';
import {
  AgentVtChatBodyDTO,
  AgentVtClipBodyDTO,
  AgentVtCreateTrainingBodyDTO,
  AgentVtMaterialBodyDTO,
  AgentVtUploadSignBodyDTO,
} from '../dto/agent-vt.dto';
import { AgentVtApiService } from '../service/agent-vt-api.service';
import { AgentVtChatService } from '../service/agent-vt-chat.service';
import { AdminStorageService } from '../service/admin-storage.service';
import type { AgentVtAuthState } from '../middleware/agent-vt-auth.middleware';

/**
 * 声音训练 Agent 工作台受限 API。
 *
 * 身份只来自路径 token（ctx.state.agentVt，由 AgentVtAuthMiddleware 注入），
 * 请求体不得携带 userId/agentId；越权统一 404。
 */
@Controller('/agent_vt/api')
export class AgentVtApiController {
  @Inject()
  agentVtApiService: AgentVtApiService;

  @Inject()
  agentVtChatService: AgentVtChatService;

  @Inject()
  adminStorageService: AdminStorageService;

  private auth(ctx: unknown): AgentVtAuthState {
    const state = (ctx as { state?: { agentVt?: AgentVtAuthState } }).state;
    if (!state?.agentVt) {
      throw new AppError('AGENT_VT_FORBIDDEN', 'unauthorized', 401);
    }
    return state.agentVt;
  }

  /** 会话信息：亲人名称等（不包含敏感数据）。 */
  @Get('/:token/me')
  async me(ctx: unknown) {
    const auth = this.auth(ctx);
    return {
      agentName: auth.agentName || '未命名',
      title: '声音训练工作台',
    };
  }

  /** 该用户全部音色。 */
  @Get('/:token/timbres')
  async timbres(ctx: unknown) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.listTimbres(auth.userId);
  }

  /** 豆包槽位（只读）。 */
  @Get('/:token/slots')
  async slots(ctx: unknown) {
    const auth = this.auth(ctx);
    void auth;
    return this.agentVtApiService.listSlots();
  }

  /** 创建声音训练（身份强制来自 token）。 */
  @Post('/:token/timbres')
  async createTraining(
    ctx: unknown,
    @Body() body: AgentVtCreateTrainingBodyDTO
  ) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.createTraining(auth.userId, {
      audioObjectKey: body.audioObjectKey,
      audioObjectKeys: body.audioObjectKeys,
      name: body.name,
      provider: body.provider,
      speechDialect: body.speechDialect,
      speechInstruction: body.speechInstruction,
      previewText: body.previewText,
      speechSpeed: body.speechSpeed,
      speechVolume: body.speechVolume,
    });
  }

  /** 保存声音素材（与管理后台一致）。 */
  @Post('/:token/materials')
  async saveMaterial(
    ctx: unknown,
    @Body() body: AgentVtMaterialBodyDTO
  ) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.saveMaterial(auth.userId, {
      name: body.name,
      objectKey: body.objectKey,
      publicUrl: body.publicUrl,
    });
  }

  /** 剪辑素材为训练片段（与管理后台第二步一致）。 */
  @Post('/:token/clip')
  async clipMaterials(ctx: unknown, @Body() body: AgentVtClipBodyDTO) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.clipMaterials(auth.userId, {
      materials: body.materials,
    });
  }

  /** 重试训练（先归属断言）。 */
  @Post('/:token/timbres/:id/retry')
  async retryTraining(ctx: unknown, @Param('id') id: string) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.retryTraining(auth.userId, id);
  }

  /** 绑定训练完成的音色到该账号的 AI 亲人（agentId 由 token 决定）。 */
  @Post('/:token/timbres/:id/bind')
  async bindTraining(ctx: unknown, @Param('id') id: string) {
    const auth = this.auth(ctx);
    return this.agentVtApiService.bindToRelative(auth.userId, id, auth.agentId);
  }

  /** COS 直传签名（工作台上传音频用，目录隔离 agent-vt/{userId}）。 */
  @Post('/:token/upload-sign')
  async uploadSign(
    ctx: unknown,
    @Body() body: AgentVtUploadSignBodyDTO
  ) {
    const auth = this.auth(ctx);
    return this.adminStorageService.createCosSignedUpload({
      fileName: body.fileName,
      contentType: body.contentType,
      expiresInSeconds: body.expiresInSeconds,
      folder: `agent-vt/${auth.userId.toHexString()}`,
    });
  }

  /** 对话式训练编排。 */
  @Post('/:token/chat')
  async chat(ctx: unknown, @Body() body: AgentVtChatBodyDTO) {
    const auth = this.auth(ctx);
    return this.agentVtChatService.chat(
      {
        messages: body.messages,
        attachments: body.attachments,
      },
      {
        userId: auth.userId,
        agentId: auth.agentId,
        agentName: auth.agentName,
      }
    );
  }

  /** 工作台上传音频（服务端中转；目录强制隔离 agent-vt/{userId}）。 */
  @Post('/:token/upload', {
    middleware: [UploadMiddleware],
  })
  async upload(
    ctx: unknown,
    @Files() files: UploadFileInfo[],
    @Body() body: Record<string, string>
  ) {
    const auth = this.auth(ctx);
    const file = files?.[0];
    if (!file) {
      throw new AppError('UPLOAD_FILE_MISSING', 'upload file is missing', 400);
    }
    return this.adminStorageService.uploadCosFile({
      filePath: file.data,
      fileName: file.filename,
      folder: `agent-vt/${auth.userId.toHexString()}`,
      contentType: body?.contentType || file.mimeType,
    });
  }
}
