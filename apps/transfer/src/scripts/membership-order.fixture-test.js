require('ts-node/register');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MongoObjectId,
} = require('@tzl/entities');
const {
  createBsonDumpWriter,
  readBsonDocuments,
} = require('./lib/migration');
const {
  buildMembershipDocuments,
  buildOrderDocument,
  classifyGoods,
  normalizeLegacyOrderStatus,
} = require('./membership-order');

async function main() {
  assert.strictEqual(normalizeLegacyOrderStatus('PAY_SUCCESS'), 'completed');
  assert.strictEqual(normalizeLegacyOrderStatus('REFUND_SUCCESS'), 'refunded');
  assert.strictEqual(normalizeLegacyOrderStatus('WAIT_PAY'), 'closed');
  assert.strictEqual(classifyGoods({ goods_name: '定制服务' }), 'custom_service');

  const now = new Date('2026-05-26T00:00:00.000Z');
  const goodsById = new Map([
    [
      'g-year',
      {
        goods_id: 'g-year',
        goods_name: '一年会员',
        goods_type: 'member',
        goods_money: '199.00',
      },
    ],
    [
      'g-custom',
      {
        goods_id: 'g-custom',
        goods_name: '定制服务',
        goods_type: 'custom_service',
        goods_money: '399.00',
      },
    ],
  ]);
  const agentsById = new Map([
    [
      'a-1',
      {
        agent_id: 'a-1',
        create_user_id: 'u-1',
        agent_name: '测试智能体',
        vip_state: '1',
        pay_time: new Date('2026-01-01T00:00:00.000Z'),
        expiration_time: new Date('2027-01-01T00:00:00.000Z'),
        is_indefinite: '0',
      },
    ],
    [
      'a-2',
      {
        agent_id: 'a-2',
        create_user_id: 'u-1',
        agent_name: '终身智能体',
        vip_state: '1',
        pay_time: new Date('2026-02-01T00:00:00.000Z'),
        expiration_time: new Date('2125-02-01T00:00:00.000Z'),
        is_indefinite: '1',
      },
    ],
  ]);
  const report = createReport();
  const stats = createStats();
  const paidOrderResult = buildOrderDocument(
    {
      order_id: 'o-1',
      user_id: 'payer-1',
      agent_id: 'a-1',
      goods_id: 'g-year',
      total_money: '199.00',
      order_state: 'PAY_SUCCESS',
      pay_time: new Date('2026-01-01T00:00:00.000Z'),
      create_time: new Date('2026-01-01T00:00:00.000Z'),
      apply_refund: '0',
    },
    {
      agentsById,
      goodsById,
      now,
      report,
      stats,
      validUserIds: new Set(['u-1', 'payer-1']),
    }
  );
  const customOrder = buildOrderDocument(
    {
      order_id: 'o-custom',
      user_id: 'u-1',
      agent_id: 'a-1',
      goods_id: 'g-custom',
      total_money: '399.00',
      order_state: 'PAY_SUCCESS',
    },
    {
      agentsById,
      goodsById,
      now,
      report,
      stats,
      validUserIds: new Set(['u-1', 'payer-1']),
    }
  );

  assert.ok(paidOrderResult);
  assert.strictEqual(paidOrderResult.document.status, 'completed');
  assert.strictEqual(paidOrderResult.document.orderType, 'vip_plan');
  assert.ok(paidOrderResult.document.userId instanceof MongoObjectId);
  assert.ok(paidOrderResult.document.agentId instanceof MongoObjectId);
  assert.strictEqual(report.ownerConflicts.length, 1);
  assert.strictEqual(customOrder, undefined);
  assert.strictEqual(report.skippedCustomServiceOrders.length, 1);

  const paidMembershipOrdersByAgentId = new Map([
    ['a-1', [paidOrderResult.document]],
  ]);
  const membershipResult = buildMembershipDocuments({
    agentsById,
    now,
    paidMembershipOrdersByAgentId,
    report,
    stats,
    validUserIds: new Set(['u-1', 'payer-1']),
  });

  assert.strictEqual(membershipResult.memberships.length, 1);
  assert.strictEqual(membershipResult.memberships[0].lifetime, true);
  assert.strictEqual(membershipResult.memberships[0].expiredAt, undefined);
  assert.strictEqual(membershipResult.syntheticOrders.length, 1);
  assert.strictEqual(
    membershipResult.memberships[0].sourceOrderId.toHexString(),
    membershipResult.syntheticOrders[0]._id.toHexString()
  );

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tzl-membership-order-'));
  const writer = createBsonDumpWriter({
    collectionNames: ['order'],
    dbDumpPath: tmpDir,
  });

  writer.write('order', paidOrderResult.document);
  await writer.close();

  const docs = [];
  for await (const doc of readBsonDocuments(path.join(tmpDir, 'order.bson'))) {
    docs.push(doc);
  }

  assert.strictEqual(docs.length, 1);
  assert.ok(docs[0]._id instanceof MongoObjectId);
  assert.ok(docs[0].userId instanceof MongoObjectId);
  assert.strictEqual(docs[0].payableAmount, 199);
}

function createStats() {
  return {
    expiredMembershipAgents: 0,
    missingAgentOrders: 0,
    missingGoodsOrders: 0,
    missingUserMembershipAgents: 0,
    missingUserOrders: 0,
    ownerConflictOrders: 0,
    skippedCustomServiceOrders: 0,
    skippedMembershipAgents: 0,
    skippedOrders: 0,
    skippedTrialMembershipAgents: 0,
    unsupportedGoodsOrders: 0,
  };
}

function createReport() {
  return {
    expiredMembershipAgents: [],
    missingAgents: [],
    missingGoods: [],
    missingOrderIds: [],
    missingUsers: [],
    ownerConflicts: [],
    skippedCustomServiceOrders: [],
    skippedTrialMembershipAgents: [],
    unsupportedGoods: [],
  };
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
