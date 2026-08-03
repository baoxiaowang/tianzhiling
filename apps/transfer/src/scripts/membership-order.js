require('ts-node/register');

const fs = require('fs');
const path = require('path');
const {
  closeMysqlTransferConnection,
  createMysqlTransferContext,
} = require('../runtime');
const {
  MIGRATION_NAMESPACE,
  buildObjectIdFromLegacyId,
  createBsonDumpWriter,
  ensureParentDir,
  normalizeDate,
  normalizeString,
  readEnv,
  readMode,
  readNumberEnv,
  resolveDumpPath,
} = require('./lib/migration');

const DEFAULT_BATCH_SIZE = 500;
const ORDER_COLLECTION = 'order';
const USER_MEMBERSHIP_COLLECTION = 'user_membership';
const VOICE_TRAINING_TASK_COLLECTION = 'voice_training_task';
const VOICE_TIMBRE_COLLECTION = 'voice_timbre';
const LEGACY_PAYMENT_PROVIDER = 'legacy_wechat';
const CURRENCY = 'CNY';
const LEGACY_SOURCE_MONEY_UNIT = 'yuan';
const STORED_MONEY_UNIT = 'fen';
const VOICE_TASK_REMARK = '历史声音套餐迁移，需人工训练后完成';
const DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT =
  '我好想你，最近过得好吗，有没有好好吃饭';
const LEGACY_VOICE_TIMBRE_ERROR_CODE = 'LEGACY_VOICE_PENDING_TRAINING';
const LEGACY_VOICE_TIMBRE_ERROR_MESSAGE =
  '历史音色素材迁移，点击重试开始训练';
const LEGACY_VOICE_TIMBRE_NAME_MAX_LENGTH = 60;

const LEGACY_ORDER_STATUS_TO_NEW = {
  PAY_SUCCESS: 'completed',
  REFUND_SUCCESS: 'refunded',
  WAIT_PAY: 'closed',
  PAYING: 'closed',
  PAY_FAILED: 'closed',
  REFUNDING: 'closed',
  REFUND_FAILED: 'closed',
};

async function main() {
  const mode = readMode({
    allowedValues: ['export'],
    defaultValue: 'export',
    envName: 'TRANSFER_MEMBERSHIP_ORDER_MODE',
  });
  const dumpPath = resolveDumpPath({
    defaultPath: path.resolve(__dirname, '../../dump'),
    envNames: [
      'TRANSFER_MEMBERSHIP_ORDER_DUMP_PATH',
      'TRANSFER_POST_COMMENT_DUMP_PATH',
      'TRANSFER_POST_DUMP_PATH',
      'TRANSFER_MESSAGE_DUMP_PATH',
      'TRANSFER_CONVERSATION_DUMP_PATH',
      'TRANSFER_AGENT_DUMP_PATH',
      'TRANSFER_USER_DUMP_PATH',
    ],
  });

  if (mode === 'export') {
    await exportMembershipOrdersToBson(dumpPath);
  }
}

async function exportMembershipOrdersToBson(dumpPath) {
  const context = await createMysqlTransferContext();

  try {
    await exportMembershipOrders(context, dumpPath);
  } finally {
    await closeMysqlTransferConnection(context);
  }
}

async function exportMembershipOrders(context, dumpPath) {
  const batchSize = readNumberEnv(
    'TRANSFER_MEMBERSHIP_ORDER_BATCH_SIZE',
    DEFAULT_BATCH_SIZE
  );
  const dbName = readEnv('TRANSFER_MONGO_DATABASE', 'tzl');
  const dbDumpPath = path.join(dumpPath, dbName);
  const now = new Date();
  const stats = createInitialStats();

  context.logger.info('[membership-order] bson export started', {
    batchSize,
    dumpPath,
    dbName,
  });

  const [validUserIds, agentsById, goodsById, speakersById, orderRows] =
    await Promise.all([
      fetchValidUserIds(context, batchSize),
      fetchAgentsById(context, batchSize),
      fetchGoodsById(context, batchSize),
      fetchSpeakersById(context, batchSize),
      fetchOrders(context, batchSize),
    ]);

  const writer = createBsonDumpWriter({
    collectionNames: [
      ORDER_COLLECTION,
      USER_MEMBERSHIP_COLLECTION,
      VOICE_TRAINING_TASK_COLLECTION,
      VOICE_TIMBRE_COLLECTION,
    ],
    dbDumpPath,
  });
  const report = createInitialReport();
  const paidMembershipOrdersByAgentId = new Map();
  const writtenOrderIds = new Set();

  try {
    for (const orderRow of orderRows) {
      stats.scannedOrders += 1;

      const result = buildOrderDocument(orderRow, {
        agentsById,
        goodsById,
        validUserIds,
        now,
        report,
        stats,
      });

      if (!result) {
        continue;
      }

      writer.write(ORDER_COLLECTION, result.document);
      writtenOrderIds.add(result.legacyOrderId);
      stats.exportedOrders += 1;

      const voiceTimbre = buildVoiceTimbreDocument(result, {
        now,
        report,
        speakersById,
        stats,
      });

      if (voiceTimbre) {
        writer.write(VOICE_TIMBRE_COLLECTION, voiceTimbre);
        stats.exportedVoiceTimbres += 1;
      }

      const voiceTrainingTask = buildVoiceTrainingTaskDocument(result, {
        now,
        report,
        stats,
        voiceTimbreId: voiceTimbre?._id,
      });

      if (voiceTrainingTask) {
        writer.write(VOICE_TRAINING_TASK_COLLECTION, voiceTrainingTask);
        stats.exportedVoiceTrainingTasks += 1;
      }

      if (
        result.isPaidMembershipOrder &&
        result.legacyAgentId &&
        result.document.status === 'completed'
      ) {
        appendMapList(
          paidMembershipOrdersByAgentId,
          result.legacyAgentId,
          result.document
        );
      }
    }

    const membershipResults = buildMembershipDocuments({
      agentsById,
      now,
      paidMembershipOrdersByAgentId,
      report,
      stats,
      validUserIds,
    });

    for (const syntheticOrder of membershipResults.syntheticOrders) {
      writer.write(ORDER_COLLECTION, syntheticOrder);
      stats.exportedOrders += 1;
      stats.exportedSyntheticOrders += 1;
    }

    for (const membership of membershipResults.memberships) {
      writer.write(USER_MEMBERSHIP_COLLECTION, membership);
      stats.exportedMemberships += 1;
    }
  } finally {
    await writer.close();
  }

  writeReport(dbDumpPath, {
    ...report,
    stats,
    generatedAt: now.toISOString(),
    skippedOrderIdsAlreadyWritten: writtenOrderIds.size,
  });

  context.logger.info('[membership-order] bson export completed', {
    ...stats,
    dumpPath,
    dbName,
    reportPath: path.join(dbDumpPath, 'membership-order.report.json'),
  });
}

async function fetchValidUserIds(context, batchSize) {
  const rows = await fetchPagedRows(context, {
    batchSize,
    logPrefix: '[membership-order] user preload',
    orderBy: 'id ASC',
    select: 'user_id',
    table: 'user_info',
    where: 'COALESCE(logical_del, 0) = 0',
  });

  return new Set(rows.map(row => normalizeString(row.user_id)).filter(Boolean));
}

async function fetchAgentsById(context, batchSize) {
  const rows = await fetchPagedRows(context, {
    batchSize,
    logPrefix: '[membership-order] agent preload',
    orderBy: 'id ASC',
    select: [
      'agent_id',
      'create_user_id',
      'agent_name',
      'agent_img',
      'vip_state',
      'pay_time',
      'expiration_time',
      'is_indefinite',
      'voice_state',
      'voice_material',
      'speaker_id',
      'is_customized',
      'create_time',
    ].join(', '),
    table: 'agent',
    where: 'COALESCE(logical_del, 0) = 0',
  });
  const agentsById = new Map();

  for (const row of rows) {
    const legacyAgentId = normalizeString(row.agent_id);

    if (!legacyAgentId) {
      continue;
    }

    agentsById.set(legacyAgentId, row);
  }

  return agentsById;
}

async function fetchSpeakersById(context, batchSize) {
  const rows = await fetchPagedRows(context, {
    batchSize,
    logPrefix: '[membership-order] speaker preload',
    orderBy: 'id ASC',
    select: [
      'speaker_id',
      'audios_url',
      'audio_format',
      'audio_state',
      'train_num',
    ].join(', '),
    table: 'speaker',
    where: 'COALESCE(logical_del, 0) = 0',
  });
  const speakersById = new Map();

  for (const row of rows) {
    const legacySpeakerId = normalizeString(row.speaker_id);

    if (!legacySpeakerId) {
      continue;
    }

    speakersById.set(legacySpeakerId, row);
  }

  return speakersById;
}

async function fetchGoodsById(context, batchSize) {
  const rows = await fetchPagedRows(context, {
    batchSize,
    logPrefix: '[membership-order] goods preload',
    orderBy: 'id ASC',
    select: [
      'goods_id',
      'goods_name',
      'goods_type',
      'goods_money',
      'goods_desc',
      'create_time',
    ].join(', '),
    table: 'goods',
    where: 'COALESCE(logical_del, 0) = 0',
  });
  const goodsById = new Map();

  for (const row of rows) {
    const legacyGoodsId = normalizeString(row.goods_id);

    if (!legacyGoodsId) {
      continue;
    }

    goodsById.set(legacyGoodsId, row);
  }

  return goodsById;
}

async function fetchOrders(context, batchSize) {
  return fetchPagedRows(context, {
    batchSize,
    logPrefix: '[membership-order] order scan',
    orderBy: 'id ASC',
    select: [
      'id',
      'order_id',
      'user_id',
      'agent_id',
      'goods_id',
      'total_money',
      'order_state',
      'pay_time',
      'out_refund_no',
      'refund_id',
      'reason',
      'refund_time',
      'create_time',
      'description',
      'apply_refund',
    ].join(', '),
    table: '`order`',
    where: 'COALESCE(logical_del, 0) = 0',
  });
}

async function fetchPagedRows(context, options) {
  const rows = [];
  let offset = 0;

  for (;;) {
    const [batchRows] = await context.mysql.query(
      `
        SELECT ${options.select}
        FROM ${options.table}
        WHERE ${options.where}
        ORDER BY ${options.orderBy}
        LIMIT ? OFFSET ?
      `,
      [options.batchSize, offset]
    );

    rows.push(...batchRows);
    offset += batchRows.length;
    context.logger.info(`${options.logPrefix} batch completed`, {
      scanned: rows.length,
      offset,
    });

    if (batchRows.length < options.batchSize) {
      break;
    }
  }

  return rows;
}

function buildOrderDocument(row, context) {
  const legacyOrderId = normalizeString(row.order_id);
  const legacyUserId = normalizeString(row.user_id);
  const legacyAgentId = normalizeString(row.agent_id);
  const legacyGoodsId = normalizeString(row.goods_id);
  const goods = context.goodsById.get(legacyGoodsId);
  const agent = context.agentsById.get(legacyAgentId);

  if (!legacyOrderId) {
    context.stats.skippedOrders += 1;
    context.report.missingOrderIds.push(buildOrderReportRow(row));
    return undefined;
  }

  if (!legacyUserId || !context.validUserIds.has(legacyUserId)) {
    context.stats.skippedOrders += 1;
    context.stats.missingUserOrders += 1;
    context.report.missingUsers.push(buildOrderReportRow(row));
    return undefined;
  }

  if (!goods) {
    context.stats.skippedOrders += 1;
    context.stats.missingGoodsOrders += 1;
    context.report.missingGoods.push(buildOrderReportRow(row));
    return undefined;
  }

  const goodsKind = classifyGoods(goods);

  if (goodsKind === 'custom_service') {
    context.stats.skippedOrders += 1;
    context.stats.skippedCustomServiceOrders += 1;
    context.report.skippedCustomServiceOrders.push(
      buildOrderReportRow(row, goods, agent)
    );
    return undefined;
  }

  if (!goodsKind) {
    context.stats.skippedOrders += 1;
    context.stats.unsupportedGoodsOrders += 1;
    context.report.unsupportedGoods.push(buildOrderReportRow(row, goods, agent));
    return undefined;
  }

  if (legacyAgentId && !agent) {
    context.stats.missingAgentOrders += 1;
    context.report.missingAgents.push(buildOrderReportRow(row, goods));
  }

  if (agent) {
    const ownerUserId = normalizeString(agent.create_user_id);

    if (ownerUserId && ownerUserId !== legacyUserId) {
      context.stats.ownerConflictOrders += 1;
      context.report.ownerConflicts.push(buildOrderReportRow(row, goods, agent));
    }
  }

  const status = normalizeLegacyOrderStatus(row.order_state);
  const createdAt = normalizeDate(row.create_time) || context.now;
  const paidAt = normalizeDate(row.pay_time);
  const refundedAt = normalizeDate(row.refund_time);
  const updatedAt = refundedAt || paidAt || createdAt;
  const target = buildTarget(goods, goodsKind);
  const payableAmount = normalizeMoney(row.total_money, goods.goods_money);
  const document = {
    _id: legacyObjectId(`order:${legacyOrderId}`),
    orderNo: legacyOrderId,
    userId: legacyObjectId(legacyUserId),
    orderType: goodsKind === 'voice_package' ? 'voice_package' : 'vip_plan',
    targetId: target.id,
    targetCode: target.code,
    title: normalizeString(goods.goods_name) || target.name,
    amount: payableAmount,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount,
    currency: CURRENCY,
    status,
    source: 'weapp',
    paymentProvider: LEGACY_PAYMENT_PROVIDER,
    snapshot: buildOrderSnapshot({
      agent,
      goods,
      goodsKind,
      legacyAgentId,
      legacyGoodsId,
      legacyOrderId,
      legacyUserId,
      row,
      target,
    }),
    createdAt,
    updatedAt,
  };

  if (agent && legacyAgentId) {
    document.agentId = legacyObjectId(`agent:${legacyAgentId}`);
  }

  if (status === 'completed' || status === 'refunded') {
    document.paidAmount = payableAmount;
    document.paidAt = paidAt || updatedAt;
    document.paymentNotifyAt = paidAt || updatedAt;
  }

  if (status === 'refunded') {
    document.refundAmount = payableAmount;
    document.refundedAt = refundedAt || updatedAt;
  }

  if (status === 'closed') {
    document.closedAt = updatedAt;
  }

  return {
    agent,
    document,
    goodsKind,
    isPaidMembershipOrder:
      goodsKind === 'year_member' || goodsKind === 'lifetime_member',
    legacyAgentId,
    legacyGoodsId,
    legacyOrderId,
  };
}

function buildVoiceTrainingTaskDocument(orderResult, context) {
  const order = orderResult.document;

  if (orderResult.goodsKind !== 'voice_package') {
    return undefined;
  }

  if (order.status !== 'completed') {
    context.stats.skippedVoiceTrainingTasks += 1;
    context.stats.skippedVoiceTrainingTaskNonPaidOrders += 1;
    context.report.skippedVoiceTrainingTaskNonPaidOrders.push(
      buildVoiceTrainingTaskReportRow(orderResult)
    );
    return undefined;
  }

  if (!order.agentId) {
    context.stats.skippedVoiceTrainingTasks += 1;
    context.stats.skippedVoiceTrainingTaskMissingAgents += 1;
    context.report.skippedVoiceTrainingTaskMissingAgents.push(
      buildVoiceTrainingTaskReportRow(orderResult)
    );
    return undefined;
  }

  const createdAt = order.paidAt || order.createdAt || context.now;

  const task = {
    _id: legacyObjectId(`voice-training-task:${orderResult.legacyOrderId}`),
    userId: order.userId,
    agentId: order.agentId,
    orderId: order._id,
    voicePackageId: order.targetId,
    voicePackageCode: order.targetCode,
    status: 'paid',
    assigneeName: '',
    materialObjectKeys: [],
    remark: VOICE_TASK_REMARK,
    paidAt: createdAt,
    createdAt,
    updatedAt: context.now,
  };

  if (context.voiceTimbreId) {
    task.voiceTimbreId = context.voiceTimbreId;
  }

  return task;
}

function buildVoiceTimbreDocument(orderResult, context) {
  const order = orderResult.document;

  if (
    orderResult.goodsKind !== 'voice_package' ||
    order.status !== 'completed'
  ) {
    return undefined;
  }

  if (!order.agentId) {
    return undefined;
  }

  const source = resolveLegacyVoiceAudioSource(
    orderResult.agent,
    context.speakersById
  );

  if (!source.url) {
    context.stats.skippedVoiceTimbres += 1;
    context.stats.skippedVoiceTimbreMissingAudio += 1;
    context.report.skippedVoiceTimbreMissingAudio.push(
      buildVoiceTrainingTaskReportRow(orderResult)
    );
    return undefined;
  }

  const createdAt = order.paidAt || order.createdAt || context.now;

  return {
    _id: legacyObjectId(`voice-timbre:${orderResult.legacyOrderId}`),
    name: buildLegacyVoiceTimbreName(orderResult),
    provider: 'minimax',
    providerVoiceId: buildLegacyProviderVoiceId(orderResult.legacyOrderId),
    providerFileId: '',
    audioObjectKey: source.url,
    audioUrl: source.url,
    cloneLanguage: 'auto',
    previewText: DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
    previewModel: '',
    previewAudioUrl: '',
    speechSpeed: 1,
    speechVolume: 1,
    speechPitch: 0,
    status: 'failed',
    errorCode: LEGACY_VOICE_TIMBRE_ERROR_CODE,
    errorMessage: LEGACY_VOICE_TIMBRE_ERROR_MESSAGE,
    remark: buildLegacyVoiceTimbreRemark(orderResult, source),
    createdAt,
    updatedAt: context.now,
  };
}

function buildMembershipDocuments(options) {
  const membershipsByUserId = new Map();
  const syntheticOrders = [];
  const memberships = [];

  for (const [legacyAgentId, agent] of options.agentsById.entries()) {
    options.stats.scannedAgents += 1;

    const legacyUserId = normalizeString(agent.create_user_id);

    if (!legacyUserId || !options.validUserIds.has(legacyUserId)) {
      options.stats.skippedMembershipAgents += 1;
      options.stats.missingUserMembershipAgents += 1;
      options.report.missingUsers.push(buildAgentReportRow(agent));
      continue;
    }

    const vipState = normalizeString(agent.vip_state);
    const isLifetime = normalizeFlag(agent.is_indefinite);
    const isPaidVip = vipState === '1' || isLifetime;

    if (vipState === '2') {
      options.stats.skippedTrialMembershipAgents += 1;
      options.report.skippedTrialMembershipAgents.push(buildAgentReportRow(agent));
      continue;
    }

    if (!isPaidVip) {
      continue;
    }

    const expirationTime = normalizeDate(agent.expiration_time);

    if (!isLifetime && (!expirationTime || expirationTime <= options.now)) {
      options.stats.expiredMembershipAgents += 1;
      options.report.expiredMembershipAgents.push(buildAgentReportRow(agent));
      continue;
    }

    const startedAt =
      normalizeDate(agent.pay_time) ||
      findEarliestPaidAt(
        options.paidMembershipOrdersByAgentId.get(legacyAgentId) || []
      ) ||
      normalizeDate(agent.create_time) ||
      options.now;
    const current =
      membershipsByUserId.get(legacyUserId) ||
      createMembershipAggregate(legacyUserId);

    current.agentIds.push(legacyAgentId);
    current.lifetime = current.lifetime || isLifetime;
    current.startedAt = minDate(current.startedAt, startedAt);
    current.expiredAt = mergeMembershipExpiredAt(
      current.expiredAt,
      expirationTime,
      current.lifetime
    );

    for (const order of options.paidMembershipOrdersByAgentId.get(legacyAgentId) || []) {
      current.sourceOrders.push(order);
    }

    membershipsByUserId.set(legacyUserId, current);
  }

  for (const aggregate of membershipsByUserId.values()) {
    const sourceOrder =
      chooseSourceOrder(aggregate.sourceOrders, aggregate.lifetime) ||
      buildSyntheticMembershipOrder(aggregate, options.now);

    if (sourceOrder.snapshot?.legacy?.migrationGenerated) {
      syntheticOrders.push(sourceOrder);
    }

    if (aggregate.lifetime) {
      options.stats.lifetimeMemberships += 1;
    }

    memberships.push(buildUserMembershipDocument(aggregate, sourceOrder, options.now));
  }

  return {
    memberships,
    syntheticOrders,
  };
}

function createMembershipAggregate(legacyUserId) {
  return {
    agentIds: [],
    expiredAt: undefined,
    legacyUserId,
    lifetime: false,
    sourceOrders: [],
    startedAt: undefined,
  };
}

function buildUserMembershipDocument(aggregate, sourceOrder, now) {
  const vipPlanSnapshot = sourceOrder.snapshot?.vipPlan || {};

  return {
    _id: legacyObjectId(`user-membership:${aggregate.legacyUserId}`),
    userId: legacyObjectId(aggregate.legacyUserId),
    vipPlanId: sourceOrder.targetId || legacyObjectId('vip-plan:legacy-migration'),
    vipPlanCode:
      sourceOrder.targetCode ||
      normalizeString(vipPlanSnapshot.code) ||
      'legacy_migration_member',
    sourceOrderId: sourceOrder._id,
    status: 'active',
    startedAt: aggregate.startedAt || now,
    expiredAt: aggregate.lifetime ? undefined : aggregate.expiredAt,
    lifetime: aggregate.lifetime,
    createdAt: aggregate.startedAt || now,
    updatedAt: now,
  };
}

function buildSyntheticMembershipOrder(aggregate, now) {
  const target = buildSyntheticMembershipTarget(aggregate.lifetime);
  const createdAt = aggregate.startedAt || now;

  return {
    _id: legacyObjectId(`membership-migration:${aggregate.legacyUserId}`),
    orderNo: `MIGRATION-${aggregate.legacyUserId}`,
    userId: legacyObjectId(aggregate.legacyUserId),
    orderType: 'vip_plan',
    targetId: target.id,
    targetCode: target.code,
    title: '历史会员迁移',
    amount: 0,
    discountAmount: 0,
    couponAmount: 0,
    payableAmount: 0,
    paidAmount: 0,
    currency: CURRENCY,
    status: 'completed',
    source: 'admin',
    paymentProvider: 'legacy_migration',
    snapshot: {
      vipPlan: {
        id: objectIdToString(target.id),
        code: target.code,
        name: target.name,
        priceAmount: 0,
        currency: CURRENCY,
        lifetime: aggregate.lifetime,
        benefits: [],
        entitlementGrants: [],
      },
      legacy: {
        namespace: MIGRATION_NAMESPACE,
        migrationGenerated: true,
        userId: aggregate.legacyUserId,
        agentIds: aggregate.agentIds,
      },
    },
    paidAt: createdAt,
    paymentNotifyAt: createdAt,
    createdAt,
    updatedAt: now,
  };
}

function buildOrderSnapshot(options) {
  const legacy = {
    namespace: MIGRATION_NAMESPACE,
    moneyUnit: STORED_MONEY_UNIT,
    sourceMoneyUnit: LEGACY_SOURCE_MONEY_UNIT,
    moneyMigrationVersion: 2,
    orderId: options.legacyOrderId,
    userId: options.legacyUserId,
    agentId: options.legacyAgentId,
    goodsId: options.legacyGoodsId,
    goodsName: normalizeString(options.goods.goods_name),
    goodsType: normalizeString(options.goods.goods_type),
    orderState: normalizeString(options.row.order_state),
    applyRefund: normalizeString(options.row.apply_refund),
    outRefundNo: normalizeString(options.row.out_refund_no),
    refundId: normalizeString(options.row.refund_id),
    reason: normalizeString(options.row.reason),
    description: normalizeString(options.row.description),
  };
  const snapshot = {
    legacy,
  };

  if (options.goodsKind === 'voice_package') {
    snapshot.voicePackage = {
      id: objectIdToString(options.target.id),
      code: options.target.code,
      name: options.target.name,
      priceAmount: normalizeMoney(options.goods.goods_money),
      currency: CURRENCY,
      deliverables: [],
      materialRequirement: normalizeString(options.goods.goods_desc),
    };
  } else {
    snapshot.vipPlan = {
      id: objectIdToString(options.target.id),
      code: options.target.code,
      name: options.target.name,
      priceAmount: normalizeMoney(options.goods.goods_money),
      currency: CURRENCY,
      durationDays: options.goodsKind === 'year_member' ? 365 : undefined,
      lifetime: options.goodsKind === 'lifetime_member',
      benefits: [],
      entitlementGrants: [],
    };
  }

  if (options.agent) {
    snapshot.agent = {
      id: objectIdToString(legacyObjectId(`agent:${options.legacyAgentId}`)),
      name: normalizeString(options.agent.agent_name),
      avatar: normalizeString(options.agent.agent_img),
    };
  }

  return snapshot;
}

function buildTarget(goods, goodsKind) {
  const legacyGoodsId = normalizeString(goods.goods_id);
  const name = normalizeString(goods.goods_name) || legacyGoodsId;
  const prefix = goodsKind === 'voice_package' ? 'voice-package' : 'vip-plan';

  return {
    id: legacyObjectId(`${prefix}:${legacyGoodsId}`),
    code: `legacy_${sanitizeCode(goodsKind)}_${sanitizeCode(legacyGoodsId)}`,
    name,
  };
}

function buildSyntheticMembershipTarget(lifetime) {
  const key = lifetime ? 'lifetime' : 'member';

  return {
    id: legacyObjectId(`vip-plan:legacy-migration:${key}`),
    code: `legacy_migration_${key}`,
    name: lifetime ? '历史无限期会员' : '历史会员',
  };
}

function classifyGoods(goods) {
  const name = normalizeString(goods.goods_name);
  const type = normalizeString(goods.goods_type);

  if (name === '定制服务' || type === 'custom_service') {
    return 'custom_service';
  }

  if (name === '声音模型' || type === 'voice') {
    return 'voice_package';
  }

  if (name === '无限期会员') {
    return 'lifetime_member';
  }

  if (name === '一年会员' || type === 'member') {
    return 'year_member';
  }

  return undefined;
}

function normalizeLegacyOrderStatus(value) {
  const raw = normalizeString(value);

  return LEGACY_ORDER_STATUS_TO_NEW[raw] || 'closed';
}

function normalizeMoney(value, fallback = 0) {
  const parsed = Number(value);

  if (Number.isFinite(parsed)) {
    return Math.max(Math.round(parsed * 100), 0);
  }

  const fallbackParsed = Number(fallback);

  return Number.isFinite(fallbackParsed)
    ? Math.max(Math.round(fallbackParsed * 100), 0)
    : 0;
}

function normalizeFlag(value) {
  const raw = normalizeString(value).toLowerCase();

  return raw === '1' || raw === 'true' || raw === 'yes';
}

function chooseSourceOrder(sourceOrders, lifetime) {
  if (sourceOrders.length === 0) {
    return undefined;
  }

  if (lifetime) {
    const lifetimeOrders = sourceOrders.filter(order =>
      Boolean(order.snapshot?.vipPlan?.lifetime)
    );

    if (lifetimeOrders.length === 0) {
      return undefined;
    }

    return sortOrdersByPaidTimeDesc(lifetimeOrders)[0];
  }

  return sortOrdersByPaidTimeDesc(sourceOrders)[0];
}

function sortOrdersByPaidTimeDesc(sourceOrders) {
  return [...sourceOrders].sort(
    (left, right) =>
      dateTime(right.paidAt || right.createdAt) -
      dateTime(left.paidAt || left.createdAt)
  );
}

function findEarliestPaidAt(orders) {
  return orders
    .map(order => order.paidAt)
    .filter(Boolean)
    .sort((left, right) => left.getTime() - right.getTime())[0];
}

function mergeMembershipExpiredAt(current, next, lifetime) {
  if (lifetime) {
    return undefined;
  }

  if (!current) {
    return next;
  }

  if (!next) {
    return current;
  }

  return next > current ? next : current;
}

function minDate(current, next) {
  if (!current) {
    return next;
  }

  return next < current ? next : current;
}

function appendMapList(map, key, value) {
  const list = map.get(key) || [];

  list.push(value);
  map.set(key, list);
}

function buildOrderReportRow(row, goods, agent) {
  return {
    orderId: normalizeString(row.order_id),
    orderUserId: normalizeString(row.user_id),
    agentId: normalizeString(row.agent_id),
    agentOwnerUserId: normalizeString(agent?.create_user_id),
    goodsId: normalizeString(row.goods_id),
    goodsName: normalizeString(goods?.goods_name),
    orderState: normalizeString(row.order_state),
  };
}

function buildVoiceTrainingTaskReportRow(orderResult) {
  const order = orderResult.document;

  return {
    orderId: orderResult.legacyOrderId,
    agentId: orderResult.legacyAgentId,
    goodsId: orderResult.legacyGoodsId,
    orderStatus: order.status,
    voicePackageCode: order.targetCode,
  };
}

function resolveLegacyVoiceAudioSource(agent, speakersById) {
  const materialUrl = extractFirstUrlFromVoiceMaterial(agent?.voice_material);

  if (materialUrl) {
    return {
      source: 'agent.voice_material',
      url: materialUrl,
    };
  }

  const speakerId = normalizeString(agent?.speaker_id);
  const speaker = speakerId ? speakersById.get(speakerId) : undefined;
  const speakerUrl = normalizeString(speaker?.audios_url);

  if (speakerUrl) {
    return {
      source: 'speaker.audios_url',
      url: speakerUrl,
    };
  }

  return {
    source: '',
    url: '',
  };
}

function extractFirstUrlFromVoiceMaterial(value) {
  const raw = normalizeString(value);

  if (!raw || raw === '[]') {
    return '';
  }

  if (isLikelyUrl(raw)) {
    return raw;
  }

  try {
    return findFirstUrl(JSON.parse(raw));
  } catch {
    return '';
  }
}

function findFirstUrl(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return isLikelyUrl(value) ? value.trim() : '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstUrl(item);

      if (found) {
        return found;
      }
    }

    return '';
  }

  if (typeof value === 'object') {
    for (const key of ['url', 'audioUrl', 'audios_url', 'path']) {
      const found = findFirstUrl(value[key]);

      if (found) {
        return found;
      }
    }
  }

  return '';
}

function isLikelyUrl(value) {
  return /^(https?:)?\/\//i.test(String(value).trim());
}

function buildLegacyVoiceTimbreName(orderResult) {
  const agentName = normalizeString(orderResult.agent?.agent_name);
  const legacyAgentId = normalizeString(orderResult.legacyAgentId);
  const baseName = agentName
    ? `历史音色-${agentName}`
    : `历史音色-${orderResult.legacyOrderId}`;

  if (!legacyAgentId) {
    return baseName.slice(0, LEGACY_VOICE_TIMBRE_NAME_MAX_LENGTH);
  }

  const suffix = `-${legacyAgentId}`;
  const baseNameMaxLength = LEGACY_VOICE_TIMBRE_NAME_MAX_LENGTH - suffix.length;

  if (baseNameMaxLength <= 0) {
    return legacyAgentId.slice(0, LEGACY_VOICE_TIMBRE_NAME_MAX_LENGTH);
  }

  return `${baseName.slice(0, baseNameMaxLength)}${suffix}`;
}

function buildLegacyProviderVoiceId(legacyOrderId) {
  return `TzlVoice_legacy_${sanitizeCode(legacyOrderId)}`.slice(0, 256);
}

function buildLegacyVoiceTimbreRemark(orderResult, source) {
  return [
    '历史声音套餐素材迁移，火山音色ID已放弃，需点击重试重新训练 MiniMax 音色。',
    `旧订单号：${orderResult.legacyOrderId}`,
    `音频来源：${source.source}`,
  ].join('\n');
}

function buildAgentReportRow(agent) {
  return {
    agentId: normalizeString(agent.agent_id),
    agentOwnerUserId: normalizeString(agent.create_user_id),
    vipState: normalizeString(agent.vip_state),
    payTime: normalizeDate(agent.pay_time)?.toISOString(),
    expirationTime: normalizeDate(agent.expiration_time)?.toISOString(),
    isIndefinite: normalizeString(agent.is_indefinite),
  };
}

function createInitialStats() {
  return {
    scannedOrders: 0,
    exportedOrders: 0,
    exportedSyntheticOrders: 0,
    exportedVoiceTrainingTasks: 0,
    exportedVoiceTimbres: 0,
    skippedOrders: 0,
    skippedVoiceTrainingTasks: 0,
    skippedVoiceTrainingTaskMissingAgents: 0,
    skippedVoiceTrainingTaskNonPaidOrders: 0,
    skippedVoiceTimbres: 0,
    skippedVoiceTimbreMissingAudio: 0,
    skippedCustomServiceOrders: 0,
    unsupportedGoodsOrders: 0,
    missingUserOrders: 0,
    missingAgentOrders: 0,
    missingGoodsOrders: 0,
    ownerConflictOrders: 0,
    scannedAgents: 0,
    exportedMemberships: 0,
    lifetimeMemberships: 0,
    expiredMembershipAgents: 0,
    skippedMembershipAgents: 0,
    skippedTrialMembershipAgents: 0,
    missingUserMembershipAgents: 0,
  };
}

function createInitialReport() {
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

function writeReport(dbDumpPath, report) {
  const reportPath = path.join(dbDumpPath, 'membership-order.report.json');

  ensureParentDir(reportPath);
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sanitizeCode(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function legacyObjectId(value) {
  return buildObjectIdFromLegacyId(value);
}

function objectIdToString(value) {
  return value?.toHexString?.() || String(value);
}

function dateTime(value) {
  const date = normalizeDate(value);

  return date ? date.getTime() : 0;
}

if (require.main === module) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
  VOICE_TASK_REMARK,
  buildMembershipDocuments,
  buildOrderDocument,
  buildSyntheticMembershipOrder,
  buildVoiceTimbreDocument,
  buildVoiceTrainingTaskDocument,
  classifyGoods,
  normalizeLegacyOrderStatus,
};
