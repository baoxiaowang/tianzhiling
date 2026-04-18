class AgentSummary {
  const AgentSummary({
    required this.id,
    required this.name,
    required this.avatar,
    required this.sex,
    required this.agentCallMe,
    required this.iCallAgent,
    required this.birthday,
    required this.deathDate,
    required this.description,
    required this.status,
    required this.createdAt,
    required this.updatedAt,
  });

  final String id;
  final String name;
  final String avatar;
  final int sex;
  final String agentCallMe;
  final String iCallAgent;
  final DateTime? birthday;
  final DateTime? deathDate;
  final String description;
  final int status;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory AgentSummary.fromJson(Map<String, dynamic> json) {
    return AgentSummary(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '',
      avatar: json['avatar'] as String? ?? '',
      sex: json['sex'] as int? ?? 0,
      agentCallMe: json['agentCallMe'] as String? ?? '',
      iCallAgent: json['iCallAgent'] as String? ?? '',
      birthday: _parseDate(json['birthday']),
      deathDate: _parseDate(json['deathDate']),
      description: json['description'] as String? ?? '',
      status: json['status'] as int? ?? 0,
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
}
