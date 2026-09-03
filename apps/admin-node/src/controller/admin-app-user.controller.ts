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
  ListAdminAppUserMembersQueryDTO,
  ListAdminAppUsersQueryDTO,
  ListAdminAppUserVoiceServicesQueryDTO,
  UpdateAdminAppUserDTO,
} from '../dto/admin-app-user.dto';
import { ListAdminPostsQueryDTO } from '../dto/admin-post.dto';
import { AdminAppUserService } from '../service/admin-app-user.service';
import { AdminPostService } from '../service/admin-post.service';

@Controller('/app-users')
export class AdminAppUserController {
  @Inject()
  adminAppUserService: AdminAppUserService;

  @Inject()
  adminPostService: AdminPostService;

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

  @Get('/:id/posts')
  async posts(@Param('id') id: string, @Query() query: ListAdminPostsQueryDTO) {
    return this.adminPostService.listUserPosts(id, query);
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
