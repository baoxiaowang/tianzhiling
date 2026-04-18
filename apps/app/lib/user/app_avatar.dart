import 'package:flutter/material.dart';

class AppAvatar extends StatelessWidget {
  const AppAvatar({
    super.key,
    required this.imageUrl,
    required this.size,
    this.borderRadius,
    this.iconSize,
    this.placeholderColor = const Color(0xFFE5E7EB),
  });

  final String imageUrl;
  final double size;
  final BorderRadius? borderRadius;
  final double? iconSize;
  final Color placeholderColor;

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? BorderRadius.circular(size / 2);
    final trimmedUrl = imageUrl.trim();

    return ClipRRect(
      borderRadius: radius,
      child: ColoredBox(
        color: placeholderColor,
        child: trimmedUrl.isEmpty
            ? _buildFallback()
            : Image.network(
                trimmedUrl,
                width: size,
                height: size,
                fit: BoxFit.cover,
                loadingBuilder: (context, child, loadingProgress) {
                  if (loadingProgress == null) {
                    return child;
                  }

                  return SizedBox(
                    width: size,
                    height: size,
                    child: Center(
                      child: SizedBox(
                        width: size * 0.36,
                        height: size * 0.36,
                        child: const CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ),
                  );
                },
                errorBuilder: (context, error, stackTrace) {
                  return _buildFallback();
                },
              ),
      ),
    );
  }

  Widget _buildFallback() {
    return SizedBox(
      width: size,
      height: size,
      child: Icon(
        Icons.person_rounded,
        color: const Color(0xFF9CA3AF),
        size: iconSize ?? size * 0.5,
      ),
    );
  }
}
