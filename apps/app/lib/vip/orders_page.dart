import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';

class OrdersPage extends StatelessWidget {
  const OrdersPage({super.key});

  static const String routeName = '/orders';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF7F7F7),
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('订单管理', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
      ),
      body: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(CupertinoIcons.doc_text, size: 56, color: Color(0xFFCCCCCC)),
            SizedBox(height: 16),
            Text('暂无订单记录', style: TextStyle(color: Color(0xFF999999), fontSize: 15)),
            SizedBox(height: 4),
            Text('购买会员后，订单会显示在这里', style: TextStyle(color: Color(0xFFCCCCCC), fontSize: 13)),
          ],
        ),
      ),
    );
  }
}
