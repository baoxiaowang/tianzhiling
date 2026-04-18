import 'package:flutter/material.dart';
import 'package:lottie/lottie.dart';
import 'package:tianzhiling_app/agent/agent_create_flow_page.dart';
import 'package:tianzhiling_app/models/agent_models.dart';

class AgentCreatePage extends StatelessWidget {
  const AgentCreatePage({super.key});

  static const String routeName = '/agents/create';
  static const String _backgroundAsset = 'assets/images/agent-start.png';
  static const String _orbLottieAsset = 'assets/lottie/agent_intro_orb.json';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFF060814),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 393),
          child: ColoredBox(
            color: const Color(0xFF060814),
            child: Stack(
              children: [
                const Positioned.fill(child: _StartBackground()),
                Positioned(
                  left: 74,
                  right: 74,
                  bottom: 112,
                  height: 228,
                  child: GestureDetector(
                    onTap: () async {
                      final result = await Navigator.of(
                        context,
                      ).pushNamed(AgentCreateFlowPage.routeName);

                      if (!context.mounted || result is! AgentSummary) {
                        return;
                      }

                      Navigator.of(context).pop(result);
                    },
                    behavior: HitTestBehavior.opaque,
                    child: const SizedBox.expand(),
                  ),
                ),
                SafeArea(
                  bottom: false,
                  child: Column(
                    children: const [
                      _TopBar(),
                      SizedBox(height: 34),
                      _HeaderOrb(),
                      SizedBox(height: 16),
                      _IntroText(),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StartBackground extends StatelessWidget {
  const _StartBackground();

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      AgentCreatePage._backgroundAsset,
      fit: BoxFit.cover,
      alignment: Alignment.topCenter,
      errorBuilder: (context, error, stackTrace) {
        return const DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [Color(0xFF070A17), Color(0xFF090C18), Color(0xFF020203)],
              stops: [0, 0.38, 1],
            ),
          ),
        );
      },
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar();

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 56,
      child: Align(
        alignment: Alignment.centerLeft,
        child: Padding(
          padding: const EdgeInsets.only(left: 6),
          child: IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            icon: const Icon(
              Icons.chevron_left_rounded,
              color: Colors.white,
              size: 28,
            ),
            splashRadius: 20,
          ),
        ),
      ),
    );
  }
}

class _HeaderOrb extends StatelessWidget {
  const _HeaderOrb();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Lottie.asset(
        AgentCreatePage._orbLottieAsset,
        width: 92,
        height: 92,
        fit: BoxFit.contain,
        repeat: true,
        errorBuilder: (context, error, stackTrace) {
          return const _FallbackOrb(size: 62);
        },
      ),
    );
  }
}

class _IntroText extends StatelessWidget {
  const _IntroText();

  @override
  Widget build(BuildContext context) {
    return const _AnimatedIntroText();
  }
}

class _AnimatedIntroText extends StatefulWidget {
  const _AnimatedIntroText();

  @override
  State<_AnimatedIntroText> createState() => _AnimatedIntroTextState();
}

class _AnimatedIntroTextState extends State<_AnimatedIntroText> {
  static const String _fullText = '我是Ta的@天之灵\n你的每句话，都在唤醒我的记忆\n准备唤醒我了吗？';
  static const Duration _baseDelay = Duration(milliseconds: 78);

  late final List<int> _runes = _fullText.runes.toList();
  int _visibleCount = 0;

  @override
  void initState() {
    super.initState();
    _playTypewriter();
  }

  Future<void> _playTypewriter() async {
    await Future<void>.delayed(const Duration(milliseconds: 220));
    for (var index = 0; index < _runes.length; index++) {
      if (!mounted) {
        return;
      }

      setState(() {
        _visibleCount = index + 1;
      });

      await Future<void>.delayed(_delayForRune(_runes[index]));
    }
  }

  Duration _delayForRune(int rune) {
    final char = String.fromCharCode(rune);
    if (char == '\n') {
      return const Duration(milliseconds: 300);
    }
    if ('，。！？'.contains(char)) {
      return const Duration(milliseconds: 190);
    }
    if (char == '、') {
      return const Duration(milliseconds: 150);
    }
    return _baseDelay;
  }

  @override
  Widget build(BuildContext context) {
    const textStyle = TextStyle(
      color: Colors.white,
      fontSize: 20,
      height: 1.8,
      fontWeight: FontWeight.w600,
    );

    final visibleText = String.fromCharCodes(_runes.take(_visibleCount));

    return Text(visibleText, textAlign: TextAlign.center, style: textStyle);
  }
}

class _FallbackOrb extends StatelessWidget {
  const _FallbackOrb({required this.size});

  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: const RadialGradient(
          colors: [
            Color(0xFFF4E9FF),
            Color(0xFFA2BEFF),
            Color(0xFF7B69F0),
            Color(0xFF2D2C68),
          ],
          stops: [0, 0.36, 0.7, 1],
        ),
        boxShadow: const [
          BoxShadow(color: Color(0x554A76FF), blurRadius: 18, spreadRadius: 2),
        ],
      ),
    );
  }
}
