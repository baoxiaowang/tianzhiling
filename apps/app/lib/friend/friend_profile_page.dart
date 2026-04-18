import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class FriendProfilePage extends StatelessWidget {
  const FriendProfilePage({super.key});

  static const String routeName = '/friend-profile';

  static const List<_BasicInfoItem> _basicInfoItems = [
    _BasicInfoItem(label: '备注名', value: '奶奶'),
    _BasicInfoItem(label: 'Ta称呼你为', value: '妮妮'),
    _BasicInfoItem(label: 'Ta是你的', value: '奶奶'),
  ];

  static const List<_BioSectionItem> _bioItems = [
    _BioSectionItem(title: '主要经历', description: '在这里输入TA的生平经历'),
    _BioSectionItem(title: '家庭成员', description: '在这里输入家庭成员介绍'),
    _BioSectionItem(title: '性格品质', description: '你印象中的TA是什么性格？'),
    _BioSectionItem(title: '特长爱好', description: 'TA有什么特长爱好？'),
    _BioSectionItem(
      title: '人际关系',
      description: '在这里输入TA的人际关系',
      height: 124,
      maxLines: 3,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _FriendProfileColors.pageBackground,
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 375),
          child: DecoratedBox(
            decoration: const BoxDecoration(
              color: _FriendProfileColors.pageBackground,
            ),
            child: SafeArea(
              bottom: false,
              child: LayoutBuilder(
                builder: (context, constraints) {
                  final scale = (constraints.maxWidth / 375).clamp(0.88, 1.0);

                  return Stack(
                    children: [
                      Positioned.fill(
                        child: SingleChildScrollView(
                          physics: const BouncingScrollPhysics(),
                          padding: EdgeInsets.only(
                            top: 60 * scale,
                            bottom: 174 * scale,
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              SizedBox(height: 16 * scale),
                              _SectionStrip(title: '基本信息', scale: scale),
                              _BasicInfoGroup(
                                scale: scale,
                                items: _basicInfoItems,
                              ),
                              SizedBox(height: 16 * scale),
                              _SectionStrip(title: '生平', scale: scale),
                              _BioGroup(scale: scale, items: _bioItems),
                            ],
                          ),
                        ),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        top: 0,
                        child: _MiniProgramNavBar(scale: scale),
                      ),
                      Positioned(
                        left: 0,
                        right: 0,
                        bottom: 0,
                        child: _BottomActionArea(scale: scale),
                      ),
                    ],
                  );
                },
              ),
            ),
          ),
        ),
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
                  borderRadius: BorderRadius.circular(32 * scale),
                  child: Padding(
                    padding: EdgeInsets.all(6 * scale),
                    child: Icon(
                      CupertinoIcons.back,
                      size: 20 * scale,
                      color: _FriendProfileColors.title,
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Text(
              '朋友资料',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16 * scale,
                height: 22 / 16,
                fontWeight: FontWeight.w600,
                color: _FriendProfileColors.title,
              ),
            ),
          ),
          SizedBox(
            width: 87 * scale,
            child: Align(
              alignment: Alignment.centerRight,
              child: _MiniProgramActionButton(scale: scale),
            ),
          ),
        ],
      ),
    );
  }
}

class _MiniProgramActionButton extends StatelessWidget {
  const _MiniProgramActionButton({required this.scale});

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
            color: _FriendProfileColors.title,
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
                color: _FriendProfileColors.title,
                width: 1.4 * scale,
              ),
            ),
            child: Center(
              child: Container(
                width: 5.5 * scale,
                height: 5.5 * scale,
                decoration: const BoxDecoration(
                  color: Colors.black,
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

class _SectionStrip extends StatelessWidget {
  const _SectionStrip({required this.title, required this.scale});

  final String title;
  final double scale;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 20 * scale,
      child: Padding(
        padding: EdgeInsets.only(left: 9 * scale),
        child: Align(
          alignment: Alignment.centerLeft,
          child: Text(
            title,
            style: TextStyle(
              fontSize: 14 * scale,
              height: 20 / 14,
              color: _FriendProfileColors.secondaryText,
            ),
          ),
        ),
      ),
    );
  }
}

class _BasicInfoGroup extends StatelessWidget {
  const _BasicInfoGroup({required this.scale, required this.items});

  final double scale;
  final List<_BasicInfoItem> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < items.length; i++)
          _BasicInfoCell(
            item: items[i],
            showDivider: i != items.length - 1,
            scale: scale,
          ),
      ],
    );
  }
}

class _BasicInfoCell extends StatelessWidget {
  const _BasicInfoCell({
    required this.item,
    required this.showDivider,
    required this.scale,
  });

  final _BasicInfoItem item;
  final bool showDivider;
  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 56 * scale,
      color: Colors.white,
      padding: EdgeInsets.symmetric(horizontal: 16 * scale),
      child: Stack(
        children: [
          Positioned.fill(
            child: Align(
              alignment: Alignment.center,
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      item.label,
                      style: TextStyle(
                        fontSize: 17 * scale,
                        height: 24 / 17,
                        color: _FriendProfileColors.primaryText,
                      ),
                    ),
                  ),
                  SizedBox(
                    width: 124 * scale,
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        SizedBox(
                          width: 98 * scale,
                          child: Text(
                            item.value,
                            textAlign: TextAlign.right,
                            style: TextStyle(
                              fontSize: 17 * scale,
                              height: 24 / 17,
                              color: _FriendProfileColors.secondaryText,
                            ),
                          ),
                        ),
                        SizedBox(width: 3 * scale),
                        Icon(
                          CupertinoIcons.chevron_right,
                          size: 16 * scale,
                          color: _FriendProfileColors.chevron,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
          if (showDivider)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(height: 0.5, color: const Color(0x1A000000)),
            ),
        ],
      ),
    );
  }
}

class _BioGroup extends StatelessWidget {
  const _BioGroup({required this.scale, required this.items});

  final double scale;
  final List<_BioSectionItem> items;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        for (var i = 0; i < items.length; i++)
          _BioPromptCell(
            item: items[i],
            showDivider: i != items.length - 1,
            scale: scale,
          ),
      ],
    );
  }
}

class _BioPromptCell extends StatelessWidget {
  const _BioPromptCell({
    required this.item,
    required this.showDivider,
    required this.scale,
  });

  final _BioSectionItem item;
  final bool showDivider;
  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: item.height * scale,
      color: Colors.white,
      padding: EdgeInsets.fromLTRB(
        15 * scale,
        11 * scale,
        16 * scale,
        12 * scale,
      ),
      child: Stack(
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                item.title,
                style: TextStyle(
                  fontSize: 17 * scale,
                  height: 24 / 17,
                  color: _FriendProfileColors.primaryText,
                ),
              ),
              SizedBox(height: 8 * scale),
              Text(
                item.description,
                maxLines: item.maxLines,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14 * scale,
                  height: 20 / 14,
                  color: _FriendProfileColors.secondaryText,
                ),
              ),
            ],
          ),
          if (showDivider)
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(height: 0.5, color: const Color(0x1A000000)),
            ),
        ],
      ),
    );
  }
}

class _BottomActionArea extends StatelessWidget {
  const _BottomActionArea({required this.scale});

  final double scale;

  void _showComingSoon(BuildContext context, String label) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text('$label 功能暂未接入')));
  }

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      ignoring: false,
      child: Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              _FriendProfileColors.pageBackground.withValues(alpha: 0),
              _FriendProfileColors.pageBackground,
              _FriendProfileColors.pageBackground,
            ],
            stops: const [0, 0.22, 1],
          ),
        ),
        child: SafeArea(
          top: false,
          minimum: EdgeInsets.fromLTRB(
            20 * scale,
            30 * scale,
            20 * scale,
            12 * scale,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Stack(
                clipBehavior: Clip.none,
                children: [
                  _ActionButton(
                    scale: scale,
                    label: '按聊天生成',
                    foregroundColor: _FriendProfileColors.ctaText,
                    background: BoxDecoration(
                      color: _FriendProfileColors.softGold,
                      borderRadius: BorderRadius.circular(80 * scale),
                      border: Border.all(
                        color: const Color(0xFFEEBD7C),
                        width: 1,
                      ),
                    ),
                    onTap: () => _showComingSoon(context, '按聊天生成'),
                  ),
                  Positioned(
                    left: 1 * scale,
                    top: -10 * scale,
                    child: _FreeBadge(scale: scale),
                  ),
                ],
              ),
              SizedBox(height: 16 * scale),
              _ActionButton(
                scale: scale,
                label: '专属定制AI亲人',
                foregroundColor: _FriendProfileColors.ctaText,
                background: BoxDecoration(
                  gradient: const LinearGradient(
                    begin: Alignment.centerLeft,
                    end: Alignment.centerRight,
                    colors: [Color(0xFFFCE8CC), Color(0xFFECB872)],
                    stops: [0, 0.9452],
                  ),
                  borderRadius: BorderRadius.circular(80 * scale),
                ),
                onTap: () => _showComingSoon(context, '专属定制AI亲人'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ActionButton extends StatelessWidget {
  const _ActionButton({
    required this.scale,
    required this.label,
    required this.foregroundColor,
    required this.background,
    required this.onTap,
  });

  final double scale;
  final String label;
  final Color foregroundColor;
  final BoxDecoration background;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: 56 * scale,
      child: Material(
        color: Colors.transparent,
        child: Ink(
          decoration: background,
          child: InkWell(
            onTap: onTap,
            borderRadius: BorderRadius.circular(80 * scale),
            child: Center(
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 20 * scale,
                  height: 16 / 20,
                  fontWeight: FontWeight.w600,
                  color: foregroundColor,
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _FreeBadge extends StatelessWidget {
  const _FreeBadge({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 24 * scale,
      padding: EdgeInsets.symmetric(horizontal: 8 * scale),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.centerLeft,
          end: Alignment.centerRight,
          colors: [Color(0xFFF94C06), Color(0xFFFC7F16)],
        ),
        borderRadius: BorderRadius.circular(12 * scale),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 15 * scale,
            height: 15 * scale,
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(2 * scale),
            ),
          ),
          SizedBox(width: 5 * scale),
          RichText(
            text: TextSpan(
              style: TextStyle(
                color: Colors.white,
                height: 1,
                fontWeight: FontWeight.w600,
              ),
              children: [
                TextSpan(
                  text: '免费',
                  style: TextStyle(fontSize: 11 * scale),
                ),
                TextSpan(
                  text: '（1天/次）',
                  style: TextStyle(fontSize: 8 * scale),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _BasicInfoItem {
  const _BasicInfoItem({required this.label, required this.value});

  final String label;
  final String value;
}

class _BioSectionItem {
  const _BioSectionItem({
    required this.title,
    required this.description,
    this.height = 84,
    this.maxLines = 2,
  });

  final String title;
  final String description;
  final double height;
  final int maxLines;
}

class _FriendProfileColors {
  static const Color pageBackground = Color(0xFFFAFAFA);
  static const Color title = Color(0xFF000000);
  static const Color primaryText = Color(0xE6000000);
  static const Color secondaryText = Color(0x80000000);
  static const Color chevron = Color(0xFF6F6F6F);
  static const Color softGold = Color(0xFFFCF5EA);
  static const Color ctaText = Color(0xFF602A0C);
}
