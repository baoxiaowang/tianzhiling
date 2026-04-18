enum PostCommentType { user, agent }

class PostCommentNotificationSummary {
  const PostCommentNotificationSummary({
    required this.unreadCount,
    required this.latest,
  });

  final int unreadCount;
  final PostCommentNotificationItem? latest;

  factory PostCommentNotificationSummary.fromJson(Map<String, dynamic> json) {
    return PostCommentNotificationSummary(
      unreadCount: PostItem._parseInt(json['unreadCount']),
      latest: json['latest'] is Map
          ? PostCommentNotificationItem.fromJson(
              (json['latest'] as Map).cast<String, dynamic>(),
            )
          : null,
    );
  }
}

class PostCommentNotificationItem {
  const PostCommentNotificationItem({
    required this.id,
    required this.postId,
    required this.commentId,
    required this.type,
    required this.actorName,
    required this.actorAvatar,
    required this.commentPreview,
    required this.isRead,
    required this.createdAt,
  });

  final String id;
  final String postId;
  final String commentId;
  final PostCommentType type;
  final String actorName;
  final String actorAvatar;
  final String commentPreview;
  final bool isRead;
  final DateTime? createdAt;

  factory PostCommentNotificationItem.fromJson(Map<String, dynamic> json) {
    return PostCommentNotificationItem(
      id: json['id'] as String? ?? '',
      postId: json['postId'] as String? ?? '',
      commentId: json['commentId'] as String? ?? '',
      type: PostCommentItem._parseCommentType(json['type']),
      actorName: json['actorName'] as String? ?? '',
      actorAvatar: json['actorAvatar'] as String? ?? '',
      commentPreview: json['commentPreview'] as String? ?? '',
      isRead: json['isRead'] == true,
      createdAt: PostItem._parseDate(json['createdAt']),
    );
  }
}

class PostItem {
  const PostItem({
    required this.id,
    required this.userId,
    required this.authorName,
    required this.authorAvatar,
    required this.content,
    required this.images,
    required this.remindAgentIds,
    required this.commentCount,
    required this.comments,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String userId;
  final String authorName;
  final String authorAvatar;
  final String content;
  final List<String> images;
  final List<String> remindAgentIds;
  final int commentCount;
  final List<PostCommentItem> comments;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory PostItem.fromJson(Map<String, dynamic> json) {
    return PostItem(
      id: json['id'] as String? ?? '',
      userId: json['userId'] as String? ?? '',
      authorName: json['authorName'] as String? ?? '',
      authorAvatar: json['authorAvatar'] as String? ?? '',
      content: json['content'] as String? ?? '',
      remindAgentIds:
          (json['remindAgentIds'] as List?)
              ?.whereType<String>()
              .map((item) => item.trim())
              .where((item) => item.isNotEmpty)
              .toList() ??
          const [],
      commentCount: _parseInt(json['commentCount']),
      comments:
          (json['comments'] as List?)
              ?.whereType<Map>()
              .map(
                (item) =>
                    PostCommentItem.fromJson(item.cast<String, dynamic>()),
              )
              .toList() ??
          const [],
      images:
          (json['images'] as List?)
              ?.whereType<String>()
              .map((image) => image.trim())
              .where((image) => image.isNotEmpty)
              .toList() ??
          const [],
      createdAt: _parseDate(json['createdAt']),
      updatedAt: _parseDate(json['updatedAt']),
    );
  }

  static DateTime? _parseDate(dynamic value) {
    if (value is! String || value.trim().isEmpty) {
      return null;
    }

    return DateTime.tryParse(value);
  }

  static int _parseInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.toInt();
    }

    if (value is String) {
      return int.tryParse(value.trim()) ?? 0;
    }

    return 0;
  }
}

class PostCommentItem {
  const PostCommentItem({
    required this.id,
    required this.postId,
    required this.type,
    required this.userId,
    required this.agentId,
    required this.authorName,
    required this.authorAvatar,
    required this.content,
    required this.parentCommentId,
    required this.replyToUserId,
    required this.replyToAgentId,
    required this.replyToUserName,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String postId;
  final PostCommentType type;
  final String userId;
  final String agentId;
  final String authorName;
  final String authorAvatar;
  final String content;
  final String parentCommentId;
  final String replyToUserId;
  final String replyToAgentId;
  final String replyToUserName;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory PostCommentItem.fromJson(Map<String, dynamic> json) {
    return PostCommentItem(
      id: json['id'] as String? ?? '',
      postId: json['postId'] as String? ?? '',
      type: _parseCommentType(json['type']),
      userId: json['userId'] as String? ?? '',
      agentId: json['agentId'] as String? ?? '',
      authorName: json['authorName'] as String? ?? '',
      authorAvatar: json['authorAvatar'] as String? ?? '',
      content: json['content'] as String? ?? '',
      parentCommentId: json['parentCommentId'] as String? ?? '',
      replyToUserId: json['replyToUserId'] as String? ?? '',
      replyToAgentId: json['replyToAgentId'] as String? ?? '',
      replyToUserName: json['replyToUserName'] as String? ?? '',
      createdAt: PostItem._parseDate(json['createdAt']),
      updatedAt: PostItem._parseDate(json['updatedAt']),
    );
  }

  static PostCommentType _parseCommentType(dynamic value) {
    if (value == 'agent') {
      return PostCommentType.agent;
    }

    return PostCommentType.user;
  }
}
