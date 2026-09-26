import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
} from '@midwayjs/core';
import {
  ListAdminAppUserAgentsQueryDTO,
  ListAdminAppUserMemoriesQueryDTO,
  ListAdminAppUserMembersQueryDTO,
  ListAdminAppUsersQueryDTO,
  ListAdminAppUserVoiceServicesQueryDTO,
  UpdateAdminAppUserDTO,
} from '../dto/admin-app-user.dto';
import { ListAdminPostsQueryDTO } from '../dto/admin-post.dto';
import type { SendAdminAppUserMessengerMessageRequestDTO } from '@tzl/shared';
import { AdminAuthenticatedPayload } from '@tzl/shared';
import { Context } from '@midwayjs/koa';
import { AdminAppUserService } from '../service/admin-app-user.service';
import { AdminPostService } from '../service/admin-post.service';
import { AdminAppPreviewGrantService } from '../service/admin-app-preview-grant.service';

@Controller('/app-users')
export class AdminAppUserController {
  @Inject()
  adminAppUserService: AdminAppUserService;

  @Inject()
  adminPostService: AdminPostService;

  @Inject()
  adminAppPreviewGrantService: AdminAppPreviewGrantService;

  @Inject()
  ctx: Context;

  @Post('/:id/preview-grants')
  async issuePreviewGrant(@Param('id') id: string) {
    return this.adminAppPreviewGrantService.issue(
      id,
      this.ctx.state.adminAuth as AdminAuthenticatedPayload
    );
  }

  @Get('/')
  async list(@Query() query: ListAdminAppUsersQueryDTO) {
    return this.adminAppUserService.listUsers(query);
  }

  @Get('/members')
  async members(@Query() query: ListAdminAppUserMembersQueryDTO) {
    return this.adminAppUserService.listMembers(query);
  }

  @Get('/voice-services')
  async voiceServices(@Query() query: ListAdminAppUserVoiceServicesQueryDTO) {
    return this.adminAppUserService.listVoiceServiceUsers(query);
  }

  @Post('/:id/voice-service/start')
  async startVoiceService(@Param('id') id: string) {
    return this.adminAppUserService.startVoiceService(id);
  }

  @Get('/:id/agents')
  async agents(
    @Param('id') id: string,
    @Query() query: ListAdminAppUserAgentsQueryDTO
  ) {
    return this.adminAppUserService.listUserAgents(id, query);
  }

  @Get('/:id/agents/:agentId/messenger-messages')
  async messengerMessages(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
    @Query() query: { before?: string; pageSize?: string }
  ) {
    return this.adminAppUserService.listMessengerMessages(id, agentId, query);
  }

  /** 只读：按用户 + 聊天对象读取聊天记录（含非小使者的角色智能体）。 */
  @Get('/:id/agents/:agentId/messages')
  async agentMessages(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
    @Query() query: { before?: string; pageSize?: string }
  ) {
    return this.adminAppUserService.listAgentMessages(id, agentId, query);
  }

  /** 只读：按用户 + 聊天对象分页读取已留存记忆，账号级共享记忆单独返回。 */
  @Get('/:id/agents/:agentId/memories')
  async agentMemories(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
    @Query() query: ListAdminAppUserMemoriesQueryDTO
  ) {
    return this.adminAppUserService.listAgentMemories(id, agentId, query);
  }

  /** 只读：按用户 + 聊天对象分页读取“可检索原话”（已入索引且来源有效）。 */
  @Get('/:id/agents/:agentId/indexed-evidence')
  async indexedEvidence(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
    @Query() query: ListAdminAppUserMemoriesQueryDTO
  ) {
    return this.adminAppUserService.listIndexedEvidence(id, agentId, query);
  }

  /** 只读：核心信息（称呼/日期/语言与性格/核心家人状态的当前采用值、来源与未采用原因）。 */
  @Get('/:id/agents/:agentId/core-info')
  async agentCoreInfo(
    @Param('id') id: string,
    @Param('agentId') agentId: string
  ) {
    return this.adminAppUserService.getAgentCoreInfo(id, agentId);
  }

  @Post('/:id/agents/:agentId/messenger-messages')
  async sendMessengerMessage(
    @Param('id') id: string,
    @Param('agentId') agentId: string,
    @Body() body: SendAdminAppUserMessengerMessageRequestDTO
  ) {
    return this.adminAppUserService.sendMessengerMessage(id, agentId, body);
  }

  @Get('/:id/posts')
  async posts(@Param('id') id: string, @Query() query: ListAdminPostsQueryDTO) {
    return this.adminPostService.listUserPosts(id, query);
  }

  @Get('/:id/account-memory')
  async accountMemory(@Param('id') id: string) {
    return this.adminAppUserService.getAccountMemory(id);
  }

  @Get('/:id')
  async detail(@Param('id') id: string) {
    return this.adminAppUserService.getUserDetail(id);
  }

  @Put('/:id')
  async update(@Param('id') id: string, @Body() body: UpdateAdminAppUserDTO) {
    return this.adminAppUserService.updateUser(id, body);
  }
}
