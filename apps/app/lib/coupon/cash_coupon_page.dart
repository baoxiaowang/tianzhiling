import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class CashCouponPage extends StatelessWidget {
  const CashCouponPage({super.key});

  static const String routeName = '/cash-coupon';

  static const List<_CouponRecord> _records = [
    _CouponRecord(
      title: '现金券',
      dateTime: '2026-01-02  20:26:57',
      amount: '-120',
      description: '声音模型-普通话版',
      highlight: true,
    ),
    _CouponRecord(
      title: '现金券',
      dateTime: '2025-12-27  10:18:36',
      amount: '+50',
    ),
    _CouponRecord(
      title: '现金券',
      dateTime: '2025-12-25  16:24:57',
      amount: '-99',
      description: '开通VIP',
      highlight: true,
    ),
    _CouponRecord(
      title: '现金券',
      dateTime: '2025-12-25  16:24:57',
      amount: '+300',
      description: '小红书推广',
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _CashCouponColors.pageBackground,
      body: LayoutBuilder(
        builder: (context, constraints) {
          final contentWidth = constraints.maxWidth.clamp(0.0, 375.0);
          final scale = (contentWidth / 375).clamp(0.82, 1.0);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
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
                  padding: EdgeInsets.only(bottom: 24 * scale),
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: SizedBox(
                      width: contentWidth,
                      child: Padding(
                        padding: EdgeInsets.fromLTRB(12, 12 * scale, 12, 0),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            _BalanceCard(scale: scale),
                            SizedBox(height: 16 * scale),
                            Text(
                              '收支记录',
                              style: TextStyle(
                                fontSize: 16 * scale,
                                height: 24 / 16,
                                fontWeight: FontWeight.w500,
                                color: _CashCouponColors.title,
                              ),
                            ),
                            SizedBox(height: 12 * scale),
                            _RecordCard(scale: scale, records: _records),
                          ],
                        ),
                      ),
                    ),
                  ),
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
    return Container(
      height: 44 * scale,
      color: Colors.white,
      alignment: Alignment.center,
      child: Text(
        '现金券',
        textAlign: TextAlign.center,
        style: TextStyle(
          fontSize: 16 * scale,
          height: 22 / 16,
          fontWeight: FontWeight.w600,
          color: _CashCouponColors.title,
        ),
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 144 * scale,
      padding: EdgeInsets.fromLTRB(
        18 * scale,
        16 * scale,
        18 * scale,
        16 * scale,
      ),
      decoration: BoxDecoration(
        color: _CashCouponColors.balanceCard,
        borderRadius: BorderRadius.circular(8 * scale),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                CupertinoIcons.creditcard,
                size: 18 * scale,
                color: const Color(0x99FFFFFF),
              ),
              SizedBox(width: 8 * scale),
              Text(
                '现金券余额（元）',
                style: TextStyle(
                  fontSize: 17 * scale,
                  height: 24 / 17,
                  fontWeight: FontWeight.w500,
                  color: const Color(0x99FFFFFF),
                ),
              ),
            ],
          ),
          SizedBox(height: 10 * scale),
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              Text(
                '51.00',
                style: TextStyle(
                  fontSize: 34 * scale,
                  height: 1,
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5 * scale,
                  color: Colors.white,
                ),
              ),
              Expanded(
                child: Align(
                  alignment: Alignment.bottomRight,
                  child: ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: 152 * scale),
                    child: SizedBox(
                      width: double.infinity,
                      height: 40 * scale,
                      child: DecoratedBox(
                        decoration: BoxDecoration(
                          color: _CashCouponColors.cta,
                          borderRadius: BorderRadius.circular(10 * scale),
                          boxShadow: const [
                            BoxShadow(
                              color: Color(0x1A000000),
                              blurRadius: 10,
                              offset: Offset(0, 4),
                            ),
                          ],
                        ),
                        child: Center(
                          child: FittedBox(
                            child: Text(
                              '做任务领现金券',
                              style: TextStyle(
                                fontSize: 16 * scale,
                                height: 20 / 16,
                                fontWeight: FontWeight.w500,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _RecordCard extends StatelessWidget {
  const _RecordCard({required this.scale, required this.records});

  final double scale;
  final List<_CouponRecord> records;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 450 * scale,
      padding: EdgeInsets.fromLTRB(
        12 * scale,
        12 * scale,
        12 * scale,
        12 * scale,
      ),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(8 * scale),
      ),
      child: Column(
        children: [
          for (var i = 0; i < records.length; i++) ...[
            _RecordRow(scale: scale, record: records[i]),
            if (i != records.length - 1) SizedBox(height: 12 * scale),
          ],
          const Spacer(),
        ],
      ),
    );
  }
}

class _RecordRow extends StatelessWidget {
  const _RecordRow({required this.scale, required this.record});

  final double scale;
  final _CouponRecord record;

  @override
  Widget build(BuildContext context) {
    final subtitleColor = record.highlight
        ? _CashCouponColors.highlightText
        : _CashCouponColors.secondaryText;

    return SizedBox(
      height: 48 * scale,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 28 * scale,
            height: 28 * scale,
            margin: EdgeInsets.only(top: 2 * scale),
            decoration: const BoxDecoration(
              color: _CashCouponColors.coin,
              shape: BoxShape.circle,
            ),
            child: Center(
              child: Text(
                '¥',
                style: TextStyle(
                  fontSize: 16 * scale,
                  height: 1,
                  fontWeight: FontWeight.w700,
                  color: Colors.white,
                ),
              ),
            ),
          ),
          SizedBox(width: 10 * scale),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(top: 1 * scale),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    record.title,
                    style: TextStyle(
                      fontSize: 14 * scale,
                      height: 24 / 14,
                      fontWeight: FontWeight.w500,
                      color: _CashCouponColors.title,
                    ),
                  ),
                  SizedBox(height: 4 * scale),
                  Text(
                    record.dateTime,
                    maxLines: 1,
                    overflow: TextOverflow.clip,
                    style: TextStyle(
                      fontSize: 12 * scale,
                      height: 16 / 12,
                      color: _CashCouponColors.secondaryText,
                    ),
                  ),
                ],
              ),
            ),
          ),
          SizedBox(width: 8 * scale),
          ConstrainedBox(
            constraints: BoxConstraints(minWidth: 60 * scale),
            child: Padding(
              padding: EdgeInsets.only(top: 1 * scale),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    record.amount,
                    style: TextStyle(
                      fontSize: 16 * scale,
                      height: 24 / 16,
                      fontWeight: FontWeight.w700,
                      color: _CashCouponColors.title,
                    ),
                  ),
                  SizedBox(height: 2 * scale),
                  if (record.description != null)
                    Text(
                      record.description!,
                      maxLines: 1,
                      overflow: TextOverflow.fade,
                      softWrap: false,
                      style: TextStyle(
                        fontSize: 12 * scale,
                        height: 16 / 12,
                        color: subtitleColor,
                      ),
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CouponRecord {
  const _CouponRecord({
    required this.title,
    required this.dateTime,
    required this.amount,
    this.description,
    this.highlight = false,
  });

  final String title;
  final String dateTime;
  final String amount;
  final String? description;
  final bool highlight;
}

class _CashCouponColors {
  static const Color pageBackground = Color(0xFFEDEDED);
  static const Color title = Color(0xFF3D3D3D);
  static const Color secondaryText = Color(0xFF8C8C8C);
  static const Color highlightText = Color(0xFFEBB402);
  static const Color balanceCard = Color(0xFF2AAE67);
  static const Color cta = Color(0xFF07C160);
  static const Color coin = Color(0xFFFFBF10);
}
