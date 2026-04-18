export class CreatePostDTO {
  content?: string;
  images?: string[];
  remindAgentIds?: string[];
}

export class CreatePostCommentDTO {
  content?: string;
  replyToCommentId?: string;
}
