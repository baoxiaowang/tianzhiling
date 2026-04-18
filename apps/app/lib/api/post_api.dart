import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/models/post_models.dart';

class PostApi {
  static final ApiClient _client = ApiClient.instance;

  static Future<List<PostItem>> getPosts() async {
    final data = await _client.get('/api/post');
    final rawItems = data['items'];

    if (rawItems is! List) {
      return const [];
    }

    return rawItems
        .whereType<Map>()
        .map((item) => PostItem.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  static Future<PostItem> getPostDetail(String postId) async {
    final data = await _client.get('/api/post/$postId');
    return PostItem.fromJson(data);
  }

  static Future<PostCommentNotificationSummary>
  getCommentNotificationSummary() async {
    final data = await _client.get('/api/post/comment-notifications/summary');
    return PostCommentNotificationSummary.fromJson(data);
  }

  static Future<void> markCommentNotificationsRead(String postId) async {
    await _client.post('/api/post/$postId/comment-notifications/read');
  }

  static Future<PostItem> createPost({
    required String content,
    required List<String> images,
    List<String> remindAgentIds = const <String>[],
  }) async {
    final data = await _client.post(
      '/api/post',
      body: <String, dynamic>{
        'content': content,
        'images': images,
        'remindAgentIds': remindAgentIds,
      },
    );

    return PostItem.fromJson(data);
  }

  static Future<List<PostCommentItem>> getComments(String postId) async {
    final data = await _client.get('/api/post/$postId/comments');
    final rawItems = data['items'];

    if (rawItems is! List) {
      return const [];
    }

    return rawItems
        .whereType<Map>()
        .map((item) => PostCommentItem.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  static Future<PostCommentItem> createComment(
    String postId, {
    required String content,
    String? replyToCommentId,
  }) async {
    final data = await _client.post(
      '/api/post/$postId/comments',
      body: <String, dynamic>{
        'content': content,
        if (replyToCommentId != null && replyToCommentId.trim().isNotEmpty)
          'replyToCommentId': replyToCommentId.trim(),
      },
    );

    return PostCommentItem.fromJson(data);
  }
}
