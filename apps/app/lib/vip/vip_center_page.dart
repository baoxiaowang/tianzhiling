import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class VipCenterPage extends StatefulWidget {
  const VipCenterPage({super.key});

  static const String routeName = '/vip-center';

  @override
  State<VipCenterPage> createState() => _VipCenterPageState();
}

class _VipCenterPageState extends State<VipCenterPage> {
  _VipPlan _selectedPlan = _VipPlan.oneYear;

  static const List<_BenefitItem> _yearBenefits = [
    _BenefitItem(tag: '权益1', text: '1 年内免费使用聊天、动态等服务'),
    _BenefitItem(tag: '权益2', text: '聊天框给亲人发照片'),
    _BenefitItem(tag: '权益3', text: '导入过往（微信）聊天记录'),
    _BenefitItem(tag: '权益4', text: '一键通过聊天自动整理记忆及生平'),
    _BenefitItem(tag: '权益5', text: '数据永久存储，多端同步'),
  ];

  static const List<_BenefitItem> _indefiniteBenefits = [
    _BenefitItem(tag: '权益1', text: '天之灵在营期间，可无限制使用各项会员服务'),
    _BenefitItem(tag: '权益2', text: '产品价格调整，不需要额外支付费用'),
    _BenefitItem(tag: '权益3', text: '赠送一次人工访谈服务，为天之灵完善记忆'),
    _BenefitItem(tag: '权益4', text: '5 个家人共享使用'),
    _BenefitItem(tag: '权益5', text: '120 元现金券'),
  ];

  static const List<String> _acknowledgementLines = [
    '生命最珍贵的不是长度，而是那些被记住的瞬间。',
    '"天之灵" 不是创造，而是守护。',
    '守护 TA 的声音、TA 的故事、TA 留在世间的一切痕迹。',
    '用最温暖的技术，为永恒的记忆筑巢。',
    '这是我们的追求与使命。',
    '只有得到您的认可与支持，我们才能走得更远。',
    '未来的所有服务升级，您都可以直接使用。',
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final contentWidth = constraints.maxWidth;
          final scale = (constraints.maxWidth / 375).clamp(0.86, 1.0);

          return Column(
            children: [
              Container(
                color: Colors.white,
                child: SafeArea(
                  bottom: false,
                  child: _MiniProgramNavBar(scale: scale),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(
                    parent: AlwaysScrollableScrollPhysics(),
                  ),
                  padding: EdgeInsets.fromLTRB(0, 0, 0, 24 * scale),
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: SizedBox(
                      width: contentWidth,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _BenefitsSheet(
                            scale: scale,
                            benefits: _selectedPlan == _VipPlan.permanent
                                ? _indefiniteBenefits
                                : _yearBenefits,
                            acknowledgementLines: _acknowledgementLines,
                            selectedPlan: _selectedPlan,
                            onPlanSelected: (_VipPlan plan) {
                              setState(() {
                                _selectedPlan = plan;
                              });
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
              Align(
                alignment: Alignment.bottomCenter,
                child: _PaymentBar(
                  scale: scale,
                  contentWidth: contentWidth,
                  selectedPlan: _selectedPlan,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _MiniProgramNavBar extends StatelessWidget {
  const _MiniProgramNavBar({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 44 * scale,
      child: Padding(
        padding: EdgeInsets.fromLTRB(12 * scale, 0, 7 * scale, 0),
        child: Row(
          children: [
            SizedBox(
              width: 87 * scale,
              child: Align(
                alignment: Alignment.centerLeft,
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => Navigator.of(context).maybePop(),
                    borderRadius: BorderRadius.circular(24 * scale),
                    child: Padding(
                      padding: EdgeInsets.all(6 * scale),
                      child: Icon(
                        CupertinoIcons.back,
                        size: 20 * scale,
                        color: _VipCenterColors.textPrimary,
                      ),
                    ),
                  ),
                ),
              ),
            ),
            Expanded(
              child: Text(
                '会员中心',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 16 * scale,
                  height: 22 / 16,
                  fontWeight: FontWeight.w600,
                  color: _VipCenterColors.textPrimary,
                ),
              ),
            ),
            SizedBox(
              width: 87 * scale,
              child: Align(
                alignment: Alignment.centerRight,
                child: _ActionCapsule(scale: scale),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ActionCapsule extends StatelessWidget {
  const _ActionCapsule({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 87 * scale,
      height: 32 * scale,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16 * scale),
        border: Border.all(color: const Color(0x14000000), width: 0.5),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            CupertinoIcons.ellipsis,
            size: 18 * scale,
            color: _VipCenterColors.textPrimary,
          ),
          Container(
            width: 0.5,
            height: 18.7 * scale,
            margin: EdgeInsets.symmetric(horizontal: 8 * scale),
            color: const Color(0x33000000),
          ),
          Container(
            width: 18 * scale,
            height: 18 * scale,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              border: Border.all(
                color: _VipCenterColors.textPrimary,
                width: 1.4 * scale,
              ),
            ),
            child: Center(
              child: Container(
                width: 5.5 * scale,
                height: 5.5 * scale,
                decoration: const BoxDecoration(
                  color: _VipCenterColors.textPrimary,
                  shape: BoxShape.circle,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BenefitsSheet extends StatelessWidget {
  const _BenefitsSheet({
    required this.scale,
    required this.benefits,
    required this.acknowledgementLines,
    required this.selectedPlan,
    required this.onPlanSelected,
  });

  final double scale;
  final List<_BenefitItem> benefits;
  final List<String> acknowledgementLines;
  final _VipPlan selectedPlan;
  final ValueChanged<_VipPlan> onPlanSelected;

  @override
  Widget build(BuildContext context) {
    final purchaseRowWidth = 335 * scale;
    final purchaseCardGap = 19 * scale;
    final purchaseCardWidth = (purchaseRowWidth - purchaseCardGap) / 2;

    return Container(
      decoration: BoxDecoration(color: Colors.white),
      padding: EdgeInsets.fromLTRB(16 * scale, 16 * scale, 16 * scale, 32),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '会员权益',
            style: TextStyle(
              fontSize: 20 * scale,
              height: 22 / 20,
              fontWeight: FontWeight.w700,
              color: _VipCenterColors.brandBrown,
            ),
          ),
          SizedBox(height: 12 * scale),
          for (final item in benefits) ...[
            _BenefitRow(scale: scale, item: item),
            SizedBox(height: 10 * scale),
          ],
          SizedBox(height: 12 * scale),
          Align(
            alignment: Alignment.center,
            child: SizedBox(
              width: purchaseRowWidth,
              child: Row(
                children: [
                  SizedBox(
                    width: purchaseCardWidth,
                    child: _PlanOptionCard(
                      scale: scale,
                      title: '一年会员',
                      price: const _PriceLine(
                        leading: '￥99/',
                        trailing: '每天0.27元',
                        highlight: '0.27',
                      ),
                      selected: selectedPlan == _VipPlan.oneYear,
                      onTap: () => onPlanSelected(_VipPlan.oneYear),
                    ),
                  ),
                  SizedBox(width: purchaseCardGap),
                  SizedBox(
                    width: purchaseCardWidth,
                    child: _PlanOptionCard(
                      scale: scale,
                      title: '无限期会员',
                      price: const _PriceLine(leading: '￥999', trailing: ''),
                      selected: selectedPlan == _VipPlan.permanent,
                      onTap: () => onPlanSelected(_VipPlan.permanent),
                    ),
                  ),
                ],
              ),
            ),
          ),
          SizedBox(height: 18 * scale),
          Align(
            alignment: Alignment.center,
            child: SizedBox(
              width: purchaseRowWidth,
              child: _MorePurchaseCard(
                scale: scale,
                selected: selectedPlan == _VipPlan.threeYearWithVoice,
                onTap: () => onPlanSelected(_VipPlan.threeYearWithVoice),
              ),
            ),
          ),
          SizedBox(height: 18 * scale),
          _SectionDivider(scale: scale, title: '特别鸣谢'),
          SizedBox(height: 16 * scale),
          Center(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxWidth: 325 * scale),
              child: Text(
                acknowledgementLines.join('\n'),
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontSize: 12 * scale,
                  height: 20 / 12,
                  color: _VipCenterColors.secondaryText,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BenefitRow extends StatelessWidget {
  const _BenefitRow({required this.scale, required this.item});

  final double scale;
  final _BenefitItem item;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          width: 46 * scale,
          height: 20 * scale,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xFFFBD099), Color(0xFFFCE5C7)],
            ),
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(12 * scale),
              topRight: Radius.circular(4 * scale),
              bottomLeft: Radius.circular(4 * scale),
              bottomRight: Radius.circular(12 * scale),
            ),
          ),
          alignment: Alignment.center,
          child: Text(
            item.tag,
            style: TextStyle(
              fontSize: 11 * scale,
              height: 16 / 11,
              fontWeight: FontWeight.w600,
              color: _VipCenterColors.tagText,
            ),
          ),
        ),
        SizedBox(width: 11 * scale),
        Expanded(
          child: Text(
            item.text,
            style: TextStyle(
              fontSize: 14 * scale,
              height: 20 / 14,
              fontWeight: FontWeight.w500,
              color: _VipCenterColors.bodyText,
            ),
          ),
        ),
      ],
    );
  }
}

class _MorePurchaseCard extends StatelessWidget {
  const _MorePurchaseCard({
    required this.scale,
    required this.selected,
    required this.onTap,
  });

  final double scale;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(top: 10 * scale),
      child: SizedBox(
        height: 80 * scale,
        child: Stack(
          fit: StackFit.expand,
          clipBehavior: Clip.none,
          children: [
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onTap,
                borderRadius: BorderRadius.circular(12 * scale),
                child: Container(
                  decoration: BoxDecoration(
                    color: _VipCenterColors.softPanel,
                    borderRadius: BorderRadius.circular(12 * scale),
                    border: selected
                        ? Border.all(color: const Color(0xFFBB7952), width: 1)
                        : null,
                  ),
                  child: Padding(
                    padding: EdgeInsets.fromLTRB(
                      18 * scale,
                      16 * scale,
                      14 * scale,
                      12 * scale,
                    ),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text.rich(
                            TextSpan(
                              style: TextStyle(
                                height: 16 / 18,
                                fontWeight: FontWeight.w700,
                                color: _VipCenterColors.deepBrown,
                              ),
                              children: [
                                TextSpan(
                                  text: '三年会员',
                                  style: TextStyle(fontSize: 18 * scale),
                                ),
                                TextSpan(
                                  text: '+',
                                  style: TextStyle(fontSize: 24 * scale),
                                ),
                                TextSpan(
                                  text: '声音模型',
                                  style: TextStyle(fontSize: 18 * scale),
                                ),
                              ],
                            ),
                          ),
                        ),
                        SizedBox(width: 8 * scale),
                        Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          mainAxisSize: MainAxisSize.min,
                          crossAxisAlignment: CrossAxisAlignment.end,
                          children: [
                            Text.rich(
                              TextSpan(
                                children: [
                                  TextSpan(
                                    text: '￥299',
                                    style: TextStyle(
                                      fontSize: 24 * scale,
                                      height: 16 / 24,
                                      fontWeight: FontWeight.w700,
                                      color: _VipCenterColors.pricePrimary,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            SizedBox(height: 4 * scale),
                            Container(
                              width: 72 * scale,
                              height: 22 * scale,
                              decoration: BoxDecoration(
                                color: _VipCenterColors.priceAccent,
                                borderRadius: BorderRadius.circular(6 * scale),
                              ),
                              alignment: Alignment.center,
                              child: Text(
                                '即将恢复原价',
                                style: TextStyle(
                                  fontSize: 9 * scale,
                                  height: 16 / 9,
                                  fontWeight: FontWeight.w600,
                                  color: Colors.white,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            Positioned(
              left: 0,
              top: -10 * scale,
              child: Container(
                width: 85 * scale,
                height: 24 * scale,
                decoration: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [Color(0xFFF94C06), Color(0xFFFC7F16)],
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(12 * scale),
                    bottomRight: Radius.circular(12 * scale),
                  ),
                ),
                padding: EdgeInsets.symmetric(horizontal: 8 * scale),
                child: Row(
                  children: [
                    Container(
                      width: 16 * scale,
                      height: 16 * scale,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.18),
                        borderRadius: BorderRadius.circular(4 * scale),
                      ),
                      child: Icon(
                        CupertinoIcons.star_fill,
                        size: 10 * scale,
                        color: Colors.white,
                      ),
                    ),
                    SizedBox(width: 6 * scale),
                    Text(
                      '更多购买',
                      style: TextStyle(
                        fontSize: 11 * scale,
                        height: 16 / 11,
                        fontWeight: FontWeight.w600,
                        color: Colors.white,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _PlanOptionCard extends StatelessWidget {
  const _PlanOptionCard({
    required this.scale,
    required this.title,
    required this.price,
    required this.onTap,
    this.selected = false,
  });

  final double scale;
  final String title;
  final _PriceLine price;
  final VoidCallback onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final decoration = BoxDecoration(
      gradient: selected
          ? const LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xFFFFF3E2), Color(0xFFFFD9A3)],
            )
          : null,
      color: selected ? null : _VipCenterColors.softPanel,
      borderRadius: BorderRadius.circular(12 * scale),
      border: selected
          ? Border.all(color: const Color(0xFFBB7952), width: 1)
          : null,
    );

    return SizedBox(
      height: 80 * scale,
      child: Stack(
        fit: StackFit.expand,
        clipBehavior: Clip.none,
        children: [
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTap,
              borderRadius: BorderRadius.circular(12 * scale),
              child: Container(
                decoration: decoration,
                child: Padding(
                  padding: EdgeInsets.fromLTRB(
                    10 * scale,
                    16 * scale,
                    10 * scale,
                    12 * scale,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Text(
                        title,
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontSize: 18 * scale,
                          height: 16 / 18,
                          fontWeight: FontWeight.w600,
                          color: _VipCenterColors.priceText,
                        ),
                      ),
                      const Spacer(),
                      FittedBox(
                        fit: BoxFit.scaleDown,
                        child: _PriceText(scale: scale, price: price),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _PriceText extends StatelessWidget {
  const _PriceText({required this.scale, required this.price});

  final double scale;
  final _PriceLine price;

  @override
  Widget build(BuildContext context) {
    if (price.highlight != null) {
      final trailingParts = price.trailing.split(price.highlight!);
      return Text.rich(
        TextSpan(
          children: [
            TextSpan(
              text: price.leading,
              style: TextStyle(
                fontSize: 24 * scale,
                height: 16 / 24,
                fontWeight: FontWeight.w700,
                color: _VipCenterColors.priceText,
              ),
            ),
            TextSpan(
              text: trailingParts.first,
              style: TextStyle(
                fontSize: 12 * scale,
                height: 16 / 12,
                fontWeight: FontWeight.w500,
                color: _VipCenterColors.secondaryText,
              ),
            ),
            TextSpan(
              text: price.highlight,
              style: TextStyle(
                fontSize: 12 * scale,
                height: 16 / 12,
                fontWeight: FontWeight.w600,
                color: _VipCenterColors.pricePrimary,
              ),
            ),
            if (trailingParts.length > 1)
              TextSpan(
                text: trailingParts.last,
                style: TextStyle(
                  fontSize: 12 * scale,
                  height: 16 / 12,
                  fontWeight: FontWeight.w500,
                  color: _VipCenterColors.secondaryText,
                ),
              ),
          ],
        ),
      );
    }

    return Text.rich(
      TextSpan(
        children: [
          TextSpan(
            text: price.leading,
            style: TextStyle(
              fontSize: 24 * scale,
              height: 16 / 24,
              fontWeight: FontWeight.w700,
              color: _VipCenterColors.priceText,
            ),
          ),
          TextSpan(
            text: price.trailing,
            style: TextStyle(
              fontSize: 16 * scale,
              height: 16 / 16,
              fontWeight: FontWeight.w600,
              color: _VipCenterColors.secondaryText,
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionDivider extends StatelessWidget {
  const _SectionDivider({required this.scale, required this.title});

  final double scale;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(child: _GradientRule(scale: scale)),
        SizedBox(width: 10 * scale),
        Text(
          title,
          style: TextStyle(
            fontSize: 14 * scale,
            height: 16 / 14,
            fontWeight: FontWeight.w600,
            color: _VipCenterColors.sectionTitle,
          ),
        ),
        SizedBox(width: 10 * scale),
        Expanded(child: _GradientRule(scale: scale, reversed: true)),
      ],
    );
  }
}

class _GradientRule extends StatelessWidget {
  const _GradientRule({required this.scale, this.reversed = false});

  final double scale;
  final bool reversed;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 3 * scale,
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: reversed ? Alignment.centerLeft : Alignment.centerRight,
          end: reversed ? Alignment.centerRight : Alignment.centerLeft,
          colors: const [Color(0x00FF6F03), Color(0xFFFF6F03)],
        ),
      ),
    );
  }
}

class _PaymentBar extends StatelessWidget {
  const _PaymentBar({
    required this.scale,
    required this.contentWidth,
    required this.selectedPlan,
  });

  final double scale;
  final double contentWidth;
  final _VipPlan selectedPlan;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [
          BoxShadow(
            color: Color(0x4D000000),
            blurRadius: 5,
            offset: Offset(2, 2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Align(
          alignment: Alignment.topCenter,
          child: SizedBox(
            width: contentWidth,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                20 * scale,
                18 * scale,
                20 * scale,
                6 * scale,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    height: 56 * scale,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        begin: Alignment.centerLeft,
                        end: Alignment.centerRight,
                        colors: [Color(0xFFFCE8CC), Color(0xFFECB872)],
                        stops: [0.0, 0.95],
                      ),
                      borderRadius: BorderRadius.circular(80 * scale),
                    ),
                    child: Padding(
                      padding: EdgeInsets.symmetric(horizontal: 14 * scale),
                      child: Row(
                        children: [
                          SizedBox(width: 92 * scale),
                          Expanded(
                            child: Center(
                              child: FittedBox(
                                child: Text.rich(
                                  TextSpan(
                                    children: [
                                      TextSpan(
                                        text: '支付 ',
                                        style: TextStyle(
                                          fontSize: 16 * scale,
                                          height: 16 / 16,
                                          fontWeight: FontWeight.w600,
                                          color: _VipCenterColors.deepBrown,
                                        ),
                                      ),
                                      TextSpan(
                                        text: selectedPlan.payPrice,
                                        style: TextStyle(
                                          fontSize: 24 * scale,
                                          height: 16 / 24,
                                          fontWeight: FontWeight.w700,
                                          color: _VipCenterColors.deepBrown,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ),
                            ),
                          ),
                          SizedBox(
                            width: 92 * scale,
                            child: Align(
                              alignment: Alignment.centerRight,
                              child: Text(
                                selectedPlan.buttonLabel,
                                style: TextStyle(
                                  fontSize: 16 * scale,
                                  height: 16 / 16,
                                  fontWeight: FontWeight.w600,
                                  color: _VipCenterColors.deepBrown,
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 6 * scale),
                  Text(
                    '开通即表示同意《天之灵会员协议》及《连续订阅协议》',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11 * scale,
                      height: 16 / 11,
                      color: _VipCenterColors.sectionTitle,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _BenefitItem {
  const _BenefitItem({required this.tag, required this.text});

  final String tag;
  final String text;
}

class _PriceLine {
  const _PriceLine({
    required this.leading,
    required this.trailing,
    this.highlight,
  });

  final String leading;
  final String trailing;
  final String? highlight;
}

enum _VipPlan { threeYearWithVoice, oneYear, permanent }

extension on _VipPlan {
  String get payPrice {
    switch (this) {
      case _VipPlan.threeYearWithVoice:
        return '￥299';
      case _VipPlan.oneYear:
        return '￥99';
      case _VipPlan.permanent:
        return '￥999';
    }
  }

  String get buttonLabel {
    switch (this) {
      case _VipPlan.threeYearWithVoice:
        return '立即购买';
      case _VipPlan.oneYear:
      case _VipPlan.permanent:
        return '升级VIP';
    }
  }
}

class _VipCenterColors {
  static const Color textPrimary = Color(0xFF111111);
  static const Color brandBrown = Color(0xFFA96B46);
  static const Color bodyText = Color(0xFF575764);
  static const Color secondaryText = Color(0xFF666666);
  static const Color softPanel = Color(0xFFF7F7F7);
  static const Color sectionTitle = Color(0xFF3D3D3D);
  static const Color pricePrimary = Color(0xFFF94F07);
  static const Color priceAccent = Color(0xFFFE9F39);
  static const Color priceText = Color(0xFF333333);
  static const Color deepBrown = Color(0xFF602A0C);
  static const Color tagText = Color(0xFF783D13);
}
