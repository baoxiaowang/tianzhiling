class ConversationSummary {
  const ConversationSummary({
    required this.id,
    required this.agentId,
    required this.agentName,
    required this.agentAvatar,
    required this.agentSex,
    required this.agentCallMe,
    required this.iCallAgent,
    required this.preview,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String agentId;
  final String agentName;
  final String agentAvatar;
  final int agentSex;
  final String agentCallMe;
  final String iCallAgent;
  final String preview;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ConversationSummary.fromJson(Map<String, dynamic> json) {
    return ConversationSummary(
      id: _readString(json['id']),
      agentId: _readString(json['agentId']),
      agentName: _readString(json['agentName']),
      agentAvatar: _readString(json['agentAvatar']),
      agentSex: _readInt(json['agentSex']) ?? 0,
      agentCallMe: _readString(json['agentCallMe']),
      iCallAgent: _readString(json['iCallAgent']),
      preview: _readString(json['preview']),
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

  static String _readString(dynamic value) {
    if (value == null) {
      return '';
    }

    if (value is String) {
      return value;
    }

    if (value is num || value is bool) {
      return '$value';
    }

    return '';
  }

  static int? _readInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.round();
    }

    if (value is String) {
      return int.tryParse(value.trim());
    }

    return null;
  }

  static Map<String, dynamic> normalizeJsonMap(dynamic value) {
    if (value is Map<String, dynamic>) {
      return value;
    }

    if (value is Map) {
      final normalized = <String, dynamic>{};
      for (final entry in value.entries) {
        final key = entry.key;
        if (key is String && key.isNotEmpty) {
          normalized[key] = entry.value;
        }
      }
      return normalized;
    }

    return const <String, dynamic>{};
  }
}

class ConversationMessage {
  const ConversationMessage({
    required this.id,
    required this.conversationId,
    required this.role,
    required this.type,
    required this.content,
    required this.segments,
    required this.status,
    this.voice,
    this.image,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String conversationId;
  final String role;
  final String type;
  final String content;
  final List<String> segments;
  final String status;
  final ConversationVoicePayload? voice;
  final ConversationImagePayload? image;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  bool get isUser => role == 'user';

  bool get isAssistant => role == 'assistant';

  bool get isText => type == 'text';

  bool get isVoice => type == 'voice';

  bool get isImage => type == 'image';

  bool get isSending => status == 'sending';

  bool get isFailed => status == 'failed';

  factory ConversationMessage.fromJson(Map<String, dynamic> json) {
    final type = ConversationSummary._readString(json['type']).isEmpty
        ? 'text'
        : ConversationSummary._readString(json['type']);

    return ConversationMessage(
      id: ConversationSummary._readString(json['id']),
      conversationId: ConversationSummary._readString(json['conversationId']),
      role: ConversationSummary._readString(json['role']).isEmpty
          ? 'assistant'
          : ConversationSummary._readString(json['role']),
      type: type,
      content: ConversationSummary._readString(json['content']),
      segments: type == 'voice' || type == 'image'
          ? const <String>[]
          : _parseSegments(json['segments'], json['content']),
      status: ConversationSummary._readString(json['status']).isEmpty
          ? 'sent'
          : ConversationSummary._readString(json['status']),
      voice: ConversationVoicePayload.fromJsonOrNull(json['voice']),
      image: ConversationImagePayload.fromJsonOrNull(json['image']),
      createdAt: ConversationSummary._parseDate(json['createdAt']),
      updatedAt: ConversationSummary._parseDate(json['updatedAt']),
    );
  }

  ConversationMessage copyWith({
    String? id,
    String? conversationId,
    String? role,
    String? type,
    String? content,
    List<String>? segments,
    String? status,
    ConversationVoicePayload? voice,
    ConversationImagePayload? image,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) {
    return ConversationMessage(
      id: id ?? this.id,
      conversationId: conversationId ?? this.conversationId,
      role: role ?? this.role,
      type: type ?? this.type,
      content: content ?? this.content,
      segments: segments ?? this.segments,
      status: status ?? this.status,
      voice: voice ?? this.voice,
      image: image ?? this.image,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  static List<String> _parseSegments(dynamic value, dynamic rawContent) {
    if (value is List) {
      final segments = value
          .whereType<String>()
          .map((item) => item.trim())
          .where((item) => item.isNotEmpty)
          .toList();
      if (segments.isNotEmpty) {
        return segments;
      }
    }

    final content = rawContent is String ? rawContent.trim() : '';
    if (content.isEmpty) {
      return const [];
    }

    final segments = content
        .split('</fenge>')
        .map((item) => item.trim())
        .where((item) => item.isNotEmpty)
        .toList();
    return segments.isNotEmpty ? segments : <String>[content];
  }
}

class SendConversationMessageResult {
  const SendConversationMessageResult({
    required this.userMessage,
    this.assistantMessage,
  });

  final ConversationMessage userMessage;
  final ConversationMessage? assistantMessage;

  factory SendConversationMessageResult.fromJson(Map<String, dynamic> json) {
    final userMessage = ConversationSummary.normalizeJsonMap(
      json['userMessage'],
    );
    final assistantMessage = ConversationSummary.normalizeJsonMap(
      json['assistantMessage'],
    );

    return SendConversationMessageResult(
      userMessage: ConversationMessage.fromJson(userMessage),
      assistantMessage: assistantMessage.isNotEmpty
          ? ConversationMessage.fromJson(assistantMessage)
          : null,
    );
  }
}

class ConversationVoicePayload {
  const ConversationVoicePayload({
    this.objectKey,
    this.url,
    this.mimeType,
    this.durationMs,
    this.transcript,
  });

  final String? objectKey;
  final String? url;
  final String? mimeType;
  final int? durationMs;
  final String? transcript;

  int get durationSeconds {
    final value = durationMs;
    if (value == null || value <= 0) {
      return 0;
    }

    return (value / 1000).round().clamp(1, 60 * 60);
  }

  static ConversationVoicePayload? fromJsonOrNull(dynamic value) {
    final json = ConversationSummary.normalizeJsonMap(value);
    if (json.isEmpty) {
      return null;
    }

    final objectKey = ConversationSummary._readString(json['objectKey']);
    final url = ConversationSummary._readString(json['url']);
    final mimeType = ConversationSummary._readString(json['mimeType']);
    final durationMs = _parseInt(json['durationMs']);
    final transcript = ConversationSummary._readString(json['transcript']);

    if (objectKey.isEmpty &&
        url.isEmpty &&
        mimeType.isEmpty &&
        durationMs == null &&
        transcript.isEmpty) {
      return null;
    }

    return ConversationVoicePayload(
      objectKey: objectKey.isEmpty ? null : objectKey,
      url: url.isEmpty ? null : url,
      mimeType: mimeType.isEmpty ? null : mimeType,
      durationMs: durationMs,
      transcript: transcript.isEmpty ? null : transcript,
    );
  }

  static int? _parseInt(dynamic value) {
    if (value is int) {
      return value;
    }

    if (value is num) {
      return value.round();
    }

    return null;
  }
}

class ConversationImagePayload {
  const ConversationImagePayload({
    this.objectKey,
    this.url,
    this.mimeType,
    this.analysis,
  });

  final String? objectKey;
  final String? url;
  final String? mimeType;
  final String? analysis;

  static ConversationImagePayload? fromJsonOrNull(dynamic value) {
    final json = ConversationSummary.normalizeJsonMap(value);
    if (json.isEmpty) {
      return null;
    }

    final objectKey = ConversationSummary._readString(json['objectKey']);
    final url = ConversationSummary._readString(json['url']);
    final mimeType = ConversationSummary._readString(json['mimeType']);
    final analysis = ConversationSummary._readString(json['analysis']);

    if (objectKey.isEmpty &&
        url.isEmpty &&
        mimeType.isEmpty &&
        analysis.isEmpty) {
      return null;
    }

    return ConversationImagePayload(
      objectKey: objectKey.isEmpty ? null : objectKey,
      url: url.isEmpty ? null : url,
      mimeType: mimeType.isEmpty ? null : mimeType,
      analysis: analysis.isEmpty ? null : analysis,
    );
  }
}
