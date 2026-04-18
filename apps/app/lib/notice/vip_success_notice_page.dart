import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class VipSuccessNoticePage extends StatelessWidget {
  const VipSuccessNoticePage({super.key});

  static const String routeName = '/vip-success-notice';
  static const String _hotline = '18062525425';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFFAFAFA),
      body: LayoutBuilder(
        builder: (context, constraints) {
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
                  physics: const BouncingScrollPhysics(),
                  padding: EdgeInsets.fromLTRB(
                    16 * scale,
                    16 * scale,
                    16 * scale,
                    24 * scale,
                  ),
                  child: _OuterCard(scale: scale),
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
                      color: const Color(0xFF111111),
                    ),
                  ),
                ),
              ),
            ),
          ),
          Expanded(
            child: Text(
              '恭喜开通会员成功',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 16 * scale,
                height: 22 / 16,
                fontWeight: FontWeight.w500,
                color: const Color(0xFF111111),
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
            color: const Color(0xFF111111),
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
                color: const Color(0xFF111111),
                width: 1.4 * scale,
              ),
            ),
            child: Center(
              child: Container(
                width: 5.5 * scale,
                height: 5.5 * scale,
                decoration: const BoxDecoration(
                  color: Color(0xFF111111),
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

class _OuterCard extends StatelessWidget {
  const _OuterCard({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12 * scale),
        boxShadow: const [
          BoxShadow(
            color: Color(0x1452505E),
            blurRadius: 10.5,
            offset: Offset(0, 6),
          ),
        ],
      ),
      padding: EdgeInsets.all(16 * scale),
      child: Column(
        children: [
          _IntroMessage(scale: scale),
          SizedBox(height: 8 * scale),
          _InfoPanel(
            scale: scale,
            height: 160 * scale,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  '客服热线：\n工作时间：周一至周日 9:00--21:00\n电话：${VipSuccessNoticePage._hotline}',
                  style: TextStyle(
                    color: const Color(0xFF3D3D3D),
                    fontSize: 16 * scale,
                    height: 1.5,
                  ),
                ),
                _GradientActionButton(
                  scale: scale,
                  label: '立即拨打',
                  onTap: () {
                    ScaffoldMessenger.of(context).hideCurrentSnackBar();
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('客服热线：18062525425'),
                        behavior: SnackBarBehavior.floating,
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
          SizedBox(height: 16 * scale),
          _InfoPanel(
            scale: scale,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '添加客服：\n扫描下方二维码，添加客服微信',
                  style: TextStyle(
                    color: const Color(0xFF3D3D3D),
                    fontSize: 16 * scale,
                    height: 1.5,
                  ),
                ),
                SizedBox(height: 12 * scale),
                Align(child: _QrPlaceholder(scale: scale)),
                SizedBox(height: 12 * scale),
                Center(
                  child: Text(
                    '长按二维码保存至相册，使用微信扫一扫',
                    style: TextStyle(
                      color: const Color(0xFF666666),
                      fontSize: 14 * scale,
                      height: 2.28,
                    ),
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

class _IntroMessage extends StatelessWidget {
  const _IntroMessage({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 12 * scale,
          height: 12 * scale,
          margin: EdgeInsets.only(top: 10 * scale),
          decoration: const BoxDecoration(
            color: Color(0xFFFFD56A),
            shape: BoxShape.circle,
          ),
        ),
        SizedBox(width: 13 * scale),
        Expanded(
          child: Text(
            '尊敬的会员，感谢支持天之灵，请添加我们的专业客服，获取会员服务。',
            style: TextStyle(
              color: const Color(0xFF000000),
              fontSize: 16 * scale,
              height: 2,
            ),
          ),
        ),
      ],
    );
  }
}

class _InfoPanel extends StatelessWidget {
  const _InfoPanel({required this.scale, required this.child, this.height});

  final double scale;
  final Widget child;
  final double? height;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: height,
      width: double.infinity,
      decoration: BoxDecoration(
        color: const Color(0xFFFFF9E2),
        borderRadius: BorderRadius.circular(12 * scale),
        border: Border.all(color: const Color(0xFFFFD56A), width: 2),
      ),
      padding: EdgeInsets.fromLTRB(
        15 * scale,
        16 * scale,
        15 * scale,
        14 * scale,
      ),
      child: child,
    );
  }
}

class _GradientActionButton extends StatelessWidget {
  const _GradientActionButton({
    required this.scale,
    required this.label,
    required this.onTap,
  });

  final double scale;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(40 * scale),
        child: Ink(
          height: 44 * scale,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(40 * scale),
            gradient: const LinearGradient(
              begin: Alignment.centerLeft,
              end: Alignment.centerRight,
              colors: [Color(0xFFFFA800), Color(0xFFFD504E)],
            ),
          ),
          child: Center(
            child: Text(
              label,
              style: TextStyle(
                color: Colors.white,
                fontSize: 16 * scale,
                height: 2,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _QrPlaceholder extends StatelessWidget {
  const _QrPlaceholder({required this.scale});

  final double scale;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 200 * scale,
      height: 200 * scale,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12 * scale),
        border: Border.all(color: const Color(0xFFFFD56A), width: 2),
      ),
      child: Center(
        child: Icon(
          Icons.qr_code_2_rounded,
          size: 88 * scale,
          color: const Color(0x14D79A14),
        ),
      ),
    );
  }
}
