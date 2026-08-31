import 'package:flutter/cupertino.dart';
import '../config/brand_config.dart';
import 'package:flutter/material.dart';
import 'package:tianzhiling_app/api/membership_api.dart';
import 'package:tianzhiling_app/models/membership_models.dart';

class VipCenterPage extends StatefulWidget {
  const VipCenterPage({super.key});

  static const String routeName = '/vip-center';

  @override
  State<VipCenterPage> createState() => _VipCenterPageState();
}

class _VipCenterPageState extends State<VipCenterPage> {
  bool _isLoading = true;
  String? _error;
  MembershipCenter? _center;
  String? _selectedPlanId;
  String _selectedPlanGroup = 'basic';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() { _isLoading = true; _error = null; });
    try {
      final center = await MembershipApi.getPurchaseCenter();
      if (!mounted) return;
      setState(() {
        _center = center;
        _isLoading = false;
        if (center.plans.isNotEmpty && _selectedPlanId == null) {
          final dp = _findDefaultPlan(center);
          _selectedPlanId = dp?.id;
          _selectedPlanGroup = dp?.planGroup ?? 'basic';
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() { _error = e.toString(); _isLoading = false; });
    }
  }

  VipPlan? _findDefaultPlan(MembershipCenter c) {
    final basic = c.basicPlans..sort((a, b) => (a.durationDays ?? 0).compareTo(b.durationDays ?? 0));
    final oneYear = basic.where((p) => !p.lifetime).toList();
    if (oneYear.isNotEmpty) return oneYear.first;
    if (basic.isNotEmpty) return basic.first;
    return c.plans.isNotEmpty ? c.plans.first : null;
  }

  VipPlan? get _sel { if (_selectedPlanId == null || _center == null) return null; return _center!.plans.where((p) => p.id == _selectedPlanId).firstOrNull; }

  List<VipPlan> get _gp => _center == null ? const [] : _center!.plans.where((p) => p.planGroup == _selectedPlanGroup).toList()..sort((a, b) {
    if (a.lifetime && !b.lifetime) return 1; if (!a.lifetime && b.lifetime) return -1;
    return (a.durationDays ?? 0).compareTo(b.durationDays ?? 0);
  });

  Map<String, List<VipPlan>> get _dg { final m = <String, List<VipPlan>>{}; for (final p in _gp) { m.putIfAbsent(p.durationLabel, () => []).add(p); } return m; }

  void _selg(String g) {
    final ps = _center!.plans.where((p) => p.planGroup == g).toList()..sort((a, b) => (a.durationDays ?? 0).compareTo(b.durationDays ?? 0));
    if (ps.isEmpty) return;
    setState(() { _selectedPlanGroup = g; _selectedPlanId = ps.first.id; });
  }

  void _selp(VipPlan p) => setState(() => _selectedPlanId = p.id);
  bool get _hb => _center?.hasBasicPlans ?? false;
  bool get _hv => _center?.hasVoicePlans ?? false;

  @override
  Widget build(BuildContext context) {
    final body = _isLoading ? _buildLoading() : _error != null ? _buildError() : _center == null ? _buildEmpty() : _center!.isVip ? _buildMemberView() : _buildPurchaseView();
    return Scaffold(
      backgroundColor: const Color(0xFFF6F6F6),
      body: SafeArea(child: Column(children: [_buildNavBar(), Expanded(child: body)])),
    );
  }

  Widget _buildNavBar() => SizedBox(height: 44, child: Padding(
    padding: const EdgeInsets.fromLTRB(12, 0, 7, 0),
    child: Row(children: [
      SizedBox(width: 87, child: Align(alignment: Alignment.centerLeft, child: CupertinoButton(padding: const EdgeInsets.all(6), minimumSize: Size.zero, onPressed: () => Navigator.of(context).maybePop(), child: const Icon(CupertinoIcons.back, size: 20, color: Color(0xFF111111))))),
      const Expanded(child: Text('会员中心', textAlign: TextAlign.center, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF111111)))),
      const SizedBox(width: 87),
    ])));

  Widget _buildLoading() => const Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Color(0xFFECB872))),
    SizedBox(height: 10), Text('正在加载会员信息...', style: TextStyle(color: Color(0xFF8A8F98), fontSize: 14)),
  ]));

  Widget _buildError() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Text('会员信息加载失败', style: TextStyle(color: Color(0xFF111111), fontSize: 16, fontWeight: FontWeight.w600)),
    const SizedBox(height: 4), Text(_error ?? '', style: const TextStyle(color: Color(0xFF8A8F98), fontSize: 14)),
    const SizedBox(height: 16),
    CupertinoButton(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8), color: const Color(0xFF111111), borderRadius: BorderRadius.circular(12), onPressed: _load, child: const Text('重试', style: TextStyle(fontSize: 14, color: Colors.white))),
  ]));

  Widget _buildEmpty() => Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
    const Text('暂无可用套餐', style: TextStyle(color: Color(0xFF8A8F98), fontSize: 14)),
    const SizedBox(height: 16),
    CupertinoButton(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 8), color: const Color(0xFF111111), borderRadius: BorderRadius.circular(12), onPressed: _load, child: const Text('重试', style: TextStyle(fontSize: 14, color: Colors.white))),
  ]));

  // ============ Purchase View ============
  Widget _buildPurchaseView() => SingleChildScrollView(padding: const EdgeInsets.fromLTRB(12, 4, 12, 0), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    const Padding(padding: EdgeInsets.only(bottom: 18), child: Row(children: [Text('✦', style: TextStyle(color: Color(0xFFA78BFA), fontSize: 24)), SizedBox(width: 8), Text('${BrandConfig.name}会一直在', style: TextStyle(color: Color(0xFF8C8C8C), fontSize: 15, fontWeight: FontWeight.w600))])),
    if (_hb || _hv) ...[
      if (_hb) _buildPGCard('basic', '基础版', ['无限聊天', '记忆唤醒', '云端共享'], const Color(0xFFFFF3E0), const Color(0xFFFFE0C2), const Color(0xFFFF8C42)),
      if (_hb && _hv) const SizedBox(height: 12),
      if (_hv) _buildPGCard('voice', '声音版', ['人工复刻音色，请主动添加客服微信'], const Color(0xFFF3E8FF), const Color(0xFFE8D5FF), const Color(0xFFA78BFA), warning: '如果没有声音素材或方言口音较重，请勿购买'),
    ],
    if (_gp.length > 1) ...[const SizedBox(height: 16), _buildDurSec()],
    const SizedBox(height: 16),
    Container(padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), boxShadow: const [BoxShadow(color: Color(0x0B000000), blurRadius: 14, offset: Offset(0, 2))]), child: const Row(children: [Text('◆', style: TextStyle(color: Color(0xFF9B7ED8), fontSize: 16)), SizedBox(width: 12), Text('安全支付', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF666666))), SizedBox(width: 12), Text('|', style: TextStyle(color: Color(0xFFE0E0E0))), SizedBox(width: 12), Text('7天无理由退款', style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF666666)))])),
    const SizedBox(height: 14),
    const Center(child: Text('开通即表示同意《${BrandConfig.name}用户服务协议》及《隐私政策》', textAlign: TextAlign.center, style: TextStyle(fontSize: 12, color: Color(0xFF999999)))),
    const SizedBox(height: 120),
  ]));

  Widget _buildPGCard(String g, String title, List<String> features, Color cardBg, Color iconBg, Color accent, {String? warning}) {
    final sel = _selectedPlanGroup == g;
    final ps = _center!.plans.where((p) => p.planGroup == g).toList()..sort((a, b) => (a.durationDays ?? 0).compareTo(b.durationDays ?? 0));
    final dp = sel && _sel != null && _sel!.planGroup == g ? _sel! : ps.firstOrNull;
    final price = dp != null ? (dp.priceAmount / 100).toStringAsFixed(0) : '--';
    final desc = g == 'basic' ? (_center!.basicPlans.any((p) => p.lifetime) ? '余生很长，把想说的话慢慢说完' : '从日常聊天再次靠近') : '让熟悉的声音一直在身边';

    return GestureDetector(
      onTap: () => _selg(g),
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: sel ? accent : Colors.transparent, width: 2), boxShadow: [BoxShadow(color: sel ? accent.withValues(alpha: 0.13) : const Color(0x0B000000), blurRadius: sel ? 18 : 14, offset: Offset(0, sel ? 4.0 : 2.0))]),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Container(width: 56, height: 56, decoration: BoxDecoration(shape: BoxShape.circle, color: iconBg, boxShadow: [BoxShadow(color: accent.withValues(alpha: 0.15), blurRadius: 12, offset: const Offset(0, 4))]), child: Center(child: g == 'basic' ? Container(width: 38, height: 38, decoration: const BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: [Color(0xFFFFD54F), Color(0xFFFFB300)])), child: const Center(child: Text('★', style: TextStyle(color: Colors.white, fontSize: 23)))) : _VoiceIcon(color: accent))),
            const SizedBox(width: 12),
            Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(title, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, color: Color(0xFF1A1A1A))), const SizedBox(height: 6), Text(desc, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF8C8C8C)))])),
            Text(price, style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: accent)),
            Text('起', style: TextStyle(fontSize: 13, color: accent)),
          ]),
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: features.map((f) => Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5), decoration: BoxDecoration(color: const Color(0xFFF7F7F7), borderRadius: BorderRadius.circular(9)), child: Text('✦ $f', style: const TextStyle(fontSize: 12, color: Color(0xFF666666))))).toList()),
          if (warning != null) ...[const SizedBox(height: 6), Text(warning, style: const TextStyle(fontSize: 12, color: Color(0xFFEF5350)))],
        ]),
      ),
    );
  }

  Widget _buildDurSec() {
    final keys = _dg.keys.toList();
    return Container(padding: const EdgeInsets.fromLTRB(16, 14, 16, 16), decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), boxShadow: const [BoxShadow(color: Color(0x0B000000), blurRadius: 14, offset: Offset(0, 2))]), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      const Row(children: [Text('选择陪伴时长', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF1A1A1A))), SizedBox(width: 8), _Chip(text: '购买时长越长越划算')]),
      const SizedBox(height: 10),
      GridView.count(crossAxisCount: keys.length >= 3 ? 3 : 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 10, crossAxisSpacing: 10, childAspectRatio: 1.1, children: keys.map((k) {
        final ps = _dg[k]!; final p = ps.first; final sel = _selectedPlanId == p.id;
        final badge = p.lifetime ? '超值' : ((p.durationDays ?? 0) >= 365 * 3 ? '推荐' : '');
        final badgeColor = p.lifetime ? const Color(0xFFFF6B9D) : const Color(0xFFFF8C42);
        return GestureDetector(onTap: () => _selp(p), child: Container(
          decoration: BoxDecoration(color: sel ? const Color(0xFFFFF8F3) : Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: sel ? const Color(0xFFFF8C42) : const Color(0xFFF0F0F0), width: sel ? 1.5 : 1), boxShadow: sel ? [BoxShadow(color: const Color(0xFFFF8C42).withValues(alpha: 0.2), blurRadius: 12, offset: const Offset(0, 2))] : null),
          child: Stack(children: [
            Center(child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [Text(k, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800, color: Color(0xFF1A1A1A))), const SizedBox(height: 6), Text(p.dailyLabel, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Color(0xFFFF7D3D)))])),
            if (badge.isNotEmpty) Positioned(top: -1, right: -1, child: Container(padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2), decoration: BoxDecoration(color: badgeColor, borderRadius: const BorderRadius.only(topRight: Radius.circular(10), bottomLeft: Radius.circular(10))), child: Text(badge, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white)))),
          ]),
        ));
      }).toList()),
    ]));
  }

  // ============ Member View ============
  Widget _buildMemberView() {
    final m = _center!.membership;
    if (m == null) return _buildEmpty();
    final plan = m.plan ?? _center!.plans.where((p) => p.id == m.vipPlanId).firstOrNull;
    return SingleChildScrollView(padding: const EdgeInsets.fromLTRB(14, 12, 14, 24), child: Column(children: [
      _buildCurCard(m, plan), const SizedBox(height: 16), _buildStatsCard(),
      if (_center!.plans.any((p) => p.lifetime && p.planGroup != 'voice')) ...[const SizedBox(height: 26), _buildStory(), const SizedBox(height: 22), _buildUpgradeSec()],
      const SizedBox(height: 40),
    ]));
  }

  Widget _buildCurCard(UserMembership m, VipPlan? plan) {
    final name = plan?.name.isNotEmpty == true ? plan!.name : m.vipPlanCode;
    final remaining = m.remainingDays;
    final validText = m.lifetime ? '永久有效' : (m.expiredAt != null ? _fmtDate(m.expiredAt!) : '已生效');
    return Container(padding: const EdgeInsets.fromLTRB(14, 20, 14, 16), decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFFFFDFD), Color(0xFFFFF6FA)]), border: Border.all(color: const Color(0xFFF6DFE7)), boxShadow: const [BoxShadow(color: Color(0x0F452E4D), blurRadius: 20, offset: Offset(0, 7))]), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [
        Container(width: 50, height: 58, decoration: BoxDecoration(borderRadius: BorderRadius.circular(7), gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [Color(0xFFFFC6D8), Color(0xFFFF91B6)])), child: const Center(child: Icon(CupertinoIcons.star_fill, color: Colors.white, size: 26))),
        const SizedBox(width: 13),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [const Text('当前会员', style: TextStyle(fontSize: 12, color: Color(0xFF666873))), const SizedBox(height: 3), Text(name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 21, fontWeight: FontWeight.w700, color: Color(0xFF111111)))])),
      ]),
      const SizedBox(height: 22),
      Row(children: [
        Expanded(child: _infoItem(Icons.calendar_today_outlined, const Color(0xFFF5F1FF), const Color(0xFF8669F6), '有效至', validText)),
        const SizedBox(width: 12), Container(width: 1, height: 43, color: const Color(0xFFEEEEEF)), const SizedBox(width: 12),
        Expanded(child: _infoItem(Icons.hourglass_bottom, const Color(0xFFFFF0F4), const Color(0xFFFF4C76), '剩余', m.lifetime ? '不限' : '$remaining 天', vc: const Color(0xFFF8446D))),
      ]),
    ]));
  }

  Widget _infoItem(IconData icon, Color bg, Color ic, String label, String value, {Color? vc}) => Row(children: [
    Container(width: 31, height: 31, decoration: BoxDecoration(shape: BoxShape.circle, color: bg), child: Icon(icon, size: 15, color: ic)),
    const SizedBox(width: 9),
    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF666873))), const SizedBox(height: 3), Text(value, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: vc ?? const Color(0xFF171717)))])),
  ]);

  Widget _buildStatsCard() {
    final s = _center!.activityStats;
    return Container(padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 16), decoration: BoxDecoration(borderRadius: BorderRadius.circular(12), color: Colors.white, border: Border.all(color: const Color(0xFFECEBF2)), boxShadow: const [BoxShadow(color: Color(0x0F452E4D), blurRadius: 20, offset: Offset(0, 7))]), child: Row(children: [
      Expanded(child: _statItem('累计陪伴天数', s.companionshipDays, '天', const Color(0xFFF4F1FF), const Color(0xFF6E58EE))),
      const SizedBox(width: 13), Container(width: 1, height: 44, color: const Color(0xFFEEEEEF)), const SizedBox(width: 13),
      Expanded(child: _statItem('总对话次数', s.conversationCount, '次', const Color(0xFFFFF0F4), const Color(0xFFF34972))),
    ]));
  }

  Widget _statItem(String label, int value, String unit, Color bg, Color vc) => Row(children: [
    Container(width: 42, height: 42, decoration: BoxDecoration(shape: BoxShape.circle, color: bg), child: Center(child: Icon(label.contains('对话') ? CupertinoIcons.chat_bubble_2 : CupertinoIcons.clock, size: 20, color: vc))),
    const SizedBox(width: 10),
    Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(label, style: const TextStyle(fontSize: 12, color: Color(0xFF666873))), const SizedBox(height: 2), Row(crossAxisAlignment: CrossAxisAlignment.baseline, textBaseline: TextBaseline.alphabetic, children: [Text(_fmtCnt(value), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w500, color: vc)), const SizedBox(width: 5), Text(unit, style: const TextStyle(fontSize: 13, color: Color(0xFF555761)))])])),
  ]);

  Widget _buildStory() => const Padding(padding: EdgeInsets.symmetric(horizontal: 5), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
    Text('陪伴，是最长情的告白', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: Color(0xFFB56A7C))),
    SizedBox(height: 7), Text('让这份陪伴，在往后的日子里一直都在', style: TextStyle(fontSize: 21, fontWeight: FontWeight.w600, color: Color(0xFF211B1E))),
    SizedBox(height: 10), Text('你已经为这份思念留下一处可以常常回来的地方。升级无限期后，无需再记住到期日，往后的每一年，都可以在这里继续说话、补充记忆。', style: TextStyle(fontSize: 14, color: Color(0xFF6F686C), height: 1.7)),
  ]));

  Widget _buildUpgradeSec() {
    final lps = _center!.plans.where((p) => p.lifetime).toList();
    if (lps.isEmpty) return const SizedBox.shrink();
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Row(children: [const Icon(CupertinoIcons.star_fill, size: 17, color: Color(0xFFFF87A0)), const SizedBox(width: 10), const Text('选择无限期陪伴', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: Color(0xFF111111)))]),
      const SizedBox(height: 5), const Text('你之前购买会员的实付金额，会在升级时自动抵扣。', style: TextStyle(fontSize: 12, color: Color(0xFF8A8287))),
      const SizedBox(height: 12), ...lps.map((p) => _buildUpCard(p)),
    ]);
  }

  Widget _buildUpCard(VipPlan plan) {
    final isVoice = plan.planGroup == 'voice'; final sel = _selectedPlanId == plan.id;
    final deduction = plan.upgradePayableAmount != null ? plan.priceAmount - plan.upgradePayableAmount! : 0;
    return Padding(padding: const EdgeInsets.only(bottom: 14), child: GestureDetector(onTap: () => _selp(plan), child: Container(
      padding: const EdgeInsets.fromLTRB(10, 14, 10, 14),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(12), border: Border.all(color: sel ? const Color(0xFFFF4D72) : const Color(0xFFE8EAF2)), boxShadow: sel ? [BoxShadow(color: const Color(0xFFFF4C72).withValues(alpha: 0.09), blurRadius: 22, offset: const Offset(0, 8))] : [const BoxShadow(color: Color(0x0F452E4D), blurRadius: 20, offset: Offset(0, 7))]),
      child: Stack(children: [
        Row(children: [
          Container(width: 76, height: 76, decoration: BoxDecoration(shape: BoxShape.circle, gradient: LinearGradient(colors: isVoice ? [const Color(0xFFA78BFA).withValues(alpha: 0.2), const Color(0xFFA78BFA).withValues(alpha: 0.1)] : [const Color(0xFFFFD54F).withValues(alpha: 0.2), const Color(0xFFFFB300).withValues(alpha: 0.1)])), child: Center(child: Icon(isVoice ? CupertinoIcons.waveform : CupertinoIcons.star_fill, size: 36, color: isVoice ? const Color(0xFFA78BFA) : const Color(0xFFFFB300)))),
          const SizedBox(width: 6),
          Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(plan.name, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: Color(0xFF111111))),
            if (isVoice) ...[const SizedBox(height: 7), Wrap(spacing: 4, runSpacing: 4, children: const [_PillTag('声音陪伴'), _PillTag('长期纪念')])],
            const SizedBox(height: 8), Text(isVoice ? '长期陪伴与声音权益，让熟悉的交流更完整' : '让这处属于你们的空间长期保留，随时回来继续说话', style: const TextStyle(fontSize: 10, color: Color(0xFF777985))),
            if (deduction > 0) ...[const SizedBox(height: 6), Text('已购会员抵扣 ¥${(deduction / 100).toStringAsFixed(0)}', style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w500, color: Color(0xFFD75170)))],
          ])),
          const SizedBox(width: 6),
          SizedBox(width: 70, child: Column(children: [
            const Text('无限期价格', style: TextStyle(fontSize: 12, color: Color(0xFF666873))), const SizedBox(height: 1),
            Text('¥${(plan.priceAmount / 100).toStringAsFixed(0)}', style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w500, color: Color(0xFF6755E9))),
            Container(height: 1, color: const Color(0xFFEEEEEF), margin: const EdgeInsets.symmetric(vertical: 5)),
            const Text('本次升级', style: TextStyle(fontSize: 12, color: Color(0xFF666873))), const SizedBox(height: 1),
            Text('¥${((plan.upgradePayableAmount ?? plan.priceAmount) / 100).toStringAsFixed(0)}', style: const TextStyle(fontSize: 23, fontWeight: FontWeight.w500, color: Color(0xFFF1436B))),
          ])),
        ]),
        Positioned(top: 0, right: 0, child: Container(padding: const EdgeInsets.symmetric(horizontal: 10), height: 24, decoration: const BoxDecoration(color: Color(0xFFFB3F69), borderRadius: BorderRadius.only(topRight: Radius.circular(11), bottomLeft: Radius.circular(9))), child: const Row(mainAxisSize: MainAxisSize.min, children: [Icon(CupertinoIcons.star_fill, size: 12, color: Colors.white), SizedBox(width: 4), Text('长久相伴', style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: Colors.white))]))),
      ]),
    )));
  }

  static String _fmtDate(DateTime dt) => '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
  static String _fmtCnt(int v) { final s = v.toString(); final b = StringBuffer(); for (int i = 0; i < s.length; i++) { if (i > 0 && (s.length - i) % 3 == 0) b.write(','); b.write(s[i]); } return b.toString(); }
}

class _Chip extends StatelessWidget { final String text; const _Chip({required this.text}); @override Widget build(BuildContext _) => Container(padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2), decoration: BoxDecoration(color: const Color(0xFFFFF3E6), borderRadius: BorderRadius.circular(10)), child: Text(text, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500, color: Color(0xFFFF8C42)))); }
class _PillTag extends StatelessWidget { final String text; const _PillTag(this.text); @override Widget build(BuildContext _) => Container(padding: const EdgeInsets.symmetric(horizontal: 6), height: 23, decoration: BoxDecoration(border: Border.all(color: const Color(0xFFFFD9E1)), borderRadius: BorderRadius.circular(10), color: const Color(0xFFFFF8FA)), child: Center(child: Text(text, style: const TextStyle(fontSize: 10, color: Color(0xFFF5476D))))); }
class _VoiceIcon extends StatelessWidget { final Color color; const _VoiceIcon({required this.color}); @override Widget build(BuildContext _) => SizedBox(height: 38, child: Row(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [Container(width: 4, height: 4, decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.7))), const SizedBox(width: 4), Container(width: 8, height: 28, decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), color: color)), const SizedBox(width: 4), Container(width: 8, height: 38, decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), color: color)), const SizedBox(width: 4), Container(width: 8, height: 32, decoration: BoxDecoration(borderRadius: BorderRadius.circular(999), color: color.withValues(alpha: 0.8))), const SizedBox(width: 4), Container(width: 4, height: 4, margin: EdgeInsets.only(bottom: 34), decoration: BoxDecoration(shape: BoxShape.circle, color: color.withValues(alpha: 0.7)))])); }
