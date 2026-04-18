import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  POST_REMIND_REPLY_QUEUE,
  PostRemindReplyJobData,
  PostService,
} from '../service/post.service';

@Processor(POST_REMIND_REPLY_QUEUE)
export class PostRemindReplyProcessor implements IProcessor {
  @Inject()
  postService: PostService;

  async execute(data: PostRemindReplyJobData): Promise<void> {
    await this.postService.processRemindReplyJob(data);
  }
}
