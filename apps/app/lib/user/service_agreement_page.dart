
import 'package:flutter/material.dart';

class ServiceAgreementPage extends StatelessWidget {
  const ServiceAgreementPage({super.key});

  static const String routeName = '/service-agreement';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      appBar: AppBar(
        backgroundColor: Colors.white,
        surfaceTintColor: Colors.white,
        elevation: 0,
        title: const Text('服务协议', style: TextStyle(color: Color(0xFF1A1A1A), fontSize: 17, fontWeight: FontWeight.w600)),
      ),
      body: const SingleChildScrollView(
        padding: EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('天之灵用户服务协议', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700, color: Color(0xFF1A1A1A))),
            SizedBox(height: 8),
            Text('更新日期：2025年7月', style: TextStyle(fontSize: 13, color: Color(0xFF999999))),
            SizedBox(height: 24),
            _Section(title: '一、服务说明', body: '天之灵是一款基于人工智能技术的数字纪念服务，旨在帮助用户保存与已故亲人的记忆与交流体验。本服务仅供个人纪念用途，不构成任何法律意义上的身份认证或权利主张。'),
            _Section(title: '二、用户责任', body: '用户应确保上传内容合法合规，不侵犯他人权益。用户对其在天之灵平台上的所有行为承担法律责任。禁止利用本服务从事任何违法违规活动。'),
            _Section(title: '三、隐私保护', body: '我们高度重视用户隐私，所有上传的聊天记录、语音、图片等个人信息均经过加密存储。未经用户明确授权，不会向任何第三方提供用户数据。详细隐私政策请查看《天之灵隐私政策》。'),
            _Section(title: '四、会员服务', body: '会员服务按所选套餐提供相应权益。自动续费会员可在当前周期结束前取消续费，已支付费用不予退还。价格如有调整，将在生效前提前通知。'),
            _Section(title: '五、免责声明', body: '天之灵提供的AI生成内容仅供参考和纪念用途。由于技术限制，AI生成内容可能与实际情况存在差异。我们持续优化服务，但不保证服务的完全准确性、及时性或完整性。'),
            _Section(title: '六、联系方式', body: '如有任何疑问或建议，请联系客服：\n电话：18062525425\n邮箱：support@tianzhiling.chat'),
          ],
        ),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.body});
  final String title;
  final String body;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600, color: Color(0xFF333333))),
          const SizedBox(height: 8),
          Text(body, style: const TextStyle(fontSize: 14, height: 1.6, color: Color(0xFF666666))),
        ],
      ),
    );
  }
}
