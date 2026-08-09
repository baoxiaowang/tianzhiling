import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class MessengerHeader extends StatelessWidget {
  const MessengerHeader({super.key, required this.name, required this.description});

  final String name;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: const Color(0xFFEEEBF2)),
      ),
      child: Column(
        children: [
          SizedBox(
            width: 60,
            height: 60,
            child: Stack(
              alignment: Alignment.center,
              children: [
                Positioned.fill(
                  child: Container(
                    decoration: const BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [Color(0x3884A8FF), Color(0x1A9673E7), Colors.transparent],
                        stops: [0, 0.45, 0.72],
                      ),
                    ),
                  ),
                ),
                Container(
                  width: 60,
                  height: 60,
                  decoration: const BoxDecoration(
                    shape: BoxShape.circle,
                    boxShadow: [BoxShadow(color: Color(0x33647FDC), blurRadius: 12)],
                  ),
                  child: ClipOval(
                    child: Container(
                      decoration: const BoxDecoration(
                        gradient: RadialGradient(
                          colors: [Color(0xFFE8D5FF), Color(0xFFA78BFA), Color(0xFF6C5CE7)],
                          stops: [0, 0.45, 1],
                        ),
                      ),
                    ),
                  ),
                ),
                const Icon(CupertinoIcons.sparkles, color: Colors.white, size: 22),
              ],
            ),
          ),
          const SizedBox(height: 8),
          Text(name, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: Color(0xFF333152))),
          const SizedBox(height: 2),
          Text(description, style: const TextStyle(fontSize: 12, color: Color(0xFF8A8791))),
        ],
      ),
    );
  }
}
