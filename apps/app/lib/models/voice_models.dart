DateTime? _tryParseDate(dynamic v) {
  if (v is String && v.isNotEmpty) return DateTime.tryParse(v);
  return null;
}

class VoiceServiceMaterial {
  const VoiceServiceMaterial({
    required this.id, required this.name, required this.objectKey,
    this.publicUrl, this.durationSeconds, required this.createdAt,
  });
  final String id, name, objectKey;
  final String? publicUrl;
  final double? durationSeconds;
  final DateTime? createdAt;
  factory VoiceServiceMaterial.fromJson(Map<String, dynamic> json) => VoiceServiceMaterial(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    objectKey: json['objectKey'] as String? ?? '',
    publicUrl: json['publicUrl'] as String?,
    durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
    createdAt: _tryParseDate(json['createdAt']),
  );
}

class VoiceServiceClipQualityMetrics {
  final double durationSeconds, silenceRatio, clippingRatio;
  final double? rmsDb, peakDb, noiseFloorDb, signalToNoiseDb, volumeGainDb;
  final bool volumeAdjusted;
  const VoiceServiceClipQualityMetrics({
    required this.durationSeconds, required this.silenceRatio, required this.clippingRatio,
    this.rmsDb, this.peakDb, this.noiseFloorDb, this.signalToNoiseDb,
    this.volumeAdjusted = false, this.volumeGainDb,
  });
  factory VoiceServiceClipQualityMetrics.fromJson(Map<String, dynamic> json) => VoiceServiceClipQualityMetrics(
    durationSeconds: (json['durationSeconds'] as num?)?.toDouble() ?? 0,
    silenceRatio: (json['silenceRatio'] as num?)?.toDouble() ?? 0,
    clippingRatio: (json['clippingRatio'] as num?)?.toDouble() ?? 0,
    rmsDb: (json['rmsDb'] as num?)?.toDouble(),
    peakDb: (json['peakDb'] as num?)?.toDouble(),
    noiseFloorDb: (json['noiseFloorDb'] as num?)?.toDouble(),
    signalToNoiseDb: (json['signalToNoiseDb'] as num?)?.toDouble(),
    volumeAdjusted: json['volumeAdjusted'] as bool? ?? false,
    volumeGainDb: (json['volumeGainDb'] as num?)?.toDouble(),
  );
}

class VoiceServiceClipQualityIssue {
  final String code, severity, message;
  const VoiceServiceClipQualityIssue({required this.code, required this.severity, required this.message});
  factory VoiceServiceClipQualityIssue.fromJson(Map<String, dynamic> json) => VoiceServiceClipQualityIssue(
    code: json['code'] as String? ?? '',
    severity: json['severity'] as String? ?? 'warning',
    message: json['message'] as String? ?? '',
  );
}

class VoiceServiceReviewClip {
  final String id;
  final String? sourceMaterialId, sourceName, objectKey, publicUrl;
  final double? durationSeconds;
  final String? transcript, speakerId, qualityLabel;
  final double? qualityScore;
  final VoiceServiceClipQualityMetrics? qualityMetrics;
  final List<VoiceServiceClipQualityIssue> qualityIssues;
  final String reviewStatus;
  final String? rejectionReason;
  final String? recutStatus, recutInstruction;
  final DateTime? recutRequestedAt, recutStartedAt, recutCompletedAt;
  final String? recutFailureCode, recutFailureReason;
  final DateTime? createdAt, reviewedAt;
  const VoiceServiceReviewClip({
    required this.id,
    this.sourceMaterialId, this.sourceName, this.objectKey, this.publicUrl,
    this.durationSeconds, this.transcript, this.speakerId, this.qualityLabel,
    this.qualityScore, this.qualityMetrics,
    this.qualityIssues = const [],
    this.reviewStatus = 'pending', this.rejectionReason,
    this.recutStatus, this.recutInstruction,
    this.recutRequestedAt, this.recutStartedAt, this.recutCompletedAt,
    this.recutFailureCode, this.recutFailureReason,
    this.createdAt, this.reviewedAt,
  });
  factory VoiceServiceReviewClip.fromJson(Map<String, dynamic> json) {
    final issues = (json['qualityIssues'] as List?)
        ?.whereType<Map<String, dynamic>>()
        .map((e) => VoiceServiceClipQualityIssue.fromJson(e))
        .toList() ?? const [];
    return VoiceServiceReviewClip(
      id: json['id'] as String? ?? '',
      sourceMaterialId: json['sourceMaterialId'] as String?,
      sourceName: json['sourceName'] as String?,
      objectKey: json['objectKey'] as String?,
      publicUrl: json['publicUrl'] as String?,
      durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
      transcript: json['transcript'] as String?,
      speakerId: json['speakerId'] as String?,
      qualityLabel: json['qualityLabel'] as String?,
      qualityScore: (json['qualityScore'] as num?)?.toDouble(),
      qualityMetrics: json['qualityMetrics'] is Map ? VoiceServiceClipQualityMetrics.fromJson(json['qualityMetrics'] as Map<String, dynamic>) : null,
      qualityIssues: issues,
      reviewStatus: json['reviewStatus'] as String? ?? 'pending',
      rejectionReason: json['rejectionReason'] as String?,
      recutStatus: json['recutStatus'] as String?,
      recutInstruction: json['recutInstruction'] as String?,
      recutRequestedAt: _tryParseDate(json['recutRequestedAt']),
      recutStartedAt: _tryParseDate(json['recutStartedAt']),
      recutCompletedAt: _tryParseDate(json['recutCompletedAt']),
      recutFailureCode: json['recutFailureCode'] as String?,
      recutFailureReason: json['recutFailureReason'] as String?,
      createdAt: _tryParseDate(json['createdAt']),
      reviewedAt: _tryParseDate(json['reviewedAt']),
    );
  }
  bool get isRecutActive => recutStatus == 'queued' || recutStatus == 'processing';
  String get sourceLabel => sourceName?.isNotEmpty == true ? '来自：$sourceName' : '';
  String get metaText {
    final parts = <String>[];
    if (durationSeconds != null && durationSeconds! > 0) parts.add(VoiceServiceReviewClip._formatDuration(durationSeconds!));
    if (speakerId?.isNotEmpty == true) parts.add('说话人 $speakerId');
    if (qualityLabel?.isNotEmpty == true) parts.add(qualityLabel!);
    if (transcript?.isNotEmpty == true) parts.add(transcript!);
    return parts.join(' · ');
  }
  static String _formatDuration(double s) {
    final sec = s.round();
    final m = sec ~/ 60;
    final rem = sec % 60;
    return m > 0 ? '${m}分${rem}秒' : '${rem}秒';
  }
}

class VoiceServiceFilteredClip {
  final String id;
  final String? sourceMaterialId, sourceName;
  final double? durationSeconds;
  final String? transcript, speakerId;
  final VoiceServiceClipQualityMetrics? qualityMetrics;
  final List<VoiceServiceClipQualityIssue> qualityIssues;
  final DateTime? createdAt;
  const VoiceServiceFilteredClip({
    required this.id,
    this.sourceMaterialId, this.sourceName, this.durationSeconds,
    this.transcript, this.speakerId, this.qualityMetrics,
    this.qualityIssues = const [], this.createdAt,
  });
  factory VoiceServiceFilteredClip.fromJson(Map<String, dynamic> json) {
    final issues = (json['qualityIssues'] as List?)
        ?.whereType<Map<String, dynamic>>()
        .map((e) => VoiceServiceClipQualityIssue.fromJson(e))
        .toList() ?? const [];
    return VoiceServiceFilteredClip(
      id: json['id'] as String? ?? '',
      sourceMaterialId: json['sourceMaterialId'] as String?,
      sourceName: json['sourceName'] as String?,
      durationSeconds: (json['durationSeconds'] as num?)?.toDouble(),
      transcript: json['transcript'] as String?,
      speakerId: json['speakerId'] as String?,
      qualityMetrics: json['qualityMetrics'] is Map ? VoiceServiceClipQualityMetrics.fromJson(json['qualityMetrics'] as Map<String, dynamic>) : null,
      qualityIssues: issues,
      createdAt: _tryParseDate(json['createdAt']),
    );
  }
}

class VoiceServiceMessage {
  final String id, role, text;
  final DateTime? createdAt;
  const VoiceServiceMessage({required this.id, required this.role, required this.text, this.createdAt});
  factory VoiceServiceMessage.fromJson(Map<String, dynamic> json) => VoiceServiceMessage(
    id: json['id'] as String? ?? '',
    role: json['role'] as String? ?? '',
    text: json['text'] as String? ?? '',
    createdAt: _tryParseDate(json['createdAt']),
  );
}

class VoiceServiceSession {
  final String id;
  final String status;
  final String? processingMode;
  final List<VoiceServiceMaterial> materials;
  final List<VoiceServiceReviewClip> reviewClips;
  final List<VoiceServiceFilteredClip> filteredClips;
  final List<VoiceServiceMessage> messages;
  final String? voiceTimbreId, selectedAgentId, previewAudioUrl;
  final String? failureReason, failureStage;
  final String? voiceAccessSource, voiceBindingStatus;
  final List<String> voiceBoundAgentIds;
  final bool voiceAccessEligible;
  final String? dataDeletionStatus, dataDeletionFailureReason;
  final DateTime? createdAt, updatedAt;
  const VoiceServiceSession({
    required this.id, required this.status,
    this.processingMode,
    this.materials = const [],
    this.reviewClips = const [],
    this.filteredClips = const [],
    this.messages = const [],
    this.voiceTimbreId, this.selectedAgentId, this.previewAudioUrl,
    this.failureReason, this.failureStage,
    this.voiceAccessSource, this.voiceBindingStatus,
    this.voiceBoundAgentIds = const [],
    this.voiceAccessEligible = false,
    this.dataDeletionStatus, this.dataDeletionFailureReason,
    this.createdAt, this.updatedAt,
  });
  factory VoiceServiceSession.fromJson(Map<String, dynamic> json) {
    final materials = (json['materials'] as List?)
        ?.whereType<Map<String, dynamic>>().map((e) => VoiceServiceMaterial.fromJson(e)).toList() ?? const [];
    final reviewClips = (json['reviewClips'] as List?)
        ?.whereType<Map<String, dynamic>>().map((e) => VoiceServiceReviewClip.fromJson(e)).toList() ?? const [];
    final filteredClips = (json['filteredClips'] as List?)
        ?.whereType<Map<String, dynamic>>().map((e) => VoiceServiceFilteredClip.fromJson(e)).toList() ?? const [];
    final messages = (json['messages'] as List?)
        ?.whereType<Map<String, dynamic>>().map((e) => VoiceServiceMessage.fromJson(e)).toList() ?? const [];
    final boundIds = (json['voiceBoundAgentIds'] as List?)?.whereType<String>().toList() ?? const [];
    return VoiceServiceSession(
      id: json['id'] as String? ?? '',
      status: json['status'] as String? ?? '',
      processingMode: json['processingMode'] as String?,
      materials: materials, reviewClips: reviewClips, filteredClips: filteredClips, messages: messages,
      voiceTimbreId: json['voiceTimbreId'] as String?,
      selectedAgentId: json['selectedAgentId'] as String?,
      previewAudioUrl: json['previewAudioUrl'] as String?,
      failureReason: json['failureReason'] as String?,
      failureStage: json['failureStage'] as String?,
      voiceAccessSource: json['voiceAccessSource'] as String?,
      voiceBindingStatus: json['voiceBindingStatus'] as String?,
      voiceBoundAgentIds: boundIds,
      voiceAccessEligible: json['voiceAccessEligible'] as bool? ?? false,
      dataDeletionStatus: json['dataDeletionStatus'] as String?,
      dataDeletionFailureReason: json['dataDeletionFailureReason'] as String?,
      createdAt: _tryParseDate(json['createdAt']),
      updatedAt: _tryParseDate(json['updatedAt']),
    );
  }
  bool get hasData => materials.isNotEmpty || reviewClips.isNotEmpty || filteredClips.isNotEmpty || voiceTimbreId != null || previewAudioUrl != null;
  int get acceptedClipCount => reviewClips.where((c) => c.reviewStatus == 'accepted').length;
  int get reviewedClipCount => reviewClips.where((c) => c.reviewStatus != 'pending').length;
  double get acceptedDurationSeconds {
    double total = 0;
    for (final c in reviewClips) {
      if (c.reviewStatus == 'accepted' && c.durationSeconds != null) total += c.durationSeconds!;
    }
    return total;
  }
  static const maxTrainingSeconds = 60;
  bool get wouldExceedSelectionLimit => acceptedDurationSeconds > maxTrainingSeconds;
}

class AgentSummary {
  final String id, name;
  final String? avatar;
  const AgentSummary({required this.id, required this.name, this.avatar});
  factory AgentSummary.fromJson(Map<String, dynamic> json) => AgentSummary(
    id: json['id'] as String? ?? '',
    name: json['name'] as String? ?? '',
    avatar: json['avatar'] as String?,
  );
}

class VoiceTimbreRecord {
  const VoiceTimbreRecord({
    required this.id, required this.name, this.previewAudioUrl,
    this.retentionStatus = 'active', this.retentionMessage = '',
    this.bindings = const [], this.createdAt,
  });
  final String id, name;
  final String? previewAudioUrl;
  final String retentionStatus, retentionMessage;
  final List<VoiceTimbreBinding> bindings;
  final DateTime? createdAt;

  String get bindingNames => bindings.map((b) => b.agentName).join('、');

  factory VoiceTimbreRecord.fromJson(Map<String, dynamic> json) {
    final bindings = (json['bindings'] as List?)
        ?.whereType<Map<String, dynamic>>()
        .map((e) => VoiceTimbreBinding.fromJson(e))
        .toList() ?? const [];
    return VoiceTimbreRecord(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      previewAudioUrl: json['previewAudioUrl'] as String?,
      retentionStatus: json['retentionStatus'] as String? ?? 'active',
      retentionMessage: json['retentionMessage'] as String? ?? '',
      bindings: bindings,
      createdAt: _tryParseDate(json['createdAt']),
    );
  }
}

class VoiceTimbreBinding {
  const VoiceTimbreBinding({required this.agentId, required this.agentName});
  final String agentId, agentName;
  factory VoiceTimbreBinding.fromJson(Map<String, dynamic> json) =>
    VoiceTimbreBinding(agentId: json['agentId'] as String? ?? '', agentName: json['agentName'] as String? ?? '');
}

class RetentionPolicy {
  final String summary, deletionNotice;
  const RetentionPolicy({required this.summary, required this.deletionNotice});
  factory RetentionPolicy.fromJson(Map<String, dynamic> json) =>
    RetentionPolicy(summary: json['summary'] as String? ?? '', deletionNotice: json['deletionNotice'] as String? ?? '');
}

class VoiceTimbreLibrary {
  final List<VoiceTimbreRecord> items;
  final RetentionPolicy? retentionPolicy;
  const VoiceTimbreLibrary({this.items = const [], this.retentionPolicy});
  factory VoiceTimbreLibrary.fromJson(Map<String, dynamic> json) {
    final items = (json['items'] as List?)?.whereType<Map<String, dynamic>>().map((e) => VoiceTimbreRecord.fromJson(e)).toList() ?? [];
    return VoiceTimbreLibrary(
      items: items,
      retentionPolicy: json['retentionPolicy'] is Map ? RetentionPolicy.fromJson(json['retentionPolicy'] as Map<String, dynamic>) : null,
    );
  }
}
