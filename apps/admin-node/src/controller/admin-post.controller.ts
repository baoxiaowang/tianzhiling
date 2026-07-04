import { Body, Controller, Get, Inject, Param, Put, Query } from '@midwayjs/core';
import {
  ListAdminPostsQueryDTO,
  UpdateAdminPostModerationDTO,
} from '../dto/admin-post.dto';
import { AdminPostService } from '../service/admin-post.service';

@Controller('/posts')
export class AdminPostController {
  @Inject()
  adminPostService: AdminPostService;

  @Get('/')
  async list(@Query() query: ListAdminPostsQueryDTO) {
    return this.adminPostService.listPosts(query);
  }

  @Put('/:id/moderation')
  async updateModeration(
    @Param('id') id: string,
    @Body() body: UpdateAdminPostModerationDTO
  ) {
    return this.adminPostService.updatePostModeration(id, body);
  }
}
