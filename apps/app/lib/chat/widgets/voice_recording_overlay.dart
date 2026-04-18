import 'dart:math' as math;

import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

enum VoiceDragTarget { send, cancel, transcribe }

class VoiceRecordingOverlay extends StatelessWidget {
  const VoiceRecordingOverlay({
    super.key,
    required this.dragTarget,
    required this.bottomSafeArea,
  });

  final VoiceDragTarget dragTarget;
  final double bottomSafeArea;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Color(0x12000000), Color(0xA8000000)],
        ),
      ),
      child: LayoutBuilder(
        builder: (context, constraints) {
          return Stack(
            children: [
              Positioned(
                top: constraints.maxHeight * 0.36,
                left: 0,
                right: 0,
                child: Center(
                  child: _VoiceStatusBubble(dragTarget: dragTarget),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 0,
                child: _VoiceBottomPanel(
                  dragTarget: dragTarget,
                  bottomSafeArea: bottomSafeArea,
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _VoiceStatusBubble extends StatelessWidget {
  const _VoiceStatusBubble({required this.dragTarget});

  final VoiceDragTarget dragTarget;

  @override
  Widget build(BuildContext context) {
    final isCancel = dragTarget == VoiceDragTarget.cancel;
    final isTranscribe = dragTarget == VoiceDragTarget.transcribe;
    final bubbleColor = isCancel
        ? const Color(0xFFE95C4B)
        : isTranscribe
        ? const Color(0xFF22B983)
        : const Color(0xFF39C779);
    final hintText = isCancel
        ? '松开取消'
        : isTranscribe
        ? '松开转文字'
        : '松开发送';

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        AnimatedContainer(
          duration: const Duration(milliseconds: 140),
          width: 178,
          height: 104,
          decoration: BoxDecoration(
            color: bubbleColor,
            borderRadius: BorderRadius.circular(18),
            boxShadow: const [
              BoxShadow(
                color: Color(0x29000000),
                blurRadius: 20,
                offset: Offset(0, 10),
              ),
            ],
          ),
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 14),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Expanded(
                child: Center(
                  child: isCancel
                      ? const Icon(
                          CupertinoIcons.xmark_circle_fill,
                          size: 34,
                          color: Colors.white,
                        )
                      : isTranscribe
                      ? const _VoiceTranscribeGlyph()
                      : const _VoiceWaveform(),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                hintText,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        CustomPaint(
          size: const Size(18, 10),
          painter: _BubbleTailPainter(color: bubbleColor),
        ),
      ],
    );
  }
}

class _VoiceBottomPanel extends StatelessWidget {
  const _VoiceBottomPanel({
    required this.dragTarget,
    required this.bottomSafeArea,
  });

  final VoiceDragTarget dragTarget;
  final double bottomSafeArea;

  @override
  Widget build(BuildContext context) {
    final footerLabel = dragTarget == VoiceDragTarget.cancel
        ? '松开 取消'
        : dragTarget == VoiceDragTarget.transcribe
        ? '松开 转文字'
        : '松开 发送';

    return SizedBox(
      height: 188 + bottomSafeArea,
      child: LayoutBuilder(
        builder: (context, constraints) {
          final chipWidth = math.min(174.0, constraints.maxWidth * 0.44);

          return Stack(
            clipBehavior: Clip.none,
            children: [
              Positioned(
                left: -constraints.maxWidth * 0.16,
                right: -constraints.maxWidth * 0.16,
                bottom: -108,
                child: Container(
                  height: 196 + bottomSafeArea,
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(
                      top: Radius.elliptical(320, 120),
                    ),
                  ),
                ),
              ),
              Positioned(
                left: 8,
                bottom: 102 + bottomSafeArea,
                child: Transform.rotate(
                  angle: -0.10,
                  child: _VoiceActionChip(
                    label: '取消',
                    width: chipWidth,
                    isActive: dragTarget == VoiceDragTarget.cancel,
                    activeColor: const Color(0xFFE95C4B),
                  ),
                ),
              ),
              Positioned(
                right: 8,
                bottom: 102 + bottomSafeArea,
                child: Transform.rotate(
                  angle: 0.10,
                  child: _VoiceActionChip(
                    label: '滑到这里 转文字',
                    width: chipWidth,
                    isActive: dragTarget == VoiceDragTarget.transcribe,
                    activeColor: const Color(0xFF07C160),
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 78 + bottomSafeArea,
                child: const Text(
                  '上滑取消，右滑转文字',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Color(0xE6FFFFFF),
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
              Positioned(
                left: 0,
                right: 0,
                bottom: 24 + bottomSafeArea,
                child: Text(
                  footerLabel,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    color: Color(0xFF111111),
                    fontSize: 27,
                    height: 1.1,
                    fontWeight: FontWeight.w500,
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

class _VoiceActionChip extends StatelessWidget {
  const _VoiceActionChip({
    required this.label,
    required this.width,
    required this.isActive,
    required this.activeColor,
  });

  final String label;
  final double width;
  final bool isActive;
  final Color activeColor;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 140),
      width: width,
      height: 70,
      decoration: BoxDecoration(
        color: isActive ? activeColor : const Color(0xE61C1C1E),
        borderRadius: BorderRadius.circular(999),
        boxShadow: const [
          BoxShadow(
            color: Color(0x33000000),
            blurRadius: 14,
            offset: Offset(0, 8),
          ),
        ],
      ),
      alignment: Alignment.center,
      child: Text(
        label,
        style: TextStyle(
          color: Colors.white,
          fontSize: label.length > 4 ? 18 : 20,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _VoiceTranscribeGlyph extends StatelessWidget {
  const _VoiceTranscribeGlyph();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 46,
      height: 46,
      decoration: BoxDecoration(
        color: const Color(0x20FFFFFF),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0x55FFFFFF), width: 1),
      ),
      alignment: Alignment.center,
      child: const Text(
        '文',
        style: TextStyle(
          color: Colors.white,
          fontSize: 26,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _VoiceWaveform extends StatefulWidget {
  const _VoiceWaveform();

  @override
  State<_VoiceWaveform> createState() => _VoiceWaveformState();
}

class _VoiceWaveformState extends State<_VoiceWaveform>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1200),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        return Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.center,
          children: List<Widget>.generate(17, (index) {
            final phase = (_controller.value * math.pi * 2) + index * 0.48;
            final normalized = 0.35 + math.sin(phase).abs() * 0.65;
            final barHeight = 6 + normalized * 18;

            return Padding(
              padding: const EdgeInsets.symmetric(horizontal: 1.2),
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 90),
                width: index.isEven ? 2.2 : 2.8,
                height: barHeight,
                decoration: BoxDecoration(
                  color: const Color(0xC61B5E39),
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            );
          }),
        );
      },
    );
  }
}

class _BubbleTailPainter extends CustomPainter {
  const _BubbleTailPainter({required this.color});

  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = color;
    final path = Path()
      ..moveTo(size.width / 2, size.height)
      ..lineTo(0, 0)
      ..lineTo(size.width, 0)
      ..close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _BubbleTailPainter oldDelegate) {
    return oldDelegate.color != color;
  }
}
