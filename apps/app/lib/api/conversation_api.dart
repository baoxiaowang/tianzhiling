import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/models/conversation_models.dart';

class ConversationApi {
  static final ApiClient _client = ApiClient.instance;

  static Future<List<ConversationSummary>> getConversations() async {
    final data = await _client.get('/api/conversation');
    final rawItems = data['items'];

    if (rawItems is! List) {
      return const [];
    }

    return rawItems
        .whereType<Map>()
        .map(
          (item) => ConversationSummary.fromJson(item.cast<String, dynamic>()),
        )
        .toList();
  }

  static Future<List<ConversationMessage>> getMessages(
    String conversationId,
  ) async {
    final data = await _client.get(
      '/api/conversation/$conversationId/messages',
    );
    final rawItems = data['items'];

    if (rawItems is! List) {
      return const [];
    }

    return rawItems
        .whereType<Map>()
        .map(
          (item) => ConversationMessage.fromJson(item.cast<String, dynamic>()),
        )
        .toList();
  }

  static Future<SendConversationMessageResult> sendMessage(
    String conversationId, {
    String? content,
    String type = 'text',
    String? mediaUrl,
    String? objectKey,
    String? mimeType,
    int? durationMs,
  }) async {
    final body = <String, dynamic>{'type': type};

    if (content != null && content.trim().isNotEmpty) {
      body['content'] = content;
    }
    if (mediaUrl != null && mediaUrl.trim().isNotEmpty) {
      body['mediaUrl'] = mediaUrl;
    }
    if (objectKey != null && objectKey.trim().isNotEmpty) {
      body['objectKey'] = objectKey;
    }
    if (mimeType != null && mimeType.trim().isNotEmpty) {
      body['mimeType'] = mimeType;
    }
    if (durationMs != null) {
      body['durationMs'] = durationMs;
    }

    final data = await _client.post(
      '/api/conversation/$conversationId/messages',
      body: body,
    );

    return SendConversationMessageResult.fromJson(data);
  }

  static Future<String> transcribeVoice(
    String conversationId, {
    String? mediaUrl,
    String? objectKey,
    String? mimeType,
  }) async {
    final body = <String, dynamic>{};

    if (mediaUrl != null && mediaUrl.trim().isNotEmpty) {
      body['mediaUrl'] = mediaUrl;
    }
    if (objectKey != null && objectKey.trim().isNotEmpty) {
      body['objectKey'] = objectKey;
    }
    if (mimeType != null && mimeType.trim().isNotEmpty) {
      body['mimeType'] = mimeType;
    }

    final data = await _client.post(
      '/api/conversation/$conversationId/voice-transcription',
      body: body,
    );

    final transcript = data['transcript'];
    if (transcript is String) {
      return transcript.trim();
    }

    return '';
  }
}
