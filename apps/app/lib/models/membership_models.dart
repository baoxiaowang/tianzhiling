class VipPlanBenefit {
  const VipPlanBenefit({required this.title, this.description});

  final String title;
  final String? description;

  factory VipPlanBenefit.fromJson(Map<String, dynamic> json) {
    return VipPlanBenefit(
      title: json['title'] as String? ?? '',
      description: json['description'] as String?,
    );
  }
}

class VipPlan {
  const VipPlan({
    required this.id,
    required this.code,
    required this.name,
    required this.description,
    required this.planGroup,
    required this.priceAmount,
    this.originalPriceAmount,
    this.currency = 'CNY',
    this.durationDays,
    this.lifetime = false,
    this.benefits = const [],
    this.couponGrantAmount,
    this.voicePackageId,
    this.voicePackageCode,
    this.voicePackageName,
    this.virtualPaymentProductId,
    this.upgradePayableAmount,
  });

  final String id;
  final String code;
  final String name;
  final String description;
  final String planGroup;
  final int priceAmount;
  final int? originalPriceAmount;
  final String currency;
  final int? durationDays;
  final bool lifetime;
  final List<VipPlanBenefit> benefits;
  final int? couponGrantAmount;
  final String? voicePackageId;
  final String? voicePackageCode;
  final String? voicePackageName;
  final String? virtualPaymentProductId;
  final int? upgradePayableAmount;

  String get priceLabel {
    final yuan = priceAmount / 100;
    return yuan == yuan.truncateToDouble() ? '¥${yuan.toInt()}' : '¥${yuan.toStringAsFixed(2)}';
  }

  String get dailyLabel {
    final days = lifetime ? 365 * 50 : durationDays;
    if (days == null || days <= 0) return '';
    final dailyPrice = priceAmount / 100 / days;
    final label = dailyPrice < 1
        ? dailyPrice.toStringAsFixed(2)
        : (dailyPrice.round()).toString();
    return '约¥$label/天';
  }

  String get durationLabel {
    if (lifetime) return '无限期';
    if (durationDays == null) return '';
    if (durationDays! >= 365) {
      final years = (durationDays! / 365).round();
      return years == 1 ? '一年' : '$years年';
    }
    return '$durationDays天';
  }

  factory VipPlan.fromJson(Map<String, dynamic> json) {
    final planGroup = json['planGroup'] as String? ?? '';
    return VipPlan(
      id: json['id'] as String? ?? '',
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      description: json['description'] as String? ?? '',
      planGroup: planGroup == 'voice' ? 'voice' : 'basic',
      priceAmount: _asInt(json['priceAmount']),
      originalPriceAmount: json['originalPriceAmount'] != null ? _asInt(json['originalPriceAmount']) : null,
      currency: json['currency'] as String? ?? 'CNY',
      durationDays: json['durationDays'] != null ? _asInt(json['durationDays']) : null,
      lifetime: json['lifetime'] == true,
      benefits: _parseBenefits(json['benefits']),
      couponGrantAmount: json['couponGrantAmount'] != null ? _asInt(json['couponGrantAmount']) : null,
      voicePackageId: json['voicePackageId'] as String?,
      voicePackageCode: json['voicePackageCode'] as String?,
      voicePackageName: json['voicePackageName'] as String?,
      virtualPaymentProductId: json['virtualPaymentProductId'] as String?,
      upgradePayableAmount: json['upgradePayableAmount'] != null ? _asInt(json['upgradePayableAmount']) : null,
    );
  }

  static int _asInt(dynamic value) {
    if (value is int) return value;
    if (value is double) return value.toInt();
    if (value is String) return int.tryParse(value.trim()) ?? 0;
    return 0;
  }

  static List<VipPlanBenefit> _parseBenefits(dynamic value) {
    if (value is! List) return const [];
    return value
        .whereType<Map<String, dynamic>>()
        .map((e) => VipPlanBenefit.fromJson(e))
        .toList();
  }
}

class UserMembership {
  const UserMembership({
    required this.id,
    required this.vipPlanId,
    required this.vipPlanCode,
    required this.status,
    this.startedAt,
    this.expiredAt,
    this.lifetime = false,
    this.plan,
  });

  final String id;
  final String vipPlanId;
  final String vipPlanCode;
  final String status;
  final DateTime? startedAt;
  final DateTime? expiredAt;
  final bool lifetime;
  final VipPlan? plan;

  int get remainingDays {
    if (lifetime) return 99999;
    if (expiredAt == null) return 0;
    final now = DateTime.now();
    if (expiredAt!.isBefore(now)) return 0;
    return expiredAt!.difference(now).inDays + 1;
  }

  factory UserMembership.fromJson(Map<String, dynamic> json) {
    return UserMembership(
      id: json['id'] as String? ?? '',
      vipPlanId: json['vipPlanId'] as String? ?? '',
      vipPlanCode: json['vipPlanCode'] as String? ?? '',
      status: json['status'] as String? ?? '',
      startedAt: _asDateTime(json['startedAt']),
      expiredAt: _asDateTime(json['expiredAt']),
      lifetime: json['lifetime'] == true,
      plan: json['plan'] != null ? VipPlan.fromJson(json['plan'] as Map<String, dynamic>) : null,
    );
  }

  static DateTime? _asDateTime(dynamic value) {
    if (value is String && value.isNotEmpty) {
      final d = DateTime.tryParse(value);
      if (d != null) return d;
    }
    return null;
  }
}

class ActivityStats {
  const ActivityStats({
    this.companionshipDays = 0,
    this.conversationCount = 0,
  });

  final int companionshipDays;
  final int conversationCount;

  factory ActivityStats.fromJson(Map<String, dynamic> json) {
    int safeInt(dynamic v) {
      if (v is int) return v;
      if (v is double) return v.toInt();
      if (v is String) return int.tryParse(v.trim()) ?? 0;
      return 0;
    }

    return ActivityStats(
      companionshipDays: safeInt(json['companionshipDays']).clamp(0, 999999),
      conversationCount: safeInt(json['conversationCount']).clamp(0, 999999),
    );
  }
}

class MembershipCenter {
  const MembershipCenter({
    required this.isVip,
    this.membership,
    this.plans = const [],
    this.serverTime,
    this.activityStats = const ActivityStats(),
  });

  final bool isVip;
  final UserMembership? membership;
  final List<VipPlan> plans;
  final DateTime? serverTime;
  final ActivityStats activityStats;

  List<VipPlan> get basicPlans => plans.where((p) => p.planGroup == 'basic').toList();
  List<VipPlan> get voicePlans => plans.where((p) => p.planGroup == 'voice').toList();
  bool get hasVoicePlans => voicePlans.isNotEmpty;
  bool get hasBasicPlans => basicPlans.isNotEmpty;

  Set<String> get availableGroups {
    final s = <String>{};
    if (hasBasicPlans) s.add('basic');
    if (hasVoicePlans) s.add('voice');
    return s;
  }

  factory MembershipCenter.fromJson(Map<String, dynamic> json) {
    final plans = (json['plans'] as List?)
        ?.whereType<Map<String, dynamic>>()
        .map((e) => VipPlan.fromJson(e))
        .toList() ?? const [];
    final activityStats = json['activityStats'] is Map
        ? ActivityStats.fromJson(json['activityStats'] as Map<String, dynamic>)
        : const ActivityStats();

    return MembershipCenter(
      isVip: json['isVip'] == true,
      membership: json['membership'] != null ? UserMembership.fromJson(json['membership'] as Map<String, dynamic>) : null,
      plans: plans,
      serverTime: json['serverTime'] != null ? DateTime.tryParse(json['serverTime'] as String) : null,
      activityStats: activityStats,
    );
  }
}
