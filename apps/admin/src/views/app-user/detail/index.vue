<template>
  <div class="app-user-detail-page">
    <a-card class="app-user-detail-page__profile-card" :bordered="false">
      <template #title>
        <a-breadcrumb class="app-user-detail-page__breadcrumb">
          <a-breadcrumb-item>
            <a-link @click="goBack">用户与关系</a-link>
          </a-breadcrumb-item>
          <a-breadcrumb-item>用户详情</a-breadcrumb-item>
        </a-breadcrumb>
      </template>

      <a-spin :loading="loading">
        <div v-if="user" class="app-user-detail-page__profile">
          <a-avatar :size="72">
            <img
              v-if="isRenderableAvatar(user.avatar)"
              :src="user.avatar"
              alt="avatar"
            />
            <template v-else>
              {{ getAvatarFallback(user.name) }}
            </template>
          </a-avatar>

          <div class="app-user-detail-page__profile-main">
            <div class="app-user-detail-page__profile-heading">
              <div>
                <div class="app-user-detail-page__name">
                  {{ user.name || '-' }}
                </div>
                <a-typography-text
                  class="app-user-detail-page__user-id"
                  copyable
                >
                  {{ user.id }}
                </a-typography-text>
              </div>
              <a-space class="app-user-detail-page__profile-tags">
                <a-tag :color="user.phoneVerified ? 'green' : 'gray'">
                  {{ user.phoneVerified ? '手机已验证' : '手机未验证' }}
                </a-tag>
                <a-tag :color="user.isVip ? 'gold' : 'gray'">
                  {{ user.isVip ? 'VIP会员' : '普通用户' }}
                </a-tag>
                <a-tag :color="getRiskControlColor(user)">
                  {{ getRiskControlStatusText(user) }}
                </a-tag>
              </a-space>
            </div>

            <a-descriptions
              class="app-user-detail-page__descriptions"
              :column="{ xs: 1, sm: 2, md: 3 }"
              size="small"
            >
              <a-descriptions-item label="登录账号">
                {{ user.account || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="手机号">
                {{ user.phone || '-' }}
              </a-descriptions-item>
              <a-descriptions-item label="人员风控">
                {{ formatRiskControlText(user) }}
              </a-descriptions-item>
              <a-descriptions-item label="注册时间">
                {{ formatDate(user.createdAt) }}
              </a-descriptions-item>
              <a-descriptions-item label="更新时间">
                {{ formatDate(user.updatedAt) }}
              </a-descriptions-item>
            </a-descriptions>
          </div>
        </div>

        <a-empty v-else description="暂无用户信息" />
      </a-spin>
    </a-card>

    <a-card class="app-user-detail-page__tabs-card" :bordered="false">
      <a-tabs v-model:active-key="activeTab" @change="handleTabChange">
        <a-tab-pane key="agents" title="关系智能体">
          <a-card :bordered="false">
            <a-form
              :model="agentSearchForm"
              layout="inline"
              class="app-user-detail-page__agent-search"
            >
              <a-form-item field="keyword" label="名字">
                <a-input
                  v-model="agentSearchForm.keyword"
                  allow-clear
                  placeholder="搜索智能体名字"
                  @press-enter="handleAgentSearch"
                />
              </a-form-item>
              <a-form-item>
                <a-space>
                  <a-button
                    type="primary"
                    :loading="agentsLoading"
                    @click="handleAgentSearch"
                  >
                    查询
                  </a-button>
                  <a-button @click="resetAgentSearch">重置</a-button>
                </a-space>
              </a-form-item>
            </a-form>

            <a-table
              row-key="id"
              :data="agentList"
              :loading="agentsLoading"
              :pagination="false"
              :bordered="false"
              :scroll="{ x: 1220 }"
            >
              <template #empty>
                <a-empty description="暂无关系智能体" />
              </template>
              <template #columns>
                <a-table-column title="智能体" data-index="name" :width="260">
                  <template #cell="{ record }">
                    <a-space>
                      <a-avatar
                        :size="40"
                        class="app-user-detail-page__agent-avatar"
                        @click="goAgentDetail(record.id)"
                      >
                        <img
                          v-if="isRenderableAvatar(record.avatar)"
                          :src="record.avatar"
                          alt="agent avatar"
                        />
                        <template v-else>
                          {{ getAvatarFallback(record.name, 'A') }}
                        </template>
                      </a-avatar>
                      <div class="app-user-detail-page__agent-identity">
                        <div class="app-user-detail-page__agent-name">
                          <a-link @click="goAgentDetail(record.id)">
                            {{ record.name || '-' }}
                          </a-link>
                        </div>
                        <a-tooltip :content="record.id">
                          <a-typography-text
                            class="app-user-detail-page__agent-id"
                            copyable
                          >
                            {{ record.id }}
                          </a-typography-text>
                        </a-tooltip>
                      </div>
                    </a-space>
                  </template>
                </a-table-column>
                <a-table-column title="性别" data-index="sex" :width="90">
                  <template #cell="{ record }">
                    <a-tag :color="record.sex === 1 ? 'blue' : 'magenta'">
                      {{ formatSex(record.sex) }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column title="称呼关系" :width="220">
                  <template #cell="{ record }">
                    <div class="app-user-detail-page__calls">
                      <a-tooltip
                        :content="`用户称呼TA：${record.iCallAgent || '-'}`"
                      >
                        <span class="app-user-detail-page__call-line">
                          用户称呼TA：{{ record.iCallAgent || '-' }}
                        </span>
                      </a-tooltip>
                      <a-tooltip
                        :content="`TA称呼用户：${record.agentCallMe || '-'}`"
                      >
                        <span class="app-user-detail-page__call-line">
                          TA称呼用户：{{ record.agentCallMe || '-' }}
                        </span>
                      </a-tooltip>
                    </div>
                  </template>
                </a-table-column>
                <a-table-column
                  title="聊天次数"
                  data-index="conversationCount"
                  :width="110"
                >
                  <template #cell="{ record }">
                    <a-link @click="goAgentDetail(record.id)">
                      {{ record.conversationCount ?? 0 }}
                    </a-link>
                  </template>
                </a-table-column>
                <a-table-column title="状态" data-index="status" :width="100">
                  <template #cell="{ record }">
                    <a-tag :color="record.status === 1 ? 'green' : 'gray'">
                      {{ formatStatus(record.status) }}
                    </a-tag>
                  </template>
                </a-table-column>
                <a-table-column
                  title="更新时间"
                  data-index="updatedAt"
                  :width="180"
                >
                  <template #cell="{ record }">
                    {{ formatDate(record.updatedAt) }}
                  </template>
                </a-table-column>
                <a-table-column
                  title="操作"
                  :width="120"
                  fixed="right"
                  align="center"
                >
                  <template #cell="{ record }">
                    <a-link @click="openMessenger(record)">聊天与记忆</a-link>
                  </template>
                </a-table-column>
              </template>
            </a-table>

            <div class="app-user-detail-page__agent-pagination">
              <span class="app-user-detail-page__agent-total">
                共 {{ agentPagination.total }} 个智能体
              </span>
              <a-pagination
                :current="agentPagination.current"
                :page-size="agentPagination.pageSize"
                :total="agentPagination.total"
                show-page-size
                @change="onAgentPageChange"
                @page-size-change="onAgentPageSizeChange"
              />
            </div>
          </a-card>
        </a-tab-pane>
        <a-tab-pane key="memory" title="账号级记忆">
          <a-spin :loading="accountMemoryLoading">
            <div class="app-user-detail-page__memory-layout">
              <a-card title="用户身份记忆" :bordered="false">
                <a-descriptions
                  v-if="accountMemory?.identity"
                  :column="{ xs: 1, md: 2 }"
                  bordered
                  size="small"
                >
                  <a-descriptions-item label="真实姓名">
                    {{ accountMemory.identity.realName || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="别名">
                    {{ accountMemory.identity.aliases.join('、') || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="曾用名">
                    {{ accountMemory.identity.formerNames.join('、') || '-' }}
                  </a-descriptions-item>
                  <a-descriptions-item label="更新时间">
                    {{ formatDate(accountMemory.identity.updatedAt) }}
                  </a-descriptions-item>
                  <a-descriptions-item label="记忆来源" :span="2">
                    {{ accountMemory.identity.sourceText || '-' }}
                  </a-descriptions-item>
                </a-descriptions>
                <a-empty v-else description="暂无用户身份记忆" />
              </a-card>

              <a-card
                :title="`已识别人物（${accountMemory?.people.length ?? 0}）`"
                :bordered="false"
              >
                <a-collapse v-if="accountMemory?.people.length">
                  <a-collapse-item
                    v-for="person in accountMemory.people"
                    :key="person.id"
                    :header="formatMemoryPersonTitle(person)"
                  >
                    <a-space wrap class="app-user-detail-page__memory-tags">
                      <a-tag v-if="person.relationToUser" color="arcoblue">
                        {{ person.relationToUser }}
                      </a-tag>
                      <a-tag v-for="alias in person.aliases" :key="alias">
                        {{ alias }}
                      </a-tag>
                    </a-space>
                    <a-descriptions
                      :column="{ xs: 1, md: 3 }"
                      size="small"
                      class="app-user-detail-page__memory-person"
                    >
                      <a-descriptions-item label="人物ID">
                        <a-typography-text copyable>
                          {{ person.id }}
                        </a-typography-text>
                      </a-descriptions-item>
                      <a-descriptions-item label="生命阶段">
                        {{ formatLifeStage(person.profile?.lifeStage) }}
                      </a-descriptions-item>
                      <a-descriptions-item label="更新时间">
                        {{ formatDate(person.updatedAt) }}
                      </a-descriptions-item>
                      <a-descriptions-item label="识别来源" :span="3">
                        {{ person.sourceText || '-' }}
                      </a-descriptions-item>
                    </a-descriptions>
                    <a-table
                      :data="person.facts"
                      :pagination="false"
                      size="small"
                      :bordered="false"
                    >
                      <template #empty>
                        <a-empty description="暂无人物事实" />
                      </template>
                      <template #columns>
                        <a-table-column title="领域" :width="110">
                          <template #cell="{ record }">
                            {{ formatMemoryDomain(record.domain) }}
                          </template>
                        </a-table-column>
                        <a-table-column title="记忆内容" data-index="value" />
                        <a-table-column title="状态" :width="100">
                          <template #cell="{ record }">
                            {{ formatMemoryStatus(record.status) }}
                          </template>
                        </a-table-column>
                        <a-table-column title="更新时间" :width="170">
                          <template #cell="{ record }">
                            {{ formatDate(record.updatedAt) }}
                          </template>
                        </a-table-column>
                      </template>
                    </a-table>
                  </a-collapse-item>
                </a-collapse>
                <a-empty v-else description="暂无账号级人物记忆" />
              </a-card>
            </div>
          </a-spin>
        </a-tab-pane>
        <a-tab-pane key="posts" title="用户动态">
          <post-list-panel
            v-if="activeTab === 'posts'"
            title="用户动态"
            :user-id="userId || ''"
            embedded
          />
        </a-tab-pane>
        <a-tab-pane key="orders" title="用户订单">
          <order-list-panel
            v-if="activeTab === 'orders'"
            title="用户订单"
            :user-id="userId || ''"
            embedded
          />
        </a-tab-pane>
        <a-tab-pane key="voice" title="声音模型">
          <a-card
            class="agent-vt-link-card"
            :bordered="false"
            style="margin-bottom: 16px"
          >
            <template #title>
              <div style="display: flex; align-items: center; gap: 8px">
                <span>对话式训练入口</span>
                <a-tag color="arcoblue" size="small">唯一链接</a-tag>
              </div>
            </template>
            <div style="display: flex; gap: 8px; margin-bottom: 8px">
              <a-input
                :model-value="agentVtUrl"
                placeholder="点击「生成链接」获取该账号的对话式训练入口"
                readonly
                allow-clear
                @clear="agentVtUrl = ''"
              >
                <template #append>
                  <a-button type="text" :disabled="!agentVtUrl" @click="copyAgentVtUrl">
                    复制
                  </a-button>
                </template>
              </a-input>
              <a-button
                type="primary"
                :loading="agentVtLoading"
                @click="loadAgentVtLink"
              >
                {{ agentVtUrl ? '重新获取' : '生成链接' }}
              </a-button>
            </div>
            <div style="font-size: 12px; color: #86909c; line-height: 1.6">
              通过该链接可对话式上传音频训练声音，训练完成后自动绑定到该账号的默认 AI 亲人。
            </div>
          </a-card>
          <voice-model-panel
            v-if="activeTab === 'voice'"
            :user-id="userId || ''"
            :user-name="user?.name || ''"
            :appellation="agentList[0]?.iCallAgent || '妈妈'"
            embedded
          />
        </a-tab-pane>
      </a-tabs>
    </a-card>

    <a-drawer
      v-model:visible="messengerVisible"
      class="app-user-detail-page__chat-drawer"
      :width="chatDrawerWidth"
      :title="chatDrawerTitle"
      :footer="false"
      unmount-on-close
    >
      <div class="app-user-detail-page__chat-layout">
        <section class="app-user-detail-page__chat-left">
          <a-alert
            v-if="messengerAgent?.messengerOfAgentId"
            type="info"
            :show-icon="false"
          >
            发送内容会以小使者「{{
              messengerAgent?.name || ''
            }}」的身份出现在用户聊天里。
          </a-alert>
          <a-alert v-else type="normal" :show-icon="false">
            只读查看该用户与「{{ messengerAgent?.name || '' }}」的聊天记录。
          </a-alert>
          <div
            ref="messengerListRef"
            class="app-user-detail-page__messenger-list"
          >
            <a-spin :loading="messengerLoading" style="width: 100%">
              <div
                v-if="messengerHasMore"
                class="app-user-detail-page__messenger-more"
              >
                <a-link
                  :loading="messengerLoadingMore"
                  @click="loadOlderMessengerMessages()"
                >
                  加载更早消息
                </a-link>
              </div>
              <a-empty
                v-if="!messengerMessages.length"
                description="暂无聊天记录"
              />
              <div
                v-for="message in messengerMessages"
                :key="message.id"
                :data-message-id="message.id"
                class="app-user-detail-page__messenger-item"
                :class="{
                  'is-user': message.role === 'user',
                  'is-highlight': message.id === highlightMessageId,
                }"
              >
                <div class="app-user-detail-page__messenger-bubble">
                  <img
                    v-if="message.type === 'image' && message.mediaUrl"
                    :src="message.mediaUrl"
                    class="app-user-detail-page__messenger-image"
                    alt="message image"
                  />
                  <span v-if="message.content">{{ message.content }}</span>
                  <span v-else-if="message.type === 'image'">[图片]</span>
                  <span v-else-if="message.type === 'voice'">[语音]</span>
                  <span v-else>[消息]</span>
                </div>
                <span class="app-user-detail-page__messenger-time">
                  {{ formatDate(message.createdAt) }}
                </span>
              </div>
            </a-spin>
          </div>

          <div
            v-if="messengerAgent?.messengerOfAgentId"
            class="app-user-detail-page__messenger-editor"
          >
            <a-textarea
              v-model="messengerContent"
              placeholder="输入要发送给用户的文字"
              :auto-size="{ minRows: 2, maxRows: 4 }"
              :max-length="1000"
            />
            <div class="app-user-detail-page__messenger-actions">
              <a-upload
                :show-file-list="false"
                accept="image/*"
                :custom-request="handleMessengerImageUpload"
              >
                <a-button :loading="messengerSending">发送图片</a-button>
              </a-upload>
              <a-button
                type="primary"
                :loading="messengerSending"
                @click="sendMessengerText"
              >
                发送
              </a-button>
            </div>
          </div>
        </section>

        <aside class="app-user-detail-page__chat-right">
          <a-tabs
            v-model:active-key="rightPanelTab"
            class="app-user-detail-page__chat-right-tabs"
            lazy-load
          >
            <a-tab-pane key="core" title="核心信息">
              <core-info-panel
                :user-id="userId || ''"
                :agent-id="messengerAgent?.id || ''"
                :agent-name="messengerAgent?.name || ''"
                @locate-source="handleLocateSource"
              />
            </a-tab-pane>
            <a-tab-pane key="memory" title="已留存记忆">
              <memory-panel
                :user-id="userId || ''"
                :agent-id="messengerAgent?.id || ''"
                :agent-name="messengerAgent?.name || ''"
                @locate-source="handleLocateSource"
              />
            </a-tab-pane>
          </a-tabs>
        </aside>
      </div>
    </a-drawer>
  </div>
</template>

<script lang="ts" setup>
  import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    watch,
  } from 'vue';
  import { useRoute, useRouter } from 'vue-router';
  import dayjs from 'dayjs';
  import axios from 'axios';
  import { Message } from '@arco-design/web-vue';
  import type {
    AdminAppUserMessengerMessageDTO,
    SendAdminAppUserMessengerMessageRequestDTO,
  } from '@tzl/shared';
  import useLoading from '@/hooks/loading';
  import {
    AppUserAccountMemory,
    AppUserAgentRecord,
    AppUserRecord,
    queryAppUserAccountMemory,
    queryAppUserAgentMessages,
    queryAppUserAgents,
    queryAppUserDetail,
    sendAppUserMessengerMessage,
  } from '@/api/app-user';
  import uploadAdminFile from '@/api/storage';
  import OrderListPanel from '@/views/order/list/components/order-list-panel.vue';
  import PostListPanel from '@/views/post/components/post-list-panel.vue';
  import VoiceModelPanel from './voice-model-panel.vue';
  import MemoryPanel from './memory-panel.vue';
  import CoreInfoPanel from './core-info-panel.vue';

  const route = useRoute();
  const router = useRouter();
  const { loading, setLoading } = useLoading();
  const user = ref<AppUserRecord | null>(null);
  const agentList = ref<AppUserAgentRecord[]>([]);
  const agentsLoading = ref(false);
  const accountMemory = ref<AppUserAccountMemory | null>(null);
  const accountMemoryLoading = ref(false);
  const accountMemoryLoadedUserId = ref('');
  const activeTab = ref('agents');
  /** 右侧面板页签：核心信息（默认）/ 已留存记忆 */
  const rightPanelTab = ref('core');
  const agentSearchForm = reactive<{
    keyword: string;
  }>({
    keyword: '',
  });
  const agentPagination = reactive({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const messengerVisible = ref(false);
  const messengerAgent = ref<AppUserAgentRecord | null>(null);
  const messengerMessages = ref<AdminAppUserMessengerMessageDTO[]>([]);
  const messengerLoading = ref(false);
  const messengerLoadingMore = ref(false);
  const messengerHasMore = ref(false);
  const messengerSending = ref(false);
  const messengerContent = ref('');
  const messengerListRef = ref<HTMLElement | null>(null);
  const highlightMessageId = ref('');
  // 聊天请求序号：切换聊天对象或关闭抽屉后丢弃旧响应，防止覆盖新结果。
  let messengerRequestSeq = 0;
  // 定位来源时最多向前查找的页数，超过则提示「搜索达到上限」而非「来源不存在」。
  const LOCATE_MAX_PAGES = 8;

  // 抽屉实际宽度跟随视口，窄屏不再固定 1120px 溢出。
  const viewportWidth = ref(
    typeof window === 'undefined' ? 1440 : window.innerWidth
  );
  const chatDrawerWidth = computed(() =>
    viewportWidth.value < 1120 ? '100%' : 1120
  );
  const syncViewportWidth = () => {
    viewportWidth.value = window.innerWidth;
  };
  onMounted(() => {
    window.addEventListener('resize', syncViewportWidth);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', syncViewportWidth);
    // 页面卸载后丢弃聊天侧在途结果
    messengerRequestSeq += 1;
  });

  const chatDrawerTitle = computed(() => {
    const name = messengerAgent.value?.name || '';
    return messengerAgent.value?.messengerOfAgentId
      ? `聊天与已留存记忆 · 小使者「${name}」`
      : `聊天与已留存记忆 · ${name}`;
  });

  const userId = computed(() => {
    const { id } = route.params;
    return Array.isArray(id) ? id[0] : id;
  });

  const agentVtUrl = ref('');
  const agentVtLoading = ref(false);

  const loadAgentVtLink = async () => {
    if (!userId.value) {
      Message.warning('缺少用户 ID');
      return;
    }
    agentVtLoading.value = true;
    try {
      const { data } = await axios.get(`/admin_api/agent-vt/links/${userId.value}`);
      agentVtUrl.value = `${window.location.origin}/admin_api/agent_vt/p/${data.token}`;
      Message.success('已生成对话式训练入口链接');
    } catch (error) {
      Message.error((error as Error).message || '生成训练入口链接失败');
    } finally {
      agentVtLoading.value = false;
    }
  };

  const copyAgentVtUrl = async () => {
    if (!agentVtUrl.value) return;
    try {
      await navigator.clipboard.writeText(agentVtUrl.value);
      Message.success('链接已复制');
    } catch {
      Message.error('复制失败，请手动复制');
    }
  };

  watch(userId, (id) => {
    agentVtUrl.value = '';
    if (id && activeTab.value === 'voice') {
      loadAgentVtLink();
    }
  });

  watch(activeTab, (tab) => {
    if (tab === 'voice' && userId.value && !agentVtUrl.value && !agentVtLoading.value) {
      loadAgentVtLink();
    }
  });

  const fetchUserDetail = async (id?: string) => {
    if (!id) {
      user.value = null;
      return;
    }

    try {
      setLoading(true);
      const { data } = await queryAppUserDetail(id);
      user.value = data;
    } catch (error) {
      user.value = null;
      Message.error('用户详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchUserAgents = async (id?: string) => {
    if (!id) {
      agentList.value = [];
      agentPagination.total = 0;
      return;
    }

    try {
      agentsLoading.value = true;
      const { data } = await queryAppUserAgents(id, {
        keyword: agentSearchForm.keyword.trim() || undefined,
        page: agentPagination.current,
        pageSize: agentPagination.pageSize,
      });
      agentList.value = data.items;
      agentPagination.total = data.total;
      agentPagination.current = data.page;
      agentPagination.pageSize = data.pageSize;
    } catch (error) {
      agentList.value = [];
      agentPagination.total = 0;
      Message.error('用户智能体加载失败');
    } finally {
      agentsLoading.value = false;
    }
  };

  const scrollMessengerToBottom = async () => {
    await nextTick();
    const el = messengerListRef.value;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  };

  const loadMessengerMessages = async () => {
    if (!userId.value || !messengerAgent.value) return;
    messengerRequestSeq += 1;
    const seq = messengerRequestSeq;
    const targetUserId = userId.value;
    const targetAgentId = messengerAgent.value.id;
    try {
      messengerLoading.value = true;
      const { data } = await queryAppUserAgentMessages(
        targetUserId,
        targetAgentId,
        { pageSize: 50 }
      );
      if (seq !== messengerRequestSeq) {
        return;
      }
      messengerMessages.value = data.items;
      messengerHasMore.value = data.hasMore;
      await scrollMessengerToBottom();
    } catch {
      if (seq !== messengerRequestSeq) {
        return;
      }
      messengerMessages.value = [];
      messengerHasMore.value = false;
      Message.error('聊天记录加载失败');
    } finally {
      if (seq === messengerRequestSeq) {
        messengerLoading.value = false;
      }
    }
  };

  /**
   * 加载更早消息。
   * expectedSeq 由调用方（定位流程）传入，绑定「发起时的对象与请求版本」；
   * 期间切换对象或关闭抽屉会使序号变化，此时丢弃结果、不再写入。
   */
  const loadOlderMessengerMessages = async (
    expectedSeq?: number
  ): Promise<boolean> => {
    if (
      !userId.value ||
      !messengerAgent.value ||
      !messengerHasMore.value ||
      messengerLoadingMore.value
    ) {
      return false;
    }
    const seq = messengerRequestSeq;
    if (expectedSeq !== undefined && expectedSeq !== seq) {
      return false;
    }
    const targetUserId = userId.value;
    const targetAgentId = messengerAgent.value.id;
    const earliest = messengerMessages.value[0];
    if (!earliest) return false;
    try {
      messengerLoadingMore.value = true;
      const { data } = await queryAppUserAgentMessages(
        targetUserId,
        targetAgentId,
        { pageSize: 50, before: earliest.createdAt }
      );
      if (seq !== messengerRequestSeq) {
        return false;
      }
      messengerMessages.value = [...data.items, ...messengerMessages.value];
      messengerHasMore.value = data.hasMore;
      return true;
    } catch {
      if (seq === messengerRequestSeq) {
        Message.error('更早消息加载失败');
      }
      return false;
    } finally {
      if (seq === messengerRequestSeq) {
        messengerLoadingMore.value = false;
      }
    }
  };

  const scrollMessageIntoView = async (messageId: string) => {
    await nextTick();
    const container = messengerListRef.value;
    if (!container) return;
    const target = container.querySelector<HTMLElement>(
      `[data-message-id="${messageId}"]`
    );
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  /**
   * 点击记忆来源定位左侧原话。
   * 绑定发起时的用户、聊天对象与请求版本：期间切换对象/关闭抽屉即放弃。
   * 找不到时区分两种情况：
   * - 已按现有分页能力向前查找达到上限（仍有更早历史）：提示可能更早；
   * - 历史已全部加载完仍没有：说明来源不在该用户与对象的聊天记录中。
   */
  const handleLocateSource = async ({ messageId }: { messageId: string }) => {
    const seq = messengerRequestSeq;
    const targetUserId = userId.value;
    const targetAgentId = messengerAgent.value?.id ?? '';
    const isSameTarget = () =>
      seq === messengerRequestSeq &&
      targetUserId === userId.value &&
      targetAgentId === messengerAgent.value?.id;

    highlightMessageId.value = messageId;
    const hasMessage = () =>
      messengerMessages.value.some((message) => message.id === messageId);

    if (hasMessage()) {
      await scrollMessageIntoView(messageId);
      return;
    }

    let attempts = 0;
    while (
      !hasMessage() &&
      messengerHasMore.value &&
      attempts < LOCATE_MAX_PAGES
    ) {
      if (!isSameTarget()) {
        return;
      }
      attempts += 1;
      // eslint-disable-next-line no-await-in-loop
      const advanced = await loadOlderMessengerMessages(seq);
      if (!advanced) break;
    }

    if (!isSameTarget()) {
      return;
    }

    if (hasMessage()) {
      await scrollMessageIntoView(messageId);
      return;
    }

    if (messengerHasMore.value) {
      Message.warning(
        `已向前查找 ${LOCATE_MAX_PAGES} 页仍未定位到来源，来源可能更早；可先「加载更早消息」后重试`
      );
    } else {
      Message.warning('该来源不在当前用户与聊天对象的聊天记录中');
    }
  };

  const openMessenger = async (record: AppUserAgentRecord) => {
    if (!userId.value) return;
    messengerRequestSeq += 1;
    messengerAgent.value = record;
    messengerContent.value = '';
    messengerMessages.value = [];
    messengerHasMore.value = false;
    messengerLoadingMore.value = false;
    highlightMessageId.value = '';
    messengerVisible.value = true;
    await loadMessengerMessages();
  };

  const sendMessenger = async (
    payload: SendAdminAppUserMessengerMessageRequestDTO
  ): Promise<boolean> => {
    if (!userId.value || !messengerAgent.value) return false;
    try {
      messengerSending.value = true;
      const { data } = await sendAppUserMessengerMessage(
        userId.value,
        messengerAgent.value.id,
        payload
      );
      messengerMessages.value.push(data);
      await scrollMessengerToBottom();
      return true;
    } catch (error) {
      Message.error((error as Error).message || '消息发送失败');
      return false;
    } finally {
      messengerSending.value = false;
    }
  };

  const sendMessengerText = async () => {
    const content = messengerContent.value.trim();
    if (!content) {
      Message.warning('请输入要发送的文字');
      return;
    }
    const sent = await sendMessenger({ type: 'text', content });
    if (sent) {
      messengerContent.value = '';
    }
  };

  const uploadAndSendMessengerImage = async (file: File) => {
    const contentType = file.type || 'image/jpeg';
    try {
      messengerSending.value = true;
      const { objectKey, publicUrl } = await uploadAdminFile(file, {
        folder: 'admin/messenger-message',
        contentType,
      });
      messengerSending.value = false;
      await sendMessenger({
        type: 'image',
        mediaObjectKey: objectKey,
        mediaUrl: publicUrl,
        mediaMimeType: contentType,
      });
    } catch (error) {
      messengerSending.value = false;
      Message.error((error as Error).message || '图片发送失败');
    }
  };

  const handleMessengerImageUpload = (option: {
    fileItem?: { file?: File };
  }) => {
    const file = option?.fileItem?.file;
    if (!file) return {};
    uploadAndSendMessengerImage(file).catch(() => undefined);
    return {};
  };

  const fetchAccountMemory = async (id?: string) => {
    if (!id || accountMemoryLoadedUserId.value === id) {
      return;
    }

    try {
      accountMemoryLoading.value = true;
      const { data } = await queryAppUserAccountMemory(id);
      accountMemory.value = data;
      accountMemoryLoadedUserId.value = id;
    } catch (error) {
      accountMemory.value = null;
      Message.error('账号级记忆加载失败');
    } finally {
      accountMemoryLoading.value = false;
    }
  };

  const handleTabChange = (key: string | number) => {
    if (key === 'memory') {
      fetchAccountMemory(userId.value);
    }
  };

  const goBack = () => {
    router.push({ name: 'AppUserList' });
  };

  const goAgentDetail = (agentId: string) => {
    if (!agentId) {
      return;
    }

    router.push({ name: 'AgentDetail', params: { id: agentId } });
  };

  const onAgentPageChange = (page: number) => {
    agentPagination.current = page;
    fetchUserAgents(userId.value);
  };

  const onAgentPageSizeChange = (pageSize: number) => {
    agentPagination.pageSize = pageSize;
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const handleAgentSearch = () => {
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const resetAgentSearch = () => {
    agentSearchForm.keyword = '';
    agentPagination.current = 1;
    fetchUserAgents(userId.value);
  };

  const formatDate = (value: string, pattern = 'YYYY-MM-DD HH:mm') => {
    return value ? dayjs(value).format(pattern) : '-';
  };

  const getAvatarFallback = (name: string, fallback = 'U') => {
    return name?.trim()?.slice(0, 1)?.toUpperCase() || fallback;
  };

  const formatSex = (sex: number) => {
    return sex === 1 ? '男性' : '女性';
  };

  const formatStatus = (status: number) => {
    return status === 1 ? '启用' : '禁用';
  };

  const formatMemoryPersonTitle = (
    person: AppUserAccountMemory['people'][number]
  ) => {
    const name = person.preferredName || person.realName || '未命名人物';
    return person.relationToUser ? `${name} · ${person.relationToUser}` : name;
  };

  const formatLifeStage = (value?: string) => {
    const labels: Record<string, string> = {
      newborn: '新生儿',
      infant: '婴儿',
      toddler: '幼儿',
      preschool: '学龄前',
      school_age: '学龄期',
      adolescent: '青少年',
      adult: '成年人',
      older_adult: '老年人',
      unknown: '未知',
    };
    return labels[value || 'unknown'] || value || '未知';
  };

  const formatMemoryDomain = (value: string) => {
    const labels: Record<string, string> = {
      health: '健康',
      growth: '成长',
      education: '教育',
      work: '工作',
      care: '照护',
      relationship: '关系',
      life_event: '人生事件',
      preference: '偏好',
      routine: '日常',
      other: '其他',
    };
    return labels[value] || value || '-';
  };

  const formatMemoryStatus = (value: string) => {
    const labels: Record<string, string> = {
      current: '当前',
      resolved: '已解决',
      historical: '历史',
      uncertain: '待确认',
    };
    return labels[value] || value || '-';
  };

  const getRiskControlStatusText = (record: AppUserRecord) => {
    if (record.isRiskControlled) {
      return '风控中';
    }

    return record.riskControlUntilAt ? '风控已过期' : '未风控';
  };

  const getRiskControlColor = (record: AppUserRecord) => {
    if (record.isRiskControlled) {
      return 'red';
    }

    return record.riskControlUntilAt ? 'orange' : 'green';
  };

  const formatRiskControlText = (record: AppUserRecord) => {
    if (!record.riskControlUntilAt) {
      return '未风控';
    }

    return `${getRiskControlStatusText(record)}，截止时间：${formatDate(
      record.riskControlUntilAt
    )}`;
  };

  const isRenderableAvatar = (avatar: string) => {
    const value = avatar?.trim();

    return Boolean(value && /^(https?:)?\/\//i.test(value));
  };

  watch(messengerVisible, (visible) => {
    if (!visible) {
      // 关闭抽屉后丢弃聊天侧与定位流程的在途结果
      messengerRequestSeq += 1;
      highlightMessageId.value = '';
      messengerLoadingMore.value = false;
    }
  });

  watch(
    userId,
    (id) => {
      // 切换用户：关闭聊天抽屉并丢弃旧对象/旧请求的结果
      messengerRequestSeq += 1;
      messengerVisible.value = false;
      messengerMessages.value = [];
      messengerHasMore.value = false;
      messengerLoadingMore.value = false;
      highlightMessageId.value = '';
      agentPagination.current = 1;
      accountMemory.value = null;
      accountMemoryLoadedUserId.value = '';
      fetchUserDetail(id);
      fetchUserAgents(id);
      if (activeTab.value === 'memory') {
        fetchAccountMemory(id);
      }
    },
    { immediate: true }
  );
</script>

<script lang="ts">
  export default {
    name: 'AppUserDetail',
  };
</script>

<style lang="less" scoped>
  .app-user-detail-page {
    min-height: 100%;
    padding: 16px 20px;
    background: var(--color-fill-2);

    &__profile-card,
    &__tabs-card {
      border-radius: 4px;
    }

    &__tabs-card {
      margin-top: 16px;
    }

    &__breadcrumb {
      line-height: 24px;
    }

    &__profile {
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }

    &__profile-main {
      flex: 1;
      min-width: 0;
    }

    &__profile-heading {
      display: flex;
      gap: 16px;
      align-items: flex-start;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    &__profile-tags {
      flex-shrink: 0;
    }

    &__name {
      margin-bottom: 6px;
      color: var(--color-text-1);
      font-weight: 500;
      font-size: 20px;
      line-height: 28px;
    }

    &__user-id {
      display: inline-block;
      max-width: 360px;
      overflow: hidden;
      color: var(--color-text-3);
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;

      :deep(.arco-typography-operation-copy) {
        margin-left: 6px;
      }
    }

    &__descriptions {
      :deep(.arco-descriptions-item-label) {
        color: var(--color-text-3);
      }
    }

    &__agent-identity {
      min-width: 0;
    }

    &__agent-search {
      margin-bottom: 16px;
    }

    &__memory-layout {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    &__memory-tags {
      margin-bottom: 12px;
    }

    &__memory-person {
      margin-bottom: 12px;
    }

    &__agent-avatar {
      cursor: pointer;
      transition: opacity 0.2s ease;

      &:hover {
        opacity: 0.82;
      }
    }

    &__agent-name {
      margin-bottom: 4px;
      font-weight: 500;
      line-height: 20px;
    }

    &__agent-id {
      display: inline-block;
      max-width: 176px;
      overflow: hidden;
      color: var(--color-text-3);
      font-size: 12px;
      white-space: nowrap;
      text-overflow: ellipsis;
      vertical-align: bottom;

      :deep(.arco-typography-operation-copy) {
        margin-left: 4px;
      }
    }

    &__calls {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    &__call-line {
      max-width: 180px;
      overflow: hidden;
      color: var(--color-text-2);
      white-space: nowrap;
      text-overflow: ellipsis;
    }

    &__agent-pagination {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 16px;
    }

    &__agent-total {
      color: var(--color-text-2);
      font-size: 14px;
    }

    &__chat-layout {
      display: flex;
      gap: 16px;
      height: calc(100vh - 120px);
      min-height: 0;
    }

    &__chat-left {
      display: flex;
      flex: 1 1 58%;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
      min-height: 0;
    }

    &__chat-right {
      display: flex;
      flex: 0 0 40%;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      padding: 12px;
      overflow: hidden;
      border-radius: 8px;
      background: var(--color-fill-2);
    }

    &__chat-right-tabs {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      min-height: 0;

      :deep(.arco-tabs-content) {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
      }

      :deep(.arco-tabs-content-list),
      :deep(.arco-tabs-pane) {
        height: 100%;
        min-height: 0;
      }
    }

    &__messenger-list {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: 12px;
      min-height: 0;
      overflow-y: auto;
      padding: 12px;
      border-radius: 8px;
      background: var(--color-fill-2);
    }

    &__messenger-more {
      display: flex;
      justify-content: center;
      margin-bottom: 8px;
    }

    &__messenger-item {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;

      &.is-user {
        align-items: flex-end;
      }

      &.is-highlight {
        .app-user-detail-page__messenger-bubble {
          box-shadow: 0 0 0 2px rgb(var(--warning-6));
        }
      }
    }

    &__messenger-bubble {
      max-width: 78%;
      padding: 8px 12px;
      color: var(--color-text-1);
      line-height: 1.5;
      word-break: break-word;
      white-space: pre-wrap;
      background: var(--color-bg-2);
      border-radius: 8px;

      .is-user & {
        color: #fff;
        background: rgb(var(--primary-6));
      }
    }

    &__messenger-image {
      display: block;
      max-width: 200px;
      max-height: 260px;
      margin-bottom: 4px;
      border-radius: 6px;
      object-fit: cover;
    }

    &__messenger-time {
      color: var(--color-text-3);
      font-size: 12px;
    }

    &__messenger-editor {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    &__messenger-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }
  }

  @media (max-width: 991px) {
    .app-user-detail-page {
      &__chat-layout {
        flex-direction: column;
        height: auto;
      }

      &__chat-left {
        flex: 1 1 auto;
      }

      &__chat-right {
        flex: 1 1 auto;
        max-height: 60vh;
      }

      &__messenger-list {
        max-height: 50vh;
      }
    }
  }

  @media (max-width: 575px) {
    .app-user-detail-page {
      &__profile {
        flex-direction: column;
      }

      &__profile-heading {
        flex-direction: column;
      }

      &__agent-pagination {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }
    }
  }
</style>
