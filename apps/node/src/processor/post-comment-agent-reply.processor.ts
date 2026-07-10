import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  POST_COMMENT_AGENT_REPLY_QUEUE,
  PostRemindReplyJobData,
  PostService,
} from '../service/post.service';

@Processor(POST_COMMENT_AGENT_REPLY_QUEUE)
export class PostCommentAgentReplyProcessor implements IProcessor {
  @Inject()
  postService: PostService;

  async execute(data: PostRemindReplyJobData): Promise<void> {
    await this.postService.processRemindReplyJob(data);
  }
}
