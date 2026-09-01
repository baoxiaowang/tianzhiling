<template>
  <div class="order-page" :class="{ 'order-page--embedded': embedded }">
    <a-card
      class="order-page__card"
      :class="{ 'order-page__card--embedded': embedded }"
      :bordered="false"
      :title="embedded ? undefined : pageTitle"
    >
      <template v-if="canCreateAdminOrder" #extra>
        <a-button type="primary" @click="openCreateModal">
          <template #icon>
            <icon-plus />
          </template>
          创建订单
        </a-button>
      </template>

      <section v-if="showAnalytics" class="order-page__analytics">
        <header class="order-page__analytics-header">
          <div>
            <h2>订单统计</h2>
            <span>上方看当月结果，下方核对每一笔订单</span>
          </div>
          <a-month-picker
            v-model="analyticsMonth"
            value-format="YYYY-MM"
            :allow-clear="false"
            @change="fetchAnalytics"
          />
        </header>
        <div class="order-page__analytics-summary">
          <article v-for="item in analyticsSummary" :key="item.label">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
            <small>{{ item.hint }}</small>
          </article>
        </div>
        <a-card
          class="order-page__analytics-chart"
          title="本月每日实付趋势"
          :bordered="false"
          :loading="analyticsLoading"
        >
          <Chart height="240px" :option="analyticsChartOption" />
        </a-card>
      </section>

      <a-form :model="searchForm" layout="inline" class="order-page__search">
        <a-form-item field="keyword" label="关键词">
          <a-input
            v-model="searchForm.keyword"
            allow-clear
            placeholder="搜索订单号、用户、手机号、交易号、智能体ID"
            @press-enter="handleSearch"
          />
        </a-form-item>
        <a-form-item v-if="!hideStatusFilter" field="status" label="订单状态">
          <a-select
            v-model="searchForm.status"
            allow-clear
            placeholder="全部"
            class="order-page__filter"
          >
            <a-option value="pending">待支付</a-option>
            <a-option value="paid">已支付</a-option>
            <a-option value="granting">发放中</a-option>
            <a-option value="completed">已完成</a-option>
            <a-option value="closed">已关闭</a-option>
            <a-option value="refund_requested">申请退款</a-option>
            <a-option value="refunded">已退款</a-option>
            <a-option value="grant_failed">发放失败</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="source" label="来源">
          <a-select
            v-model="searchForm.source"
            allow-clear
            placeholder="全部"
            class="order-page__filter"
          >
            <a-option value="weapp">小程序</a-option>
            <a-option value="app">App</a-option>
            <a-option value="admin">管理端</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="paymentType" label="支付类型">
          <a-select
            v-model="searchForm.paymentType"
            allow-clear
            placeholder="全部"
            class="order-page__filter"
          >
            <a-option value="normal">普通支付</a-option>
            <a-option value="virtual">虚拟支付</a-option>
          </a-select>
        </a-form-item>
        <a-form-item field="createdAtRange" label="下单时间">
          <a-range-picker
            v-model="searchForm.createdAtRange"
            allow-clear
            show-time
            value-format="YYYY-MM-DD HH:mm:ss"
            format="YYYY-MM-DD HH:mm"
            class="order-page__range-filter"
          />
        </a-form-item>
        <a-form-item field="registeredMonth" label="用户注册月">
          <a-month-picker
            v-model="searchForm.registeredMonth"
            allow-clear
            value-format="YYYY-MM"
            class="order-page__registered-month"
          />
        </a-form-item>
        <a-form-item>
          <a-space>
            <a-button type="primary" :loading="loading" @click="handleSearch">
              <template #icon>
                <icon-search />
              </template>
              查询
            </a-button>
            <a-button @click="resetSearch">重置</a-button>
          </a-space>
        </a-form-item>
      </a-form>

      <a-table
        row-key="id"
        :data="renderList"
        :loading="loading"
        :pagination="false"
        :bordered="false"
        :scroll="{ x: 1780 }"
      >
        <template #empty>
          <a-empty :description="emptyDescription">
            <a-button
              v-if="hasSearchCondition"
              type="text"
              @click="resetSearch"
            >
              清空筛选
            </a-button>
          </a-empty>
        </template>
        <template #columns>
          <a-table-column title="订单信息" data-index="orderNo" :width="260">
            <template #cell="{ record }">
              <div class="order-page__main">
                <a-typography-text
                  class="order-page__mono order-page__order-no"
                  copyable
                >
                  {{ record.orderNo }}
                </a-typography-text>
                <div class="order-page__title">{{ record.title || '-' }}</div>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="用户" data-index="user" :width="220">
            <template #cell="{ record }">
              <div class="order-page__user">
                <div class="order-page__user-name">
                  <a-link
                    v-if="canOpenOrderUser(record)"
                    @click="openUserDetail(record)"
                  >
                    {{ resolveOrderUserName(record) }}
                  </a-link>
                  <span v-else>{{ resolveOrderUserName(record) }}</span>
                </div>
                <div class="order-page__muted">
                  {{ resolveOrderUserContact(record) }}
                </div>
              </div>
            </template>
          </a-table-column>
          <a-table-column title="注册月份" :width="120">
            <template #cell="{ record }">
              {{ formatRegisteredMonth(record.user?.registeredAt) }}
            </template>
          </a-table-column>
          <a-table-column title="智能体ID" data-index="agentId" :width="220">
            <template #cell="{ record }">
              <a-typography-text
                v-if="record.agentId"
                class="order-page__mono order-page__agent-id"
                copyable
              >
                {{ record.agentId }}
              </a-typography-text>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="金额" data-index="payableAmount" :width="150">
            <template #cell="{ record }">
              <div>{{ formatAmount(record.payableAmount) }}</div>
              <div
                v-if="record.refundAmount && !isAdminManualOrder(record)"
                class="order-page__refund-amount"
              >
                退 {{ formatAmount(record.refundAmount) }}
              </div>
              <div
                v-else-if="record.voiceMembershipDowngrade"
                class="order-page__refund-amount"
              >
                拟退
                {{ formatAmount(record.voiceMembershipDowngrade.refundAmount) }}
              </div>
            </template>
          </a-table-column>
          <a-table-column title="状态" data-index="status" :width="120">
            <template #cell="{ record }">
              <a-tag :color="getRecordStatusColor(record)">
                {{ getRecordStatusText(record) }}
              </a-tag>
            </template>
          </a-table-column>
          <a-table-column title="来源" data-index="source" :width="100">
            <template #cell="{ record }">
              {{ getSourceText(record.source) }}
            </template>
          </a-table-column>
          <a-table-column
            title="支付渠道"
            data-index="paymentProvider"
            :width="130"
          >
            <template #cell="{ record }">
              {{ getPaymentProviderText(record.paymentProvider) }}
            </template>
          </a-table-column>
          <a-table-column
            title="微信发货"
            data-index="virtualGoodsProvideStatus"
            :width="130"
          >
            <template #cell="{ record }">
              <template v-if="getVirtualGoodsProvideStatus(record)">
                <a-tooltip
                  v-if="getVirtualGoodsProvideError(record)"
                  :content="getVirtualGoodsProvideError(record)"
                >
                  <a-tag :color="getVirtualGoodsProvideStatusColor(record)">
                    {{ getVirtualGoodsProvideStatusText(record) }}
                  </a-tag>
                </a-tooltip>
                <a-tag
                  v-else
                  :color="getVirtualGoodsProvideStatusColor(record)"
                >
                  {{ getVirtualGoodsProvideStatusText(record) }}
                </a-tag>
              </template>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column
            title="微信交易号"
            data-index="paymentTradeNo"
            :width="220"
          >
            <template #cell="{ record }">
              <a-tooltip
                v-if="record.paymentTradeNo"
                :content="record.paymentTradeNo"
              >
                <span class="order-page__mono order-page__ellipsis">
                  {{ record.paymentTradeNo }}
                </span>
              </a-tooltip>
              <span v-else>-</span>
            </template>
          </a-table-column>
          <a-table-column title="创建时间" data-index="createdAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.createdAt) }}
            </template>
          </a-table-column>
          <a-table-column title="支付时间" data-index="paidAt" :width="170">
            <template #cell="{ record }">
              {{ formatDate(record.paidAt) }}
            </template>
          </a-table-column>
          <a-table-column title="操作" :width="280" fixed="right">
            <template #cell="{ record }">
              <a-space>
                <a-button type="text" size="small" @click="openDetail(record)">
                  详情
                </a-button>
                <a-button
                  v-if="canSyncPaymentStatus(record)"
                  type="text"
                  size="small"
                  :loading="syncLoadingId === record.id"
                  @click="handleSyncPaymentStatus(record)"
                >
                  <template #icon>
                    <icon-refresh />
                  </template>
                  刷新状态
                </a-button>
                <a-button
                  v-if="canStartVoiceMembershipDowngrade(record)"
                  type="text"
                  size="small"
                  @click="openVoiceMembershipDowngrade(record)"
                >
                  声音降级
                </a-button>
                <a-button
                  v-else-if="canSyncVoiceMembershipDowngrade(record)"
                  type="text"
                  size="small"
                  :loading="downgradeSyncLoadingId === record.id"
                  @click="handleSyncVoiceMembershipDowngrade(record)"
                >
                  <template #icon>
                    <icon-refresh />
                  </template>
                  刷新降级
                </a-button>
                <a-popconfirm
                  v-if="canRefundOrder(record)"
                  :content="getRefundConfirmContent(record)"
                  :ok-text="getRefundActionText(record)"
                  cancel-text="取消"
                  position="left"
                  @ok="handleRefund(record)"
                >
                  <a-button
                    type="text"
                    status="danger"
                    size="small"
                    :loading="refundLoadingId === record.id"
                  >
                    {{ getRefundActionText(record) }}
                  </a-button>
                </a-popconfirm>
                <a-tooltip
                  v-else-if="isUnsupportedDowngradedUpgrade(record)"
                  content="升级会员涉及历史基础会员订单，需核对原订单后处理，暂不支持自动退订"
                >
                  <a-button type="text" size="small" disabled>
                    核对历史退款
                  </a-button>
                </a-tooltip>
                <a-popconfirm
                  v-if="canRevokeAdminManualOrder(record)"
                  :content="getRevokeConfirmContent(record)"
                  ok-text="回收"
                  cancel-text="取消"
                  position="left"
                  @ok="handleRevokeAdminManualOrder(record)"
                >
                  <a-button
                    type="text"
                    status="danger"
                    size="small"
                    :loading="revokeLoadingId === record.id"
                  >
                    回收
                  </a-button>
                </a-popconfirm>
              </a-space>
            </template>
          </a-table-column>
        </template>
      </a-table>

      <div class="order-page__pagination">
        <span class="order-page__total">
          共 {{ pagination.total }} 笔订单
        </span>
        <a-pagination
          :current="pagination.current"
          :page-size="pagination.pageSize"
          :total="pagination.total"
          show-page-size
          @change="onPageChange"
          @page-size-change="onPageSizeChange"
        />
      </div>
    </a-card>

    <a-drawer
      :visible="detailVisible"
      :width="520"
      title="订单详情"
      unmount-on-close
      @cancel="closeDetail"
    >
      <a-descriptions v-if="currentOrder" :column="1" bordered size="large">
        <a-descriptions-item label="订单号">
          <a-typography-text copyable>{{
            currentOrder.orderNo
          }}</a-typography-text>
        </a-descriptions-item>
        <a-descriptions-item label="订单标题">
          {{ currentOrder.title || '-' }}
        </a-descriptions-item>
        <a-descriptions-item label="订单状态">
          <a-tag :color="getRecordStatusColor(currentOrder)">
            {{ getRecordStatusText(currentOrder) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="用户">
          <a-link
            v-if="canOpenOrderUser(currentOrder)"
            @click="openUserDetail(currentOrder)"
          >
            {{ resolveOrderUserName(currentOrder) }}
          </a-link>
          <span v-else>{{ resolveOrderUserName(currentOrder) }}</span>
          <span class="order-page__muted">
            {{ resolveOrderUserContact(currentOrder) }}
          </span>
        </a-descriptions-item>
        <a-descriptions-item label="应付金额">
          {{ formatAmount(currentOrder.payableAmount) }}
        </a-descriptions-item>
        <a-descriptions-item label="原价">
          {{ formatAmount(currentOrder.amount) }}
        </a-descriptions-item>
        <a-descriptions-item label="优惠金额">
          {{
            formatAmount(
              currentOrder.discountAmount + currentOrder.couponAmount
            )
          }}
        </a-descriptions-item>
        <a-descriptions-item label="已付金额">
          {{ formatOptionalAmount(currentOrder.paidAmount) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="!isAdminManualOrder(currentOrder)"
          label="累计退款金额"
        >
          {{ formatOptionalAmount(currentOrder.refundAmount) }}
        </a-descriptions-item>
        <a-descriptions-item label="支付渠道">
          {{ getPaymentProviderText(currentOrder.paymentProvider) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="微信发货状态"
        >
          <a-tooltip
            v-if="getVirtualGoodsProvideError(currentOrder)"
            :content="getVirtualGoodsProvideError(currentOrder)"
          >
            <a-tag :color="getVirtualGoodsProvideStatusColor(currentOrder)">
              {{ getVirtualGoodsProvideStatusText(currentOrder) }}
            </a-tag>
          </a-tooltip>
          <a-tag
            v-else
            :color="getVirtualGoodsProvideStatusColor(currentOrder)"
          >
            {{ getVirtualGoodsProvideStatusText(currentOrder) }}
          </a-tag>
        </a-descriptions-item>
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="微信发货时间"
        >
          {{ formatDate(currentOrder.virtualGoodsProvidedAt) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="isVirtualPaymentOrder(currentOrder)"
          label="发货失败时间"
        >
          {{ formatDate(currentOrder.virtualGoodsProvideFailedAt) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="
            isVirtualPaymentOrder(currentOrder) &&
            currentOrder.virtualGoodsProvideError
          "
          label="发货失败原因"
        >
          {{ currentOrder.virtualGoodsProvideError }}
        </a-descriptions-item>
        <a-descriptions-item label="微信交易号">
          <a-typography-text v-if="currentOrder.paymentTradeNo" copyable>
            {{ currentOrder.paymentTradeNo }}
          </a-typography-text>
          <span v-else>-</span>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">
          {{ formatDate(currentOrder.createdAt) }}
        </a-descriptions-item>
        <a-descriptions-item label="支付时间">
          {{ formatDate(currentOrder.paidAt) }}
        </a-descriptions-item>
        <a-descriptions-item :label="getClosedAtLabel(currentOrder)">
          {{ formatDate(currentOrder.closedAt) }}
        </a-descriptions-item>
        <a-descriptions-item
          v-if="!isAdminManualOrder(currentOrder)"
          label="退款时间"
        >
          {{ formatDate(currentOrder.refundedAt) }}
        </a-descriptions-item>
        <template v-if="currentOrder.voiceMembershipDowngrade">
          <a-descriptions-item label="会员降级">
            {{ currentOrder.voiceMembershipDowngrade.sourcePlan.name }} →
            {{ currentOrder.voiceMembershipDowngrade.targetPlan.name }}
          </a-descriptions-item>
          <a-descriptions-item label="其中降级退款">
            {{
              formatAmount(currentOrder.voiceMembershipDowngrade.refundAmount)
            }}
          </a-descriptions-item>
          <a-descriptions-item label="降级退款单号">
            <a-typography-text copyable>
              {{ currentOrder.voiceMembershipDowngrade.refundNo }}
            </a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item label="降级处理状态">
            {{ getVoiceMembershipDowngradeStatusText(currentOrder) }}
          </a-descriptions-item>
          <a-descriptions-item
            v-if="currentOrder.voiceMembershipDowngrade.failureReason"
            label="降级异常"
          >
            {{ currentOrder.voiceMembershipDowngrade.failureReason }}
          </a-descriptions-item>
          <a-descriptions-item label="操作账号">
            {{ currentOrder.voiceMembershipDowngrade.operatorAccount || '-' }}
          </a-descriptions-item>
          <a-descriptions-item label="完成时间">
            {{ formatDate(currentOrder.voiceMembershipDowngrade.completedAt) }}
          </a-descriptions-item>
        </template>
        <template v-if="currentOrder.voiceMembershipFinalRefund">
          <a-descriptions-item label="最终退款状态">
            {{ getVoiceMembershipFinalRefundStatusText(currentOrder) }}
          </a-descriptions-item>
          <a-descriptions-item label="最终退款金额">
            {{
              formatAmount(currentOrder.voiceMembershipFinalRefund.refundAmount)
            }}
          </a-descriptions-item>
          <a-descriptions-item label="最终退款单号">
            <a-typography-text copyable>
              {{ currentOrder.voiceMembershipFinalRefund.refundNo }}
            </a-typography-text>
          </a-descriptions-item>
          <a-descriptions-item
            v-if="currentOrder.voiceMembershipFinalRefund.attempt > 1"
            label="退款尝试"
          >
            第 {{ currentOrder.voiceMembershipFinalRefund.attempt }} 次
          </a-descriptions-item>
          <a-descriptions-item
            v-if="currentOrder.voiceMembershipFinalRefund.failureReason"
            label="最终退款异常"
          >
            {{ currentOrder.voiceMembershipFinalRefund.failureReason }}
          </a-descriptions-item>
        </template>
        <a-descriptions-item
          v-if="isUnsupportedDowngradedUpgrade(currentOrder)"
          label="退款说明"
        >
          该会员由历史基础会员升级而来，退款涉及多笔原订单；为避免少退或错退，请先核对历史基础会员订单。
        </a-descriptions-item>
      </a-descriptions>
    </a-drawer>

    <a-modal
      v-model:visible="downgradeVisible"
      title="声音版会员降级"
      :width="560"
      :footer="false"
      unmount-on-close
      @cancel="closeVoiceMembershipDowngrade"
    >
      <a-spin :loading="downgradePreviewLoading" class="order-page__spin">
        <template v-if="downgradePreview">
          <a-alert
            v-if="!downgradePreview.eligible"
            type="warning"
            show-icon
            :content="
              downgradePreview.unavailableReason || '当前订单不能自动降级'
            "
          />
          <template v-else>
            <a-descriptions :column="1" bordered>
              <a-descriptions-item label="当前会员">
                {{ downgradePreview.sourcePlan?.name || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="实付金额">
                {{ formatAmount(downgradePreview.paidAmount) }}
              </a-descriptions-item>
              <a-descriptions-item label="会员有效期">
                {{ formatDowngradeMembershipPeriod }}
              </a-descriptions-item>
            </a-descriptions>

            <a-form :model="downgradeForm" layout="vertical">
              <a-form-item label="降为基础版会员">
                <a-select
                  v-model="downgradeForm.targetVipPlanId"
                  placeholder="请选择同周期基础版会员"
                  class="order-page__full"
                >
                  <a-option
                    v-for="item in downgradePreview.targetPlans"
                    :key="item.id"
                    :value="item.id"
                  >
                    {{ item.name }} / 退 {{ formatAmount(item.refundAmount) }}
                  </a-option>
                </a-select>
              </a-form-item>
            </a-form>

            <a-alert type="warning" show-icon :content="downgradeImpactText" />
            <a-checkbox
              v-model="downgradeForm.confirmed"
              class="order-page__downgrade-confirm"
            >
              我已核对目标会员和退款金额
            </a-checkbox>
          </template>
        </template>
      </a-spin>

      <div class="order-page__modal-footer">
        <a-space>
          <a-button @click="closeVoiceMembershipDowngrade">取消</a-button>
          <a-button
            v-if="downgradePreview?.eligible"
            type="primary"
            status="danger"
            :disabled="!canSubmitVoiceMembershipDowngrade"
            :loading="downgradeSubmitting"
            @click="handleVoiceMembershipDowngrade"
          >
            确认退款并降级
          </a-button>
        </a-space>
      </div>
    </a-modal>

    <a-modal
      v-model:visible="createVisible"
      :title="createModalTitle"
      :footer="false"
      unmount-on-close
      @cancel="closeCreateModal"
    >
      <a-form :model="createForm" layout="vertical">
        <a-form-item
          field="orderType"
          label="订单类型"
          :rules="[{ required: true, message: '请选择订单类型' }]"
        >
          <a-select
            v-model="createForm.orderType"
            class="order-page__full"
            @change="handleCreateOrderTypeChange"
          >
            <a-option value="vip_plan">会员订单</a-option>
            <a-option value="voice_package">声音套餐订单</a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          field="userId"
          label="用户"
          :rules="[{ required: true, message: '请选择用户' }]"
        >
          <a-select
            v-model="createForm.userId"
            allow-clear
            allow-search
            :filter-option="false"
            :loading="userOptionsLoading"
            placeholder="搜索手机号、昵称或用户ID"
            class="order-page__full"
            @change="handleCreateUserChange"
            @search="handleUserSearch"
          >
            <a-option
              v-for="item in userOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatUserOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVipPlanOrder"
          field="vipPlanId"
          label="VIP计划"
          :rules="[{ required: true, message: '请选择VIP计划' }]"
        >
          <a-select
            v-model="createForm.vipPlanId"
            allow-clear
            :loading="vipPlanOptionsLoading"
            placeholder="选择启用中的VIP计划"
            class="order-page__full"
          >
            <a-option
              v-for="item in vipPlanOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatVipPlanOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVoicePackageOrder"
          field="voicePackageId"
          label="声音套餐"
          :rules="[{ required: true, message: '请选择声音套餐' }]"
        >
          <a-select
            v-model="createForm.voicePackageId"
            allow-clear
            :loading="voicePackageOptionsLoading"
            placeholder="选择启用中的声音套餐"
            class="order-page__full"
          >
            <a-option
              v-for="item in voicePackageOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatVoicePackageOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVoicePackageOrder"
          field="agentId"
          label="智能体"
          :rules="[{ required: true, message: '请选择智能体' }]"
        >
          <a-select
            v-model="createForm.agentId"
            allow-clear
            allow-search
            :disabled="!createForm.userId"
            :filter-option="false"
            :loading="agentOptionsLoading"
            placeholder="先选择用户，再选择该用户的智能体"
            class="order-page__full"
            @search="handleAgentSearch"
          >
            <a-option
              v-for="item in agentOptions"
              :key="item.id"
              :value="item.id"
            >
              {{ formatAgentOption(item) }}
            </a-option>
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="isCreateVoicePackageOrder"
          field="replaceActiveVoiceTrainingTask"
        >
          <a-checkbox v-model="createForm.replaceActiveVoiceTrainingTask">
            覆盖未完成训练任务
          </a-checkbox>
        </a-form-item>
        <a-alert
          v-if="
            isCreateVoicePackageOrder &&
            createForm.replaceActiveVoiceTrainingTask
          "
          type="warning"
          show-icon
          content="会将该智能体现有未完成声音训练任务标记为失败，再创建新的训练任务。"
        />
      </a-form>
      <div class="order-page__modal-footer">
        <a-space>
          <a-button @click="closeCreateModal">取消</a-button>
          <a-button
            type="primary"
            :loading="createSubmitting"
            @click="handleCreateOrder"
          >
            {{ createSubmitText }}
          </a-button>
        </a-space>
      </div>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, reactive, ref, watch } from 'vue';
  import { useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import { Message } from '@arco-design/web-vue';
  import type {
    AdminOrderAnalyticsDTO,
    AdminOrderPaymentTypeDTO,
    OrderSourceDTO,
    OrderStatusDTO,
    OrderTypeDTO,
    VirtualGoodsProvideStatusDTO,
  } from '@tzl/shared';
  import useLoading from '@/hooks/loading';
  import { queryOrderAnalytics } from '@/api/operations';
  import {
    queryAppUserAgents,
    queryAppUserList,
    type AppUserAgentRecord,
    type AppUserRecord,
  } from '@/api/app-user';
  import { queryVipPlanList, type VipPlanRecord } from '@/api/membership';
  import {
    queryVoicePackageList,
    type VoicePackageRecord,
  } from '@/api/voice-package';
  import {
    createAdminOrder as createAdminOrderApi,
    downgradeVoiceMembership as downgradeVoiceMembershipApi,
    getVoiceMembershipDowngradePreview as getVoiceMembershipDowngradePreviewApi,
    OrderRecord,
    queryOrderList,
    refundOrder as refundOrderApi,
    revokeAdminManualOrder as revokeAdminManualOrderApi,
    syncOrderPaymentStatus as syncOrderPaymentStatusApi,
    syncVoiceMembershipDowngrade as syncVoiceMembershipDowngradeApi,
    type VoiceMembershipDowngradePreview,
  } from '@/api/order';

  const props = withDefaults(
    defineProps<{
      title?: string;
      orderType?: 'vip_plan' | 'voice_package';
      status?: OrderStatusDTO;
      hideStatusFilter?: boolean;
      emptyDescription?: string;
      excludeAdminManual?: boolean;
      userId?: string;
      embedded?: boolean;
    }>(),
    {
      title: '',
      orderType: undefined,
      status: undefined,
      hideStatusFilter: false,
      emptyDescription: '',
      excludeAdminManual: false,
      userId: '',
      embedded: false,
    }
  );

  const { loading, setLoading } = useLoading();
  const router = useRouter();
  const renderList = ref<OrderRecord[]>([]);
  const analytics = ref<AdminOrderAnalyticsDTO>();
  const analyticsLoading = ref(false);
  const analyticsMonth = ref(dayjs().format('YYYY-MM'));
  const detailVisible = ref(false);
  const currentOrder = ref<OrderRecord>();
  const refundLoadingId = ref('');
  const revokeLoadingId = ref('');
  const syncLoadingId = ref('');
  const downgradeSyncLoadingId = ref('');
  const downgradeVisible = ref(false);
  const downgradePreviewLoading = ref(false);
  const downgradeSubmitting = ref(false);
  const downgradeOrder = ref<OrderRecord>();
  const downgradePreview = ref<VoiceMembershipDowngradePreview>();
  const createVisible = ref(false);
  const createSubmitting = ref(false);
  const userOptionsLoading = ref(false);
  const vipPlanOptionsLoading = ref(false);
  const voicePackageOptionsLoading = ref(false);
  const agentOptionsLoading = ref(false);
  const userOptions = ref<AppUserRecord[]>([]);
  const vipPlanOptions = ref<VipPlanRecord[]>([]);
  const voicePackageOptions = ref<VoicePackageRecord[]>([]);
  const agentOptions = ref<AppUserAgentRecord[]>([]);
  let userSearchRequestId = 0;
  let agentSearchRequestId = 0;
  const searchForm = reactive<{
    keyword: string;
    status?: OrderStatusDTO | '';
    source?: OrderSourceDTO | '';
    paymentType?: AdminOrderPaymentTypeDTO | '';
    createdAtRange: string[];
    registeredMonth?: string;
  }>({
    keyword: '',
    status: props.status,
    source: undefined,
    paymentType: undefined,
    createdAtRange: [],
    registeredMonth: undefined,
  });
  const createForm = reactive<{
    orderType: OrderTypeDTO;
    userId: string;
    vipPlanId: string;
    voicePackageId: string;
    agentId: string;
    replaceActiveVoiceTrainingTask: boolean;
  }>({
    orderType: 'vip_plan',
    userId: '',
    vipPlanId: '',
    voicePackageId: '',
    agentId: '',
    replaceActiveVoiceTrainingTask: false,
  });
  const downgradeForm = reactive({
    targetVipPlanId: '',
    confirmed: false,
  });
  const pagination = reactive({
    current: 1,
    pageSize: 20,
    total: 0,
  });
  const statusMap: Record<OrderStatusDTO, { text: string; color: string }> = {
    pending: { text: '待支付', color: 'orange' },
    paid: { text: '已支付', color: 'blue' },
    granting: { text: '发放中', color: 'arcoblue' },
    completed: { text: '已完成', color: 'green' },
    closed: { text: '已关闭', color: 'gray' },
    refund_requested: { text: '申请退款', color: 'orange' },
    refunded: { text: '已退款', color: 'purple' },
    grant_failed: { text: '发放失败', color: 'red' },
  };
  const sourceMap: Record<OrderSourceDTO, string> = {
    weapp: '小程序',
    app: 'App',
    admin: '管理端',
  };
  const virtualGoodsProvideStatusMap: Record<
    VirtualGoodsProvideStatusDTO,
    { text: string; color: string }
  > = {
    pending: { text: '待发货', color: 'orange' },
    provided: { text: '已发货', color: 'green' },
    failed: { text: '发货失败', color: 'red' },
  };
  const orderTypeTitleMap: Record<string, string> = {
    vip_plan: '会员订单',
    voice_package: '声音套餐订单',
  };
  const pageTitle = computed(() => {
    if (props.title) {
      return props.title;
    }

    return props.orderType ? orderTypeTitleMap[props.orderType] : '订单明细';
  });
  const showAnalytics = computed(
    () => !props.embedded && !props.orderType && !props.status && !props.userId
  );
  const analyticsSummary = computed(() => [
    {
      label: '本月实付金额',
      value: formatAnalyticsMoney(analytics.value?.totals.paidRevenue),
      hint: `净收入 ${formatAnalyticsMoney(
        analytics.value?.totals.netRevenue
      )}`,
    },
    {
      label: '支付订单',
      value: formatCount(analytics.value?.totals.paidOrders),
      hint: `支付成功率 ${formatPercent(
        analytics.value?.totals.paymentSuccessRate
      )}`,
    },
    {
      label: '付费用户',
      value: formatCount(analytics.value?.totals.payingUsers),
      hint: `首次付费 ${formatCount(
        analytics.value?.totals.firstTimePayingUsers
      )} 人`,
    },
    {
      label: '平均订单金额',
      value: formatAnalyticsMoney(analytics.value?.totals.averageOrderAmount),
      hint: '实付金额 ÷ 支付订单',
    },
    {
      label: '退款金额',
      value: formatAnalyticsMoney(analytics.value?.totals.refundedRevenue),
      hint: `退款率 ${formatPercent(analytics.value?.totals.refundRate)}`,
    },
  ]);
  const analyticsChartOption = computed(() => ({
    tooltip: { trigger: 'axis' },
    grid: { left: 64, right: 30, top: 28, bottom: 38 },
    xAxis: {
      type: 'category',
      data: (analytics.value?.daily || []).map((item) =>
        dayjs(item.date).format('MM-DD')
      ),
      axisLabel: { interval: 4 },
    },
    yAxis: { type: 'value', name: '元' },
    series: [
      {
        name: '实付金额',
        type: 'bar',
        data: (analytics.value?.daily || []).map((item) => item.paidRevenue),
        itemStyle: { color: '#8b78d9', borderRadius: [5, 5, 0, 0] },
      },
      {
        name: '净收入',
        type: 'line',
        smooth: true,
        data: (analytics.value?.daily || []).map((item) => item.netRevenue),
        itemStyle: { color: '#c27b9c' },
      },
    ],
  }));
  const normalizedCreatedAtRange = computed(() => {
    const [start, end] = searchForm.createdAtRange;

    return {
      createdAtStart: start ? dayjs(start).toISOString() : undefined,
      createdAtEnd: end ? dayjs(end).toISOString() : undefined,
    };
  });
  const requestParams = computed(() => ({
    keyword: searchForm.keyword.trim() || undefined,
    status: props.status || searchForm.status || undefined,
    orderType: props.orderType,
    source: searchForm.source || undefined,
    paymentType: searchForm.paymentType || undefined,
    excludeAdminManual: props.excludeAdminManual || undefined,
    createdAtStart: normalizedCreatedAtRange.value.createdAtStart,
    createdAtEnd: normalizedCreatedAtRange.value.createdAtEnd,
    registeredMonth: searchForm.registeredMonth || undefined,
    userId: props.userId || undefined,
    page: pagination.current,
    pageSize: pagination.pageSize,
  }));
  const hasSearchCondition = computed(
    () =>
      Boolean(searchForm.keyword.trim()) ||
      Boolean(!props.status && searchForm.status) ||
      Boolean(searchForm.source) ||
      Boolean(searchForm.paymentType) ||
      searchForm.createdAtRange.length > 0 ||
      Boolean(searchForm.registeredMonth)
  );
  const emptyDescription = computed(() => {
    if (hasSearchCondition.value) {
      return '未找到匹配订单';
    }

    return props.emptyDescription || '暂无订单数据';
  });
  const canCreateAdminOrder = computed(
    () => !props.status && !props.orderType && !props.embedded && !props.userId
  );
  const isCreateVipPlanOrder = computed(
    () => createForm.orderType === 'vip_plan'
  );
  const isCreateVoicePackageOrder = computed(
    () => createForm.orderType === 'voice_package'
  );
  const createModalTitle = computed(() =>
    isCreateVoicePackageOrder.value ? '创建声音套餐订单' : '创建会员订单'
  );
  const createSubmitText = computed(() =>
    isCreateVoicePackageOrder.value ? '创建声音套餐订单' : '创建会员订单'
  );
  const selectedDowngradeTarget = computed(() =>
    downgradePreview.value?.targetPlans.find(
      (item) => item.id === downgradeForm.targetVipPlanId
    )
  );
  const canSubmitVoiceMembershipDowngrade = computed(
    () =>
      Boolean(downgradeOrder.value) &&
      Boolean(selectedDowngradeTarget.value) &&
      downgradeForm.confirmed &&
      !downgradeSubmitting.value
  );
  const formatDowngradeMembershipPeriod = computed(() => {
    if (!downgradePreview.value) {
      return '-';
    }

    if (downgradePreview.value.membershipLifetime) {
      return '永久有效，降级后不变';
    }

    const startedAt = formatDate(downgradePreview.value.membershipStartedAt);
    const expiredAt = formatDate(downgradePreview.value.membershipExpiredAt);

    return `${startedAt} 至 ${expiredAt}，降级后不变`;
  });
  const downgradeImpactText = computed(() => {
    const target = selectedDowngradeTarget.value;

    if (!target) {
      return '选择基础版会员后，系统会计算并展示退款差价。';
    }

    return `将原路退回 ${formatAmount(
      target.refundAmount
    )}，会员有效期不变；这笔会员提供的声音资格和已接入声音会停止，训练素材与音色记录保留。`;
  });

  const fetchData = async () => {
    try {
      setLoading(true);
      const { data } = await queryOrderList(requestParams.value);
      renderList.value = data.items;
      pagination.total = data.total;
      pagination.current = data.page;
      pagination.pageSize = data.pageSize;
    } catch (error) {
      Message.error('订单列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchAnalytics = async () => {
    if (!showAnalytics.value) return;

    try {
      analyticsLoading.value = true;
      const { data } = await queryOrderAnalytics(analyticsMonth.value);
      analytics.value = data;
    } catch (error) {
      Message.error('订单统计加载失败');
    } finally {
      analyticsLoading.value = false;
    }
  };

  const handleSearch = () => {
    pagination.current = 1;
    fetchData();
  };

  const resetSearch = () => {
    searchForm.keyword = '';
    searchForm.status = props.status;
    searchForm.source = undefined;
    searchForm.paymentType = undefined;
    searchForm.createdAtRange = [];
    searchForm.registeredMonth = undefined;
    pagination.current = 1;
    fetchData();
  };

  const onPageChange = (page: number) => {
    pagination.current = page;
    fetchData();
  };

  const onPageSizeChange = (pageSize: number) => {
    pagination.pageSize = pageSize;
    pagination.current = 1;
    fetchData();
  };

  const openDetail = (record: OrderRecord) => {
    currentOrder.value = record;
    detailVisible.value = true;
  };

  const closeDetail = () => {
    detailVisible.value = false;
    currentOrder.value = undefined;
  };

  const getRemainingRefundAmount = (record: OrderRecord) => {
    const paidAmount = record.paidAmount ?? record.payableAmount ?? 0;
    const recordedRefundAmount = Math.max(
      record.refundAmount ?? 0,
      record.voiceMembershipDowngrade?.status === 'completed'
        ? record.voiceMembershipDowngrade.refundAmount
        : 0
    );

    return Math.max(paidAmount - recordedRefundAmount, 0);
  };

  const canRefundOrder = (record: OrderRecord) => {
    const downgradeCompleted =
      !record.voiceMembershipDowngrade ||
      record.voiceMembershipDowngrade.status === 'completed';
    const needsBenefitRetry =
      record.status === 'refunded' &&
      (record.voiceMembershipFinalRefund?.status === 'benefits_failed' ||
        record.voiceMembershipFinalRefund?.status === 'benefits_processing');
    const unsupportedDowngradedUpgrade = Boolean(
      record.vipUpgrade &&
        record.voiceMembershipDowngrade?.status === 'completed'
    );

    return (
      (record.orderType === 'vip_plan' ||
        record.orderType === 'voice_package') &&
      !isAdminManualOrder(record) &&
      !unsupportedDowngradedUpgrade &&
      downgradeCompleted &&
      (getRemainingRefundAmount(record) > 0 || needsBenefitRetry) &&
      (needsBenefitRetry ||
        record.status === 'completed' ||
        record.status === 'paid' ||
        record.status === 'refund_requested' ||
        record.status === 'grant_failed')
    );
  };

  const isUnsupportedDowngradedUpgrade = (record: OrderRecord) => {
    return Boolean(
      record.vipUpgrade &&
        record.voiceMembershipDowngrade?.status === 'completed' &&
        record.status !== 'refunded'
    );
  };

  const canStartVoiceMembershipDowngrade = (record: OrderRecord) => {
    return (
      record.orderType === 'vip_plan' &&
      record.vipPlanGroup === 'voice' &&
      record.status === 'completed' &&
      (!record.paymentProvider ||
        record.paymentProvider === 'wechat_pay' ||
        record.paymentProvider === 'wechat_virtual_pay') &&
      !record.voiceMembershipDowngrade
    );
  };

  const canSyncVoiceMembershipDowngrade = (record: OrderRecord) => {
    return Boolean(
      record.voiceMembershipDowngrade &&
        record.voiceMembershipDowngrade.status !== 'completed'
    );
  };

  const canRevokeAdminManualOrder = (record: OrderRecord) => {
    return (
      (record.orderType === 'vip_plan' ||
        record.orderType === 'voice_package') &&
      isAdminManualOrder(record) &&
      (record.status === 'completed' ||
        record.status === 'paid' ||
        record.status === 'refund_requested' ||
        record.status === 'grant_failed')
    );
  };

  const canSyncPaymentStatus = (record: OrderRecord) => {
    if (
      isVirtualPaymentOrder(record) &&
      record.status === 'completed' &&
      !isVirtualGoodsProvided(record)
    ) {
      return true;
    }

    const isWechatPayment =
      !record.paymentProvider ||
      record.paymentProvider === 'wechat_pay' ||
      record.paymentProvider === 'wechat_virtual_pay';

    return (
      isWechatPayment &&
      (record.status === 'pending' || record.status === 'closed')
    );
  };

  const replaceOrderRecord = (record: OrderRecord) => {
    if (props.status && record.status !== props.status) {
      renderList.value = renderList.value.filter(
        (item) => item.id !== record.id
      );
      pagination.total = Math.max(0, pagination.total - 1);

      if (currentOrder.value?.id === record.id) {
        currentOrder.value = record;
      }

      return;
    }

    const index = renderList.value.findIndex((item) => item.id === record.id);

    if (index >= 0) {
      renderList.value[index] = record;
    }

    if (currentOrder.value?.id === record.id) {
      currentOrder.value = record;
    }
  };

  const handleSyncPaymentStatus = async (record: OrderRecord) => {
    if (syncLoadingId.value) {
      return;
    }

    const previousStatus = record.status;
    const previousVirtualGoodsProvideStatus =
      getVirtualGoodsProvideStatus(record);
    syncLoadingId.value = record.id;

    try {
      const { data } = await syncOrderPaymentStatusApi(record.id);

      replaceOrderRecord(data);
      showSyncPaymentStatusMessage(
        data,
        previousStatus,
        previousVirtualGoodsProvideStatus
      );
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '刷新订单状态失败，请稍后重试'
      );
    } finally {
      syncLoadingId.value = '';
    }
  };

  const openVoiceMembershipDowngrade = async (record: OrderRecord) => {
    downgradeOrder.value = record;
    downgradePreview.value = undefined;
    downgradeForm.targetVipPlanId = '';
    downgradeForm.confirmed = false;
    downgradeVisible.value = true;

    try {
      downgradePreviewLoading.value = true;
      const { data } = await getVoiceMembershipDowngradePreviewApi(record.id);

      downgradePreview.value = data;
      if (data.targetPlans.length === 1) {
        downgradeForm.targetVipPlanId = data.targetPlans[0].id;
      }
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '降级信息加载失败，请稍后重试'
      );
      downgradeVisible.value = false;
    } finally {
      downgradePreviewLoading.value = false;
    }
  };

  const closeVoiceMembershipDowngrade = () => {
    if (downgradeSubmitting.value) {
      return;
    }

    downgradeVisible.value = false;
    downgradeOrder.value = undefined;
    downgradePreview.value = undefined;
    downgradeForm.targetVipPlanId = '';
    downgradeForm.confirmed = false;
  };

  const handleVoiceMembershipDowngrade = async () => {
    const order = downgradeOrder.value;

    if (!order || !canSubmitVoiceMembershipDowngrade.value) {
      return;
    }

    try {
      downgradeSubmitting.value = true;
      const { data } = await downgradeVoiceMembershipApi(order.id, {
        targetVipPlanId: downgradeForm.targetVipPlanId,
      });

      replaceOrderRecord(data);
      downgradeVisible.value = false;
      if (data.voiceMembershipDowngrade?.status === 'completed') {
        Message.success('退款成功，会员已降为基础版');
      } else if (data.voiceMembershipDowngrade?.status === 'benefits_failed') {
        Message.error('退款已成功，但会员权益处理失败，请点击刷新降级');
      } else if (data.voiceMembershipDowngrade?.status === 'failed') {
        Message.error(
          data.voiceMembershipDowngrade.failureReason || '降级退款失败'
        );
      } else {
        Message.success('降级退款已提交，请稍后刷新处理状态');
      }
    } catch (error) {
      fetchData();
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '会员降级失败，请稍后重试'
      );
    } finally {
      downgradeSubmitting.value = false;
    }
  };

  const handleSyncVoiceMembershipDowngrade = async (record: OrderRecord) => {
    if (downgradeSyncLoadingId.value) {
      return;
    }

    try {
      downgradeSyncLoadingId.value = record.id;
      const { data } = await syncVoiceMembershipDowngradeApi(record.id);

      replaceOrderRecord(data);
      if (data.voiceMembershipDowngrade?.status === 'completed') {
        Message.success('退款成功，会员已降为基础版');
      } else if (data.voiceMembershipDowngrade?.status === 'benefits_failed') {
        Message.error('退款已成功，但会员权益处理失败，请再次刷新');
      } else if (data.voiceMembershipDowngrade?.status === 'failed') {
        Message.error(
          data.voiceMembershipDowngrade.failureReason || '降级退款失败'
        );
      } else {
        Message.warning('微信仍在处理退款，请稍后再刷新');
      }
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '降级状态刷新失败，请稍后重试'
      );
    } finally {
      downgradeSyncLoadingId.value = '';
    }
  };

  const openCreateModal = () => {
    resetCreateForm();
    createVisible.value = true;
    fetchUserOptions();
    fetchVipPlanOptions();
    fetchVoicePackageOptions();
  };

  const closeCreateModal = () => {
    if (createSubmitting.value) {
      return;
    }

    createVisible.value = false;
  };

  const resetCreateForm = () => {
    createForm.orderType = 'vip_plan';
    createForm.userId = '';
    createForm.vipPlanId = '';
    createForm.voicePackageId = '';
    createForm.agentId = '';
    createForm.replaceActiveVoiceTrainingTask = false;
    agentOptions.value = [];
  };

  const fetchUserOptions = async (keyword = '') => {
    userSearchRequestId += 1;
    const requestId = userSearchRequestId;

    try {
      userOptionsLoading.value = true;
      const { data } = await queryAppUserList({
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 20,
      });

      if (requestId === userSearchRequestId) {
        userOptions.value = data.items;
      }
    } catch (error) {
      if (requestId === userSearchRequestId) {
        userOptions.value = [];
        Message.error('用户列表加载失败');
      }
    } finally {
      if (requestId === userSearchRequestId) {
        userOptionsLoading.value = false;
      }
    }
  };

  const handleUserSearch = (value: string) => {
    fetchUserOptions(value);
  };

  const handleCreateOrderTypeChange = () => {
    createForm.vipPlanId = '';
    createForm.voicePackageId = '';
    createForm.agentId = '';
    createForm.replaceActiveVoiceTrainingTask = false;

    if (isCreateVoicePackageOrder.value && createForm.userId) {
      fetchAgentOptions(createForm.userId);
    }
  };

  const handleCreateUserChange = () => {
    createForm.agentId = '';
    agentOptions.value = [];

    if (isCreateVoicePackageOrder.value && createForm.userId) {
      fetchAgentOptions(createForm.userId);
    }
  };

  const fetchVipPlanOptions = async () => {
    try {
      vipPlanOptionsLoading.value = true;
      const { data } = await queryVipPlanList({
        status: 'active',
        page: 1,
        pageSize: 100,
      });

      vipPlanOptions.value = data.items;
    } catch (error) {
      vipPlanOptions.value = [];
      Message.error('VIP计划加载失败');
    } finally {
      vipPlanOptionsLoading.value = false;
    }
  };

  const fetchVoicePackageOptions = async () => {
    try {
      voicePackageOptionsLoading.value = true;
      const { data } = await queryVoicePackageList({
        status: 'active',
        page: 1,
        pageSize: 100,
      });

      voicePackageOptions.value = data.items;
    } catch (error) {
      voicePackageOptions.value = [];
      Message.error('声音套餐加载失败');
    } finally {
      voicePackageOptionsLoading.value = false;
    }
  };

  const fetchAgentOptions = async (userId: string, keyword = '') => {
    if (!userId) {
      agentOptions.value = [];
      return;
    }

    agentSearchRequestId += 1;
    const requestId = agentSearchRequestId;

    try {
      agentOptionsLoading.value = true;
      const { data } = await queryAppUserAgents(userId, {
        keyword: keyword.trim() || undefined,
        page: 1,
        pageSize: 20,
      });

      if (requestId === agentSearchRequestId) {
        agentOptions.value = data.items;
      }
    } catch (error) {
      if (requestId === agentSearchRequestId) {
        agentOptions.value = [];
        Message.error('智能体列表加载失败');
      }
    } finally {
      if (requestId === agentSearchRequestId) {
        agentOptionsLoading.value = false;
      }
    }
  };

  const handleAgentSearch = (value: string) => {
    fetchAgentOptions(createForm.userId, value);
  };

  const handleCreateOrder = async () => {
    if (createSubmitting.value) {
      return;
    }

    if (!createForm.userId) {
      Message.warning('请选择用户');
      return;
    }

    if (isCreateVipPlanOrder.value && !createForm.vipPlanId) {
      Message.warning('请选择VIP计划');
      return;
    }

    if (isCreateVoicePackageOrder.value && !createForm.voicePackageId) {
      Message.warning('请选择声音套餐');
      return;
    }

    if (isCreateVoicePackageOrder.value && !createForm.agentId) {
      Message.warning('请选择智能体');
      return;
    }

    try {
      createSubmitting.value = true;
      await createAdminOrderApi({
        orderType: createForm.orderType,
        userId: createForm.userId,
        vipPlanId: isCreateVipPlanOrder.value
          ? createForm.vipPlanId
          : undefined,
        voicePackageId: isCreateVoicePackageOrder.value
          ? createForm.voicePackageId
          : undefined,
        agentId: isCreateVoicePackageOrder.value
          ? createForm.agentId
          : undefined,
        replaceActiveVoiceTrainingTask: isCreateVoicePackageOrder.value
          ? createForm.replaceActiveVoiceTrainingTask
          : undefined,
      });
      createVisible.value = false;
      Message.success(`${createSubmitText.value}已创建`);
      fetchData();
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '创建订单失败，请稍后重试'
      );
    } finally {
      createSubmitting.value = false;
    }
  };

  const handleRefund = async (record: OrderRecord) => {
    if (refundLoadingId.value) {
      return;
    }

    refundLoadingId.value = record.id;

    try {
      const { data } = await refundOrderApi(record.id);

      replaceOrderRecord(data);
      if (
        data.status === 'refunded' &&
        (data.voiceMembershipDowngrade?.status !== 'completed' ||
          data.voiceMembershipFinalRefund?.status === 'completed')
      ) {
        Message.success(getRefundSuccessText(data));
      } else if (data.status === 'refunded') {
        Message.warning(
          data.voiceMembershipFinalRefund?.status === 'benefits_failed'
            ? '退款已成功，但原订单会员权益回收失败，请重试撤权'
            : '退款已成功，原订单会员权益正在回收，请稍后刷新'
        );
      } else {
        Message.warning('微信仍在处理退款，会员权益尚未收回，请稍后刷新退款');
      }
    } catch (error) {
      fetchData();
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '退订失败，请稍后重试'
      );
    } finally {
      refundLoadingId.value = '';
    }
  };

  const handleRevokeAdminManualOrder = async (record: OrderRecord) => {
    if (revokeLoadingId.value) {
      return;
    }

    revokeLoadingId.value = record.id;

    try {
      const { data } = await revokeAdminManualOrderApi(record.id);

      replaceOrderRecord(data);

      Message.success(getRevokeSuccessText(record));
    } catch (error) {
      Message.error(
        error instanceof Error && error.message
          ? error.message
          : '回收失败，请稍后重试'
      );
    } finally {
      revokeLoadingId.value = '';
    }
  };

  const canOpenOrderUser = (record: OrderRecord) => {
    return Boolean(record.userId);
  };

  const openUserDetail = (record: OrderRecord) => {
    if (!record.userId) {
      return;
    }

    router.push({
      name: 'AppUserDetail',
      params: {
        id: record.userId,
      },
    });
  };

  const formatDate = (value?: string) => {
    return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-';
  };

  const formatAmount = (value: number) => {
    return `¥${((value || 0) / 100).toFixed(2)}`;
  };

  const formatAnalyticsMoney = (value?: number) => {
    return `¥${Number(value || 0).toLocaleString('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const formatCount = (value?: number) =>
    Number(value || 0).toLocaleString('zh-CN');
  const formatPercent = (value?: number) => `${Number(value || 0).toFixed(1)}%`;
  const formatRegisteredMonth = (value?: string) =>
    value ? dayjs(value).format('YYYY-MM') : '-';

  const formatOptionalAmount = (value?: number) => {
    return value == null ? '-' : formatAmount(value);
  };

  const getStatusText = (status: OrderStatusDTO) => {
    return statusMap[status]?.text ?? status;
  };

  const getStatusColor = (status: OrderStatusDTO) => {
    return statusMap[status]?.color ?? 'gray';
  };

  const getRecordStatusText = (record: OrderRecord) => {
    const finalRefund = record.voiceMembershipFinalRefund;

    if (finalRefund?.status === 'benefits_failed') {
      return '退款成功，权益待回收';
    }

    if (finalRefund?.status === 'benefits_processing') {
      return '退款成功，权益回收中';
    }

    if (finalRefund?.status === 'processing') {
      return '微信退款处理中';
    }

    if (
      finalRefund?.status === 'failed' &&
      finalRefund.wechatRefundStatus === 'CLOSED'
    ) {
      return '微信退款已关闭';
    }

    if (finalRefund?.status === 'failed') {
      return '微信退款异常';
    }

    if (record.status === 'refunded' || record.status === 'refund_requested') {
      return getStatusText(record.status);
    }

    if (record.voiceMembershipDowngrade) {
      return getVoiceMembershipDowngradeStatusText(record);
    }

    return isRevokedAdminManualOrder(record)
      ? '已回收'
      : getStatusText(record.status);
  };

  const getRecordStatusColor = (record: OrderRecord) => {
    const finalRefund = record.voiceMembershipFinalRefund;

    if (
      finalRefund?.status === 'benefits_failed' ||
      finalRefund?.status === 'failed'
    ) {
      return 'red';
    }

    if (
      finalRefund?.status === 'processing' ||
      finalRefund?.status === 'benefits_processing'
    ) {
      return 'orange';
    }

    if (record.status === 'refunded' || record.status === 'refund_requested') {
      return getStatusColor(record.status);
    }

    if (record.voiceMembershipDowngrade?.status === 'completed') {
      return 'orange';
    }

    if (record.voiceMembershipDowngrade?.status === 'failed') {
      return 'red';
    }

    if (record.voiceMembershipDowngrade) {
      return 'arcoblue';
    }

    return isRevokedAdminManualOrder(record)
      ? 'gray'
      : getStatusColor(record.status);
  };

  const getVoiceMembershipDowngradeStatusText = (record: OrderRecord) => {
    const status = record.voiceMembershipDowngrade?.status;

    if (status === 'completed') {
      return '已降为基础版';
    }

    if (status === 'benefits_failed') {
      return '降级权益待处理';
    }

    if (status === 'failed') {
      return '降级失败';
    }

    return status === 'processing'
      ? '降级退款中'
      : getStatusText(record.status);
  };

  const getVoiceMembershipFinalRefundStatusText = (record: OrderRecord) => {
    const status = record.voiceMembershipFinalRefund?.status;

    if (status === 'completed') return '已退款并收回权益';
    if (status === 'benefits_processing') return '退款成功，正在收回权益';
    if (status === 'benefits_failed') return '退款成功，权益回收失败';
    if (status === 'failed') return '退款失败';
    return status === 'processing' ? '微信退款处理中' : '-';
  };

  const getSourceText = (source: OrderSourceDTO) => {
    return sourceMap[source] ?? source;
  };

  const getPaymentProviderText = (provider?: string) => {
    if (provider === 'wechat_pay') {
      return '微信支付';
    }

    if (provider === 'wechat_virtual_pay') {
      return '微信虚拟支付';
    }

    if (provider === 'admin_manual') {
      return '管理端创建';
    }

    return provider || '-';
  };

  const isVirtualPaymentOrder = (record: OrderRecord) => {
    return record.paymentProvider === 'wechat_virtual_pay';
  };

  const isAdminManualOrder = (record: OrderRecord) => {
    return record.paymentProvider === 'admin_manual';
  };

  const isRevokedAdminManualOrder = (record: OrderRecord) => {
    return isAdminManualOrder(record) && record.status === 'closed';
  };

  const getVirtualGoodsProvideStatus = (
    record: OrderRecord
  ): VirtualGoodsProvideStatusDTO | undefined => {
    if (!isVirtualPaymentOrder(record)) {
      return undefined;
    }

    if (record.virtualGoodsProvideStatus) {
      return record.virtualGoodsProvideStatus;
    }

    if (record.virtualGoodsProvidedAt) {
      return 'provided';
    }

    return record.status === 'completed' ? 'pending' : undefined;
  };

  const isVirtualGoodsProvided = (record: OrderRecord) => {
    return getVirtualGoodsProvideStatus(record) === 'provided';
  };

  const getVirtualGoodsProvideStatusText = (record: OrderRecord) => {
    const status = getVirtualGoodsProvideStatus(record);
    return status ? virtualGoodsProvideStatusMap[status].text : '-';
  };

  const getVirtualGoodsProvideStatusColor = (record: OrderRecord) => {
    const status = getVirtualGoodsProvideStatus(record);
    return status ? virtualGoodsProvideStatusMap[status].color : 'gray';
  };

  const getVirtualGoodsProvideError = (record: OrderRecord) => {
    return getVirtualGoodsProvideStatus(record) === 'failed'
      ? record.virtualGoodsProvideError || ''
      : '';
  };

  const showSyncPaymentStatusMessage = (
    record: OrderRecord,
    previousStatus: OrderStatusDTO,
    previousVirtualGoodsProvideStatus?: VirtualGoodsProvideStatusDTO
  ) => {
    if (isVirtualPaymentOrder(record) && record.status === 'completed') {
      const virtualGoodsProvideStatus = getVirtualGoodsProvideStatus(record);

      if (virtualGoodsProvideStatus === 'failed') {
        Message.error(
          record.virtualGoodsProvideError ||
            '微信发货同步失败，请检查配置后重试'
        );
        return;
      }

      if (
        virtualGoodsProvideStatus === 'provided' &&
        previousVirtualGoodsProvideStatus !== 'provided'
      ) {
        Message.success('微信发货状态已同步为已发货');
        return;
      }

      if (virtualGoodsProvideStatus === 'pending') {
        Message.warning('订单状态已刷新，微信发货仍待确认');
        return;
      }
    }

    Message.success(
      record.status === previousStatus
        ? '已从微信刷新订单状态'
        : `已从微信同步为${getStatusText(record.status)}`
    );
  };

  const getRefundConfirmContent = (record: OrderRecord) => {
    if (
      record.orderType === 'vip_plan' &&
      record.voiceMembershipDowngrade?.status === 'completed'
    ) {
      if (record.voiceMembershipFinalRefund?.status === 'benefits_failed') {
        return '退款已经成功。确认重新收回该退款订单对应的会员身份和权益？后续新订单权益不受影响，也不会再次发起微信退款。';
      }

      if (record.voiceMembershipFinalRefund?.status === 'benefits_processing') {
        return '退款已经成功。确认重试收回该退款订单对应的会员身份和权益？后续新订单权益不受影响，也不会再次发起微信退款。';
      }

      if (
        record.voiceMembershipFinalRefund?.status === 'failed' &&
        record.voiceMembershipFinalRefund.wechatRefundStatus === 'CLOSED'
      ) {
        return `上一笔微信退款已关闭。确认使用新的退款单号重新发起剩余 ${formatAmount(
          getRemainingRefundAmount(record)
        )} 退款？只有微信确认成功后才会收回会员权益。`;
      }

      if (record.voiceMembershipFinalRefund?.status === 'failed') {
        return '微信退款状态异常。请先在微信支付商户平台完成处理，再刷新同一退款单；系统不会改用新退款单号。';
      }

      if (record.status === 'refund_requested') {
        return '确认刷新退款状态？仅当微信确认退款成功后，系统才会收回该退款订单对应的会员身份和权益；后续新订单权益不受影响。';
      }

      return `确认退订该已降级会员？系统会继续原路退回剩余 ${formatAmount(
        getRemainingRefundAmount(record)
      )}，退款成功后将收回该订单对应的会员身份和权益；后续新订单权益不受影响。`;
    }

    return record.orderType === 'voice_package'
      ? '确认退订该声音套餐订单？系统会发起微信退款并撤回声音训练任务。'
      : '确认退订该会员订单？系统会发起微信退款并收回会员权益。';
  };

  const getRefundActionText = (record: OrderRecord) => {
    if (record.voiceMembershipFinalRefund?.status === 'benefits_failed') {
      return '重试撤权';
    }

    if (record.voiceMembershipFinalRefund?.status === 'benefits_processing') {
      return '重试权益回收';
    }

    if (
      record.voiceMembershipFinalRefund?.status === 'failed' &&
      record.voiceMembershipFinalRefund.wechatRefundStatus === 'CLOSED'
    ) {
      return '重新发起退款';
    }

    if (record.voiceMembershipFinalRefund?.status === 'failed') {
      return '商户处理后刷新';
    }

    return record.status === 'refund_requested' &&
      record.voiceMembershipDowngrade?.status === 'completed'
      ? '刷新退款'
      : '退订';
  };

  const getRefundSuccessText = (record: OrderRecord) => {
    if (
      record.orderType === 'vip_plan' &&
      record.voiceMembershipDowngrade?.status === 'completed'
    ) {
      return '剩余会员费已退款，原订单会员身份和权益已收回';
    }

    return record.orderType === 'voice_package'
      ? '退订退款已提交，声音训练任务已撤回'
      : '退订退款已提交，会员权益已收回';
  };

  const getRevokeConfirmContent = (record: OrderRecord) => {
    return record.orderType === 'voice_package'
      ? '确认回收该声音套餐订单？系统会撤回声音训练任务，不涉及支付退款。'
      : '确认回收该会员订单？系统会收回会员权益，不涉及支付退款。';
  };

  const getRevokeSuccessText = (record: OrderRecord) => {
    return record.orderType === 'voice_package'
      ? '回收成功，声音训练任务已撤回'
      : '回收成功，会员权益已收回';
  };

  const getClosedAtLabel = (record: OrderRecord) => {
    return isAdminManualOrder(record) ? '回收时间' : '关闭时间';
  };

  const resolveOrderUserName = (record: OrderRecord) => {
    return record.user?.name || record.user?.account || '用户ID';
  };

  const resolveOrderUserContact = (record: OrderRecord) => {
    return record.user?.phone || record.user?.account || record.userId || '-';
  };

  const formatUserOption = (record: AppUserRecord) => {
    return [
      record.name || record.account || record.phone || record.id,
      record.phone && record.phone !== record.name ? record.phone : '',
      record.account &&
      record.account !== record.phone &&
      record.account !== record.name
        ? record.account
        : '',
    ]
      .filter(Boolean)
      .join(' / ');
  };

  const formatVipPlanOption = (record: VipPlanRecord) => {
    const duration = record.lifetime ? '永久' : `${record.durationDays ?? 0}天`;

    return `${record.name} / ${formatAmount(record.priceAmount)} / ${duration}`;
  };

  const formatVoicePackageOption = (record: VoicePackageRecord) => {
    return `${record.name} / ${formatAmount(record.priceAmount)}`;
  };

  const formatAgentOption = (record: AppUserAgentRecord) => {
    return record.name ? `${record.name} / ${record.id}` : record.id;
  };

  watch(
    () => [props.orderType, props.userId],
    () => {
      pagination.current = 1;
      closeDetail();
      fetchData();
    }
  );

  fetchData();
  fetchAnalytics();
</script>

<script lang="ts">
  export default {
    name: 'OrderListPanel',
  };
</script>

<style lang="less" scoped>
  .order-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &--embedded {
      padding: 0;
      background: transparent;
    }

    &__card {
      min-height: calc(100vh - 112px);
      border-radius: 4px;

      &--embedded {
        min-height: 0;
      }
    }

    &__search {
      margin-bottom: 16px;
    }

    &__analytics {
      margin-bottom: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--color-border-2);
    }

    &__analytics-header {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;

      h2 {
        margin: 0 0 4px;
        font-size: 18px;
      }

      span {
        color: var(--color-text-3);
      }
    }

    &__analytics-summary {
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      overflow: hidden;
      background: var(--color-fill-1);
      border: 1px solid var(--color-border-2);
      border-radius: 8px;

      article {
        min-width: 0;
        padding: 14px;
        border-right: 1px solid var(--color-border-2);

        &:last-child {
          border-right: 0;
        }

        span,
        small {
          display: block;
          overflow: hidden;
          color: var(--color-text-3);
          font-size: 12px;
          white-space: nowrap;
          text-overflow: ellipsis;
        }

        strong {
          display: block;
          margin: 8px 0 4px;
          overflow: hidden;
          font-weight: 500;
          font-size: 20px;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }
    }

    &__analytics-chart {
      margin-top: 14px;
      background: var(--color-fill-1);
    }

    &__filter {
      width: 140px;
    }

    &__range-filter {
      width: 340px;
    }

    &__registered-month {
      width: 160px;
    }

    &__full {
      width: 100%;
    }

    &__spin {
      display: block;
      width: 100%;
      min-height: 120px;
    }

    &__downgrade-confirm {
      margin-top: 16px;
    }

    &__pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__total,
    &__muted {
      color: var(--color-text-2);
      font-size: 14px;
    }

    &__main,
    &__user {
      min-width: 0;
    }

    &__order-no {
      max-width: 220px;
    }

    &__agent-id {
      max-width: 180px;
    }

    &__title,
    &__user-name {
      margin-top: 4px;
      overflow: hidden;
      color: var(--color-text-1);
      font-weight: 500;
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__mono {
      display: inline-block;
      overflow: hidden;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas,
        'Liberation Mono', monospace;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;
    }

    &__ellipsis {
      max-width: 180px;
    }

    &__refund-amount {
      margin-top: 4px;
      color: rgb(var(--red-6));
      font-size: 12px;
    }

    &__modal-footer {
      display: flex;
      justify-content: flex-end;
      margin-top: 24px;
    }
  }

  @media (max-width: 1080px) {
    .order-page__analytics-summary {
      grid-template-columns: repeat(2, minmax(0, 1fr));

      article:last-child {
        grid-column: 1 / -1;
      }
    }
  }
</style>
