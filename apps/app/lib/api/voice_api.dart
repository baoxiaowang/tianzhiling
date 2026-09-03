import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/models/voice_models.dart';

class VoiceApi {
  static final _c = ApiClient.instance;

  // Session
  static Future<VoiceServiceSession?> getCurrentSession() async {
    final d = await _c.get('/api/voice-services/current');
    final session = d['session'];
    if (session is Map<String, dynamic>) return VoiceServiceSession.fromJson(session);
    return null;
  }

  static Future<VoiceServiceSession> startSession({String? agentId}) async {
    final d = await _c.post('/api/voice-services/start', body: {if (agentId != null) 'agentId': agentId});
    return VoiceServiceSession.fromJson(d);
  }

  // Materials
  static Future<VoiceServiceSession> addMaterials(List<Map<String, dynamic>> materials) async {
    final d = await _c.post('/api/voice-services/materials', body: {'materials': materials});
    return VoiceServiceSession.fromJson(d);
  }

  static Future<VoiceServiceSession> removeMaterial(String sessionId, String materialId) async {
    final d = await _c.delete('/api/voice-services/$sessionId/materials/$materialId');
    return VoiceServiceSession.fromJson(d);
  }

  static Future<VoiceServiceSession> submitMaterials(String sessionId, String processingMode) async {
    final d = await _c.post('/api/voice-services/$sessionId/submit', body: {'processingMode': processingMode});
    return VoiceServiceSession.fromJson(d);
  }

  // Review
  static Future<VoiceServiceSession> reviewClip(String sessionId, String clipId, String reviewStatus, {String? rejectionReason}) async {
    final body = <String, dynamic>{'reviewStatus': reviewStatus};
    if (rejectionReason != null) body['rejectionReason'] = rejectionReason;
    final d = await _c.patch('/api/voice-services/$sessionId/clips/$clipId', body: body);
    return VoiceServiceSession.fromJson(d);
  }

  static Future<VoiceServiceSession> recutClip(String sessionId, String clipId, String instruction) async {
    final d = await _c.post('/api/voice-services/$sessionId/clips/$clipId/recut', body: {'instruction': instruction});
    return VoiceServiceSession.fromJson(d);
  }

  // Navigation
  static Future<VoiceServiceSession> returnToMaterials(String sessionId) async {
    final d = await _c.post('/api/voice-services/$sessionId/back-to-materials');
    return VoiceServiceSession.fromJson(d);
  }

  static Future<VoiceServiceSession> returnToReview(String sessionId) async {
    final d = await _c.post('/api/voice-services/$sessionId/back-to-review');
    return VoiceServiceSession.fromJson(d);
  }

  // Training
  static Future<VoiceServiceSession> startTraining(String sessionId) async {
    final d = await _c.post('/api/voice-services/$sessionId/train');
    return VoiceServiceSession.fromJson(d);
  }

  // Agent selection
  static Future<VoiceServiceSession> selectAgent(String sessionId, String agentId) async {
    final d = await _c.patch('/api/voice-services/$sessionId/agent', body: {'agentId': agentId});
    return VoiceServiceSession.fromJson(d);
  }

  // Agents list
  static Future<List<AgentSummary>> getAgents() async {
    final d = await _c.get('/api/agents');
    final items = d['items'] as List? ?? (d['agents'] as List? ?? []);
    return items.whereType<Map<String, dynamic>>().map((e) => AgentSummary.fromJson(e)).toList();
  }

  // Data deletion
  static Future<VoiceServiceSession> deleteAllVoiceData(String sessionId) async {
    final d = await _c.delete('/api/voice-services/$sessionId/data');
    return VoiceServiceSession.fromJson(d);
  }

  // Messenger chat
  static Future<VoiceServiceSession> sendMessage(String sessionId, String text) async {
    final d = await _c.post('/api/voice-services/$sessionId/messages', body: {'text': text});
    return VoiceServiceSession.fromJson(d);
  }

  // Timbres
  static Future<VoiceTimbreLibrary> getTimbres() async {
    final d = await _c.get('/api/voice-services/timbres');
    return VoiceTimbreLibrary.fromJson(d);
  }

  static Future<VoiceTimbreRecord> renameTimbre(String timbreId, String name) async {
    final d = await _c.patch('/api/voice-services/timbres/$timbreId', body: {'name': name});
    return VoiceTimbreRecord.fromJson(d);
  }

  static Future<Map<String, dynamic>> deleteTimbre(String timbreId) async {
    return _c.patch('/api/voice-services/timbres/$timbreId', body: {'deletionStatus': 'requested'});
  }

  // Agent voice model center
  static Future<Map<String, dynamic>> getAgentVoiceModelCenter(String agentId) async {
    return _c.get('/api/voice-services/agents/$agentId/timbres');
  }

  static Future<Map<String, dynamic>> selectAgentVoiceTimbre(String agentId, String timbreId) async {
    return _c.patch('/api/voice-services/agents/$agentId/timbre', body: {'timbreId': timbreId});
  }
}
