require('ts-node/register');

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  MongoObjectId,
} = require('@tzl/entities');
const {
  buildObjectIdFromLegacyId,
  createBsonDumpWriter,
  readBsonDocuments,
} = require('./lib/migration');
const {
  DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
  VOICE_TASK_REMARK,
  buildMembershipDocuments,
  buildOrderDocument,
  classifyGoods,
  buildVoiceTimbreDocument,
  buildVoiceTrainingTaskDocument,
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
      'g-voice',
      {
        goods_id: 'g-voice',
        goods_name: '声音模型',
        goods_type: 'voice',
        goods_money: '299.00',
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
        speaker_id: 'speaker-1',
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
  const speakersById = new Map([
    [
      'speaker-1',
      {
        speaker_id: 'speaker-1',
        audios_url: 'https://legacy.example.com/audio/source.mp3',
        audio_state: '2',
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
  const voiceOrderResult = buildOrderDocument(
    {
      order_id: 'o-voice',
      user_id: 'u-1',
      agent_id: 'a-1',
      goods_id: 'g-voice',
      total_money: '299.00',
      order_state: 'PAY_SUCCESS',
      pay_time: new Date('2026-03-01T00:00:00.000Z'),
      create_time: new Date('2026-02-28T00:00:00.000Z'),
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

  assert.ok(paidOrderResult);
  assert.strictEqual(paidOrderResult.document.status, 'completed');
  assert.strictEqual(paidOrderResult.document.orderType, 'vip_plan');
  assert.ok(paidOrderResult.document.userId instanceof MongoObjectId);
  assert.ok(paidOrderResult.document.agentId instanceof MongoObjectId);
  assert.strictEqual(report.ownerConflicts.length, 1);
  assert.strictEqual(customOrder, undefined);
  assert.strictEqual(report.skippedCustomServiceOrders.length, 1);
  assert.ok(voiceOrderResult);
  assert.strictEqual(voiceOrderResult.document.orderType, 'voice_package');

  const voiceTimbre = buildVoiceTimbreDocument(voiceOrderResult, {
    now,
    report,
    speakersById,
    stats,
  });

  assert.ok(voiceTimbre);
  assert.strictEqual(
    voiceTimbre._id.toHexString(),
    legacyHex('voice-timbre:o-voice')
  );
  assert.strictEqual(voiceTimbre.provider, 'minimax');
  assert.strictEqual(voiceTimbre.name, '历史音色-测试智能体-a-1');
  assert.strictEqual(voiceTimbre.providerVoiceId, 'TzlVoice_legacy_o_voice');
  assert.strictEqual(
    voiceTimbre.audioObjectKey,
    'https://legacy.example.com/audio/source.mp3'
  );
  assert.strictEqual(
    voiceTimbre.audioUrl,
    'https://legacy.example.com/audio/source.mp3'
  );
  assert.strictEqual(voiceTimbre.cloneLanguage, 'auto');
  assert.strictEqual(voiceTimbre.status, 'failed');
  assert.strictEqual(voiceTimbre.errorCode, 'LEGACY_VOICE_PENDING_TRAINING');
  assert.strictEqual(
    voiceTimbre.previewText,
    DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT
  );

  const voiceTask = buildVoiceTrainingTaskDocument(voiceOrderResult, {
    now,
    report,
    stats,
    voiceTimbreId: voiceTimbre._id,
  });

  assert.ok(voiceTask);
  assert.strictEqual(
    voiceTask._id.toHexString(),
    legacyHex('voice-training-task:o-voice')
  );
  assert.strictEqual(
    voiceTask.orderId.toHexString(),
    legacyHex('order:o-voice')
  );
  assert.strictEqual(
    voiceTask.voicePackageId.toHexString(),
    legacyHex('voice-package:g-voice')
  );
  assert.strictEqual(voiceTask.voicePackageCode, 'legacy_voice_package_g_voice');
  assert.strictEqual(voiceTask.status, 'paid');
  assert.strictEqual(voiceTask.assigneeName, '');
  assert.deepStrictEqual(voiceTask.materialObjectKeys, []);
  assert.strictEqual(
    voiceTask.voiceTimbreId.toHexString(),
    voiceTimbre._id.toHexString()
  );
  assert.strictEqual(voiceTask.remark, VOICE_TASK_REMARK);
  assert.strictEqual(
    voiceTask.paidAt.toISOString(),
    '2026-03-01T00:00:00.000Z'
  );
  assert.strictEqual(voiceTask.updatedAt.toISOString(), now.toISOString());

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
    collectionNames: ['order', 'voice_training_task', 'voice_timbre'],
    dbDumpPath: tmpDir,
  });

  writer.write('order', paidOrderResult.document);
  writer.write('voice_timbre', voiceTimbre);
  writer.write('voice_training_task', voiceTask);
  await writer.close();

  const docs = [];
  for await (const doc of readBsonDocuments(path.join(tmpDir, 'order.bson'))) {
    docs.push(doc);
  }

  assert.strictEqual(docs.length, 1);
  assert.ok(docs[0]._id instanceof MongoObjectId);
  assert.ok(docs[0].userId instanceof MongoObjectId);
  assert.strictEqual(docs[0].payableAmount, 199);

  const taskDocs = [];
  for await (const doc of readBsonDocuments(
    path.join(tmpDir, 'voice_training_task.bson')
  )) {
    taskDocs.push(doc);
  }

  assert.strictEqual(taskDocs.length, 1);
  assert.ok(taskDocs[0]._id instanceof MongoObjectId);
  assert.strictEqual(taskDocs[0].status, 'paid');
  assert.strictEqual(
    taskDocs[0].voicePackageCode,
    'legacy_voice_package_g_voice'
  );

  const timbreDocs = [];
  for await (const doc of readBsonDocuments(
    path.join(tmpDir, 'voice_timbre.bson')
  )) {
    timbreDocs.push(doc);
  }

  assert.strictEqual(timbreDocs.length, 1);
  assert.ok(timbreDocs[0]._id instanceof MongoObjectId);
  assert.strictEqual(timbreDocs[0].status, 'failed');
  assert.strictEqual(
    timbreDocs[0].audioUrl,
    'https://legacy.example.com/audio/source.mp3'
  );
}

function createStats() {
  return {
    expiredMembershipAgents: 0,
    missingAgentOrders: 0,
    missingGoodsOrders: 0,
    missingUserMembershipAgents: 0,
    missingUserOrders: 0,
    ownerConflictOrders: 0,
    skippedVoiceTimbreMissingAudio: 0,
    skippedVoiceTimbres: 0,
    skippedVoiceTrainingTaskMissingAgents: 0,
    skippedVoiceTrainingTaskNonPaidOrders: 0,
    skippedVoiceTrainingTasks: 0,
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
    skippedVoiceTimbreMissingAudio: [],
    skippedVoiceTrainingTaskMissingAgents: [],
    skippedVoiceTrainingTaskNonPaidOrders: [],
    unsupportedGoods: [],
  };
}

function legacyHex(value) {
  return buildObjectIdFromLegacyId(value).toHexString();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
