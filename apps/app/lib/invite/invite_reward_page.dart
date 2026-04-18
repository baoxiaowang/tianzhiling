import 'package:flutter/material.dart';

class InviteRewardPage extends StatelessWidget {
  const InviteRewardPage({super.key});

  static const String routeName = '/invite-reward';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8F2E8),
      body: LayoutBuilder(
        builder: (context, constraints) {
          final contentWidth = constraints.maxWidth.clamp(0.0, 390.0);
          final scale = (contentWidth / 390).clamp(0.84, 1.0);

          return Column(
            children: [
              SafeArea(
                bottom: false,
                child: SizedBox(
                  height: 44 * scale,
                  child: _TopBar(scale: scale),
                ),
              ),
              Expanded(
                child: SingleChildScrollView(
                  padding: EdgeInsets.fromLTRB(
                    12 * scale,
                    10 * scale,
                    12 * scale,
                    20 * scale,
                  ),
                  child: Align(
                    alignment: Alignment.topCenter,
                    child: SizedBox(
                      width: contentWidth,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          _HeroBanner(scale: scale),
                          SizedBox(height: 12 * scale),
                          _InviteCodeCard(scale: scale),
                          SizedBox(height: 12 * scale),
                          _BindInviterCard(scale: scale),
                          SizedBox(height: 12 * scale),
                          _TipsCard(scale: scale),
                          SizedBox(height: 14 * scale),
                          _InviteRecordCard(scale: scale),
                        ],
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

class _TopBar extends StatelessWidget {
  const _TopBar({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.symmetric(horizontal: 8 * scale),
      child: Row(
        children: [
          Icon(
            Icons.arrow_back_ios_new,
            size: 20 * scale,
            color: const Color(0xFF333333),
          ),
          Expanded(
            child: Text(
              '邀请有礼',
              textAlign: TextAlign.center,
              style: TextStyle(
                color: const Color(0xFF222222),
                fontSize: 17 * scale,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          Icon(
            Icons.more_horiz,
            size: 22 * scale,
            color: const Color(0xFF333333),
          ),
          SizedBox(width: 8 * scale),
          Icon(
            Icons.radio_button_unchecked,
            size: 18 * scale,
            color: const Color(0xFF333333),
          ),
        ],
      ),
    );
  }
}

class _HeroBanner extends StatelessWidget {
  const _HeroBanner({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 86 * scale,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10 * scale),
        gradient: const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [Color(0xFFFFE9C8), Color(0xFFFFD79A)],
        ),
      ),
      child: Stack(
        children: [
          Positioned(
            left: 14 * scale,
            top: 17 * scale,
            child: Text(
              '邀请注册 得现金',
              style: TextStyle(
                fontSize: 30 * scale,
                height: 1,
                fontWeight: FontWeight.w900,
                color: const Color(0xFFE68A00),
              ),
            ),
          ),
          Positioned(
            left: 18 * scale,
            bottom: 12 * scale,
            child: Text(
              '尾号 1234 成功领取 10元 现金券',
              style: TextStyle(
                fontSize: 11 * scale,
                color: const Color(0xFFD8982E),
              ),
            ),
          ),
          Positioned(
            right: 18 * scale,
            top: 14 * scale,
            child: Container(
              width: 58 * scale,
              height: 58 * scale,
              decoration: const BoxDecoration(
                color: Color(0xFFFFB44D),
                shape: BoxShape.circle,
              ),
              child: Center(
                child: Text(
                  '￥',
                  style: TextStyle(
                    fontSize: 24 * scale,
                    fontWeight: FontWeight.w800,
                    color: Colors.white,
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

class _InviteCodeCard extends StatelessWidget {
  const _InviteCodeCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return _SectionCard(
      scale: scale,
      title: '邀请注册得10元现金券',
      badge: '活动',
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(6, (index) {
              return Container(
                width: 46 * scale,
                height: 38 * scale,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF4EA),
                  borderRadius: BorderRadius.circular(8 * scale),
                ),
                child: Text(
                  '${index + 1}',
                  style: TextStyle(
                    color: const Color(0xFFEBA56B),
                    fontSize: 22 * scale,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              );
            }),
          ),
          SizedBox(height: 12 * scale),
          _GradientButton(scale: scale, label: '复制邀请码'),
        ],
      ),
    );
  }
}

class _BindInviterCard extends StatelessWidget {
  const _BindInviterCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return _SectionCard(
      scale: scale,
      title: '绑定邀请人',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            '输入介绍人的邀请码，即可领10元现金券，每人限领一次',
            style: TextStyle(
              fontSize: 12 * scale,
              color: const Color(0xFF9D7A54),
            ),
          ),
          SizedBox(height: 10 * scale),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: List.generate(
              6,
              (_) => Container(
                width: 46 * scale,
                height: 38 * scale,
                decoration: BoxDecoration(
                  color: const Color(0xFFFFF4EA),
                  borderRadius: BorderRadius.circular(8 * scale),
                ),
              ),
            ),
          ),
          SizedBox(height: 12 * scale),
          _GradientButton(scale: scale, label: '确认'),
        ],
      ),
    );
  }
}

class _TipsCard extends StatelessWidget {
  const _TipsCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12 * scale,
        10 * scale,
        12 * scale,
        12 * scale,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF4E6D5),
        borderRadius: BorderRadius.circular(10 * scale),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Tips：哪些渠道去分享',
            style: TextStyle(
              fontSize: 21 * scale,
              color: const Color(0xFFDB8E3D),
              fontWeight: FontWeight.w700,
            ),
          ),
          SizedBox(height: 10 * scale),
          Text(
            '小红书/抖音/快手/微博等',
            style: TextStyle(
              fontSize: 22 * scale,
              color: const Color(0xFFE27857),
              fontWeight: FontWeight.w800,
            ),
          ),
          SizedBox(height: 8 * scale),
          Text(
            '方式1：搜索“天之灵”在相关帖子评论',
            style: TextStyle(
              fontSize: 13 * scale,
              color: const Color(0xFF7B5E41),
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(height: 6 * scale),
          Container(
            width: double.infinity,
            padding: EdgeInsets.all(8 * scale),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8 * scale),
            ),
            child: Row(
              children: [
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 6 * scale,
                    vertical: 2 * scale,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF6E5C),
                    borderRadius: BorderRadius.circular(4 * scale),
                  ),
                  child: Text(
                    '示例',
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 10 * scale,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                SizedBox(width: 8 * scale),
                Expanded(
                  child: Text(
                    '复制 123456 邀请码可得10元现金券，\n付费音库接口，在“我-语调调”里填写',
                    style: TextStyle(
                      color: const Color(0xFF7B5E41),
                      fontSize: 11 * scale,
                      height: 1.25,
                    ),
                  ),
                ),
              ],
            ),
          ),
          SizedBox(height: 10 * scale),
          _GradientButton(scale: scale, label: '去评论'),
          SizedBox(height: 12 * scale),
          Text(
            '方式2：自己在相关社交账号发帖子',
            style: TextStyle(
              fontSize: 13 * scale,
              color: const Color(0xFF7B5E41),
              fontWeight: FontWeight.w600,
            ),
          ),
          SizedBox(height: 6 * scale),
          Container(
            width: double.infinity,
            padding: EdgeInsets.all(8 * scale),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(8 * scale),
            ),
            child: Column(
              children: [
                Row(
                  children: [
                    Container(
                      padding: EdgeInsets.symmetric(
                        horizontal: 6 * scale,
                        vertical: 2 * scale,
                      ),
                      decoration: BoxDecoration(
                        color: const Color(0xFFFF6E5C),
                        borderRadius: BorderRadius.circular(4 * scale),
                      ),
                      child: Text(
                        '示例',
                        style: TextStyle(
                          color: Colors.white,
                          fontSize: 10 * scale,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    SizedBox(width: 8 * scale),
                    Expanded(
                      child: Text(
                        '标题/话题：学普通话 天之灵\n#北京客服 #AI唤醒器 等话题',
                        style: TextStyle(
                          color: const Color(0xFF7B5E41),
                          fontSize: 11 * scale,
                          height: 1.25,
                        ),
                      ),
                    ),
                  ],
                ),
                SizedBox(height: 8 * scale),
                Row(
                  children: [
                    Expanded(child: _SampleShot(scale: scale)),
                    SizedBox(width: 8 * scale),
                    Expanded(child: _SampleShot(scale: scale)),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _InviteRecordCard extends StatelessWidget {
  const _InviteRecordCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12 * scale,
        12 * scale,
        12 * scale,
        14 * scale,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF4E6D5),
        borderRadius: BorderRadius.circular(10 * scale),
      ),
      child: Column(
        children: [
          Text(
            '邀请记录',
            style: TextStyle(
              color: const Color(0xFFD59647),
              fontSize: 30 * scale,
              fontWeight: FontWeight.w800,
              height: 1,
            ),
          ),
          SizedBox(height: 12 * scale),
          Container(
            padding: EdgeInsets.symmetric(vertical: 16 * scale),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10 * scale),
            ),
            child: Row(
              children: [
                Expanded(
                  child: _RecordMetric(scale: scale, value: '2人', label: '已邀请'),
                ),
                Container(
                  width: 1,
                  height: 38 * scale,
                  color: const Color(0xFFF0E6DA),
                ),
                Expanded(
                  child: _RecordMetric(
                    scale: scale,
                    value: '20元',
                    label: '累计获得',
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _RecordMetric extends StatelessWidget {
  const _RecordMetric({
    required this.scale,
    required this.value,
    required this.label,
  });

  final double scale;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            color: const Color(0xFFD9A51E),
            fontSize: 32 * scale,
            fontWeight: FontWeight.w700,
            height: 1,
          ),
        ),
        SizedBox(height: 6 * scale),
        Text(
          label,
          style: TextStyle(
            color: const Color(0xFF3B3328),
            fontSize: 20 * scale,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}

class _SampleShot extends StatelessWidget {
  const _SampleShot({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 132 * scale,
      decoration: BoxDecoration(
        color: const Color(0xFFF7F7F7),
        borderRadius: BorderRadius.circular(6 * scale),
        border: Border.all(color: const Color(0xFFE8E8E8)),
      ),
      child: Center(
        child: Icon(
          Icons.image_outlined,
          color: const Color(0xFFCCCCCC),
          size: 24 * scale,
        ),
      ),
    );
  }
}

class _GradientButton extends StatelessWidget {
  const _GradientButton({required this.scale, required this.label});

  final double scale;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 44 * scale,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10 * scale),
        gradient: const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [Color(0xFFFFBE00), Color(0xFFFF6D45)],
        ),
      ),
      child: Center(
        child: Text(
          label,
          style: TextStyle(
            color: Colors.white,
            fontSize: 17 * scale,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _SectionCard extends StatelessWidget {
  const _SectionCard({
    required this.scale,
    required this.title,
    required this.child,
    this.badge,
  });

  final double scale;
  final String title;
  final Widget child;
  final String? badge;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        12 * scale,
        10 * scale,
        12 * scale,
        12 * scale,
      ),
      decoration: BoxDecoration(
        color: const Color(0xFFF4E6D5),
        borderRadius: BorderRadius.circular(10 * scale),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (badge != null)
                Container(
                  padding: EdgeInsets.symmetric(
                    horizontal: 8 * scale,
                    vertical: 3 * scale,
                  ),
                  decoration: BoxDecoration(
                    color: const Color(0xFFFF6A3B),
                    borderRadius: BorderRadius.circular(30 * scale),
                  ),
                  child: Text(
                    badge!,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 11 * scale,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              if (badge != null) SizedBox(width: 8 * scale),
              Expanded(
                child: Text(
                  title,
                  style: TextStyle(
                    color: const Color(0xFFD58B3D),
                    fontSize: 28 * scale,
                    fontWeight: FontWeight.w800,
                    height: 1.1,
                  ),
                ),
              ),
            ],
          ),
          SizedBox(height: 10 * scale),
          Container(
            width: double.infinity,
            padding: EdgeInsets.all(10 * scale),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(10 * scale),
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}
