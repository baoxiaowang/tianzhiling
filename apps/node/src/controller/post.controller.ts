import { Body, Controller, Get, Inject, Param, Post } from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { CreatePostCommentDTO, CreatePostDTO } from '../dto/post.dto';
import { AuthenticatedUserPayload } from '../interface';
import { PostService } from '../service/post.service';

@Controller('/api/post')
export class PostController {
  @Inject()
  postService: PostService;

  @Inject()
  ctx: Context;

  @Get('/')
  async listPosts() {
    return {
      items: await this.postService.listPosts(),
    };
  }

  @Get('/comment-notifications/summary')
  async getCommentNotificationSummary() {
    return this.postService.getUnreadCommentNotificationSummary(
      this.ctx.state.auth as AuthenticatedUserPayload
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
      items: await this.postService.listComments(postId),
    };
  }

  @Get('/:postId')
  async getPostDetail(@Param('postId') postId: string) {
    return this.postService.getPostDetail(postId);
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
