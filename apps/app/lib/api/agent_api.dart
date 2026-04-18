import 'package:tianzhiling_app/api/api_client.dart';
import 'package:tianzhiling_app/models/agent_models.dart';

class AgentApi {
  static final ApiClient _client = ApiClient.instance;

  static Future<List<AgentSummary>> getAgents() async {
    final data = await _client.get('/api/agent');
    final rawItems = data['items'];

    if (rawItems is! List) {
      return const [];
    }

    return rawItems
        .whereType<Map>()
        .map((item) => AgentSummary.fromJson(item.cast<String, dynamic>()))
        .toList();
  }

  static Future<AgentSummary> getAgentDetail(String agentId) async {
    final data = await _client.get('/api/agent/$agentId');
    return AgentSummary.fromJson(data);
  }

  static Future<AgentSummary> updateAgentAvatar(
    String agentId,
    String avatar,
  ) async {
    final data = await _client.patch(
      '/api/agent/$agentId/avatar',
      body: <String, dynamic>{'avatar': avatar},
    );
    return AgentSummary.fromJson(data);
  }

  static Future<AgentSummary> updateAgentProfile(
    String agentId, {
    Map<String, dynamic>? body,
  }) async {
    final data = await _client.patch('/api/agent/$agentId', body: body);
    return AgentSummary.fromJson(data);
  }

  static Future<AgentSummary> createAgent({
    required String name,
    required int sex,
    required String iCallAgent,
    required String agentCallMe,
  }) async {
    final data = await _client.post(
      '/api/agent',
      body: <String, dynamic>{
        'name': name,
        'sex': sex,
        'iCallAgent': iCallAgent,
        'agentCallMe': agentCallMe,
      },
    );

    return AgentSummary.fromJson(data);
  }
}
