import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Post,
  Query,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { CreatePostCommentDTO, CreatePostDTO } from '../dto/post.dto';
import { AuthenticatedUserPayload } from '../interface';
import { PostService } from '../service/post.service';

@Controller('/post')
export class PostController {
  @Inject()
  postService: PostService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listPosts(
    @Query() query: { page?: string; pageSize?: string; mine?: string }
  ) {
    return this.postService.listPosts(
      this.ctx.state.auth as AuthenticatedUserPayload | undefined,
      query
    );
  }

  @Get('/comment-notifications/summary')
  async getCommentNotificationSummary() {
    return this.postService.getUnreadCommentNotificationSummary(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Get('/comment-notifications')
  async listCommentNotifications(
    @Query() query: { page?: string; pageSize?: string }
  ) {
    return this.postService.listCommentNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload,
      query
    );
  }

  @Get('/notifications/summary')
  async getPostNotificationSummary() {
    return this.postService.getUnreadPostNotificationSummary(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Get('/notifications/entry-summary')
  async getPostNotificationEntrySummary() {
    return this.postService.getPostNotificationEntrySummary(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Get('/notifications')
  async listPostNotifications(
    @Query() query: { page?: string; pageSize?: string; read?: string }
  ) {
    return this.postService.listPostNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload,
      query
    );
  }

  @Post('/notifications/read')
  async readUnreadPostNotifications() {
    return this.postService.readUnreadPostNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Post('/notifications/seen')
  async seePostNotifications() {
    return this.postService.seePostNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Post('/notifications/entry-seen')
  async seePostNotificationEntry() {
    return this.postService.seePostNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Post('/notifications/:notificationId/read')
  async readPostNotification(@Param('notificationId') notificationId: string) {
    return this.postService.readPostNotification(
      this.ctx.state.auth as AuthenticatedUserPayload,
      notificationId
    );
  }

  @Post('/')
  async createPost(@Body() body: CreatePostDTO) {
    return this.postService.createPost(
      this.ctx.state.auth as AuthenticatedUserPayload,
      body
    );
  }

  @Get('/:postId/comments')
  async listComments(@Param('postId') postId: string) {
    return {
      items: await this.postService.listComments(
        postId,
        this.ctx.state.auth as AuthenticatedUserPayload | undefined
      ),
    };
  }

  @Get('/:postId')
  async getPostDetail(@Param('postId') postId: string) {
    return this.postService.getPostDetail(
      postId,
      this.ctx.state.auth as AuthenticatedUserPayload | undefined
    );
  }

  @Post('/:postId/likes')
  async likePost(@Param('postId') postId: string) {
    return this.postService.likePost(
      this.ctx.state.auth as AuthenticatedUserPayload,
      postId
    );
  }

  @Del('/:postId/likes')
  async unlikePost(@Param('postId') postId: string) {
    return this.postService.unlikePost(
      this.ctx.state.auth as AuthenticatedUserPayload,
      postId
    );
  }

  @Del('/:postId')
  async deletePost(@Param('postId') postId: string) {
    return this.postService.deletePost(
      this.ctx.state.auth as AuthenticatedUserPayload,
      postId
    );
  }

  @Post('/comment-notifications/read')
  async readUnreadCommentNotifications() {
    return this.postService.readUnreadCommentNotifications(
      this.ctx.state.auth as AuthenticatedUserPayload
    );
  }

  @Post('/:postId/comment-notifications/read')
  async markCommentNotificationsRead(@Param('postId') postId: string) {
    return this.postService.markPostCommentNotificationsRead(
      this.ctx.state.auth as AuthenticatedUserPayload,
      postId
    );
  }

  @Post('/:postId/comments')
  async createComment(
    @Param('postId') postId: string,
    @Body() body: CreatePostCommentDTO
  ) {
    return this.postService.createComment(
      this.ctx.state.auth as AuthenticatedUserPayload,
      postId,
      body
    );
  }
}
