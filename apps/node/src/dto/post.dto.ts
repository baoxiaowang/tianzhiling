export class CreatePostDTO {
  content?: string;
  images?: string[];
  remindAgentIds?: string[];
  /** 可见范围：public 公开 / private 私密（缺省或非法值按公开处理） */
  visibility?: string;
}

export class CreatePostCommentDTO {
  content?: string;
  replyToCommentId?: string;
}
