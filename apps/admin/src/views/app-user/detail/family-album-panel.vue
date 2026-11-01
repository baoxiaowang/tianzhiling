<template>
  <div class="family-album-panel">
    <div class="family-album-panel__header">
      <div>
        <div class="family-album-panel__title">家人相册</div>
        <a-typography-text type="secondary">
          给「认识的人」登记人脸照片后，用户发照片时 AI
          才能认出是谁；识别只作为线索，不会直接断言。
        </a-typography-text>
      </div>
      <a-space>
        <a-button :loading="loading" @click="fetchPersons">刷新</a-button>
        <a-button type="primary" @click="openRecognize">识别测试</a-button>
      </a-space>
    </div>

    <a-table
      row-key="personId"
      :data="persons"
      :loading="loading"
      :pagination="false"
      :bordered="false"
    >
      <template #empty>
        <a-empty description="该用户还没有录入的「认识的人」" />
      </template>
      <template #columns>
        <a-table-column title="称呼" data-index="name" :width="180">
          <template #cell="{ record }">
            <a-space>
              <a-tag v-if="record.relation" size="small">{{
                record.relation
              }}</a-tag>
              <span>{{ record.name }}</span>
            </a-space>
          </template>
        </a-table-column>
        <a-table-column title="人脸照片" data-index="faceCount" :width="110">
          <template #cell="{ record }">
            <a-tag :color="record.faceCount > 0 ? 'green' : 'gray'">
              {{ record.faceCount }} 张
            </a-tag>
          </template>
        </a-table-column>
        <a-table-column title="最近登记" :width="170">
          <template #cell="{ record }">
            {{
              record.lastRegisteredAt
                ? formatTime(record.lastRegisteredAt)
                : '-'
            }}
          </template>
        </a-table-column>
        <a-table-column title="操作" :width="220">
          <template #cell="{ record }">
            <a-space>
              <a-button type="text" size="small" @click="openRegister(record)">
                登记人脸
              </a-button>
              <a-popconfirm
                content="清空这个人已登记的所有人脸照片？（识别将不再认识 TA）"
                ok-text="清空"
                cancel-text="取消"
                @ok="handleDelete(record)"
              >
                <a-button
                  type="text"
                  status="danger"
                  size="small"
                  :disabled="record.faceCount === 0"
                >
                  清空
                </a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </a-table-column>
      </template>
    </a-table>

    <a-modal
      v-model:visible="registerVisible"
      :title="`登记人脸 · ${registerTarget?.name || ''}`"
      :ok-loading="submitting"
      ok-text="开始登记"
      @ok="handleRegister"
    >
      <a-form :model="registerForm" layout="vertical">
        <a-form-item label="选择照片（可多选，建议 3~5 张不同角度）">
          <a-upload
            :auto-upload="false"
            :limit="10"
            accept="image/*"
            multiple
            @change="handleFileChange"
          />
        </a-form-item>
        <a-alert type="normal" show-icon>
          照片越清晰、角度越多，识别越准；小于 80px 或明显模糊的照片会自动跳过。
        </a-alert>
      </a-form>
    </a-modal>

    <a-modal
      v-model:visible="recognizeVisible"
      title="识别测试"
      :footer="false"
      width="720px"
    >
      <a-space direction="vertical" style="width: 100%">
        <a-upload
          :auto-upload="false"
          accept="image/*"
          :limit="1"
          @change="handleProbeChange"
        />
        <a-button
          type="primary"
          :loading="recognizing"
          :disabled="!probeFile"
          @click="handleRecognize"
        >
          识别
        </a-button>
        <a-table
          v-if="recognizeResult"
          :data="recognizeRows"
          :pagination="false"
          size="small"
          :bordered="false"
        >
          <template #columns>
            <a-table-column title="人脸" data-index="index" :width="70" />
            <a-table-column
              title="判定"
              data-index="decisionLabel"
              :width="110"
            />
            <a-table-column title="最像" data-index="top1Label" />
            <a-table-column title="距离" data-index="distance" :width="90" />
            <a-table-column title="质量" data-index="qualityLabel" />
          </template>
        </a-table>
        <a-typography-text v-if="recognizeResult" type="secondary">
          耗时 {{ recognizeResult.latencyMs }}ms · 模型
          {{ recognizeResult.model || '-' }}
        </a-typography-text>
      </a-space>
    </a-modal>
  </div>
</template>

<script lang="ts" setup>
  import { Message } from '@arco-design/web-vue';
  import { computed, onMounted, ref } from 'vue';
  import dayjs from 'dayjs';
  import uploadAdminFile from '@/api/storage';
  import {
    deleteFaceTemplates,
    queryFacePersons,
    recognizeFaceImage,
    registerFaceTemplates,
    type AdminFacePerson,
    type AdminFaceRecognizeFace,
    type AdminFaceRecognizeResult,
  } from '@/api/face';

  const props = defineProps<{ userId: string }>();

  const persons = ref<AdminFacePerson[]>([]);
  const loading = ref(false);
  const registerVisible = ref(false);
  const registerTarget = ref<AdminFacePerson>();
  const submitting = ref(false);
  const registerFiles = ref<File[]>([]);
  const registerForm = ref<Record<string, unknown>>({});

  const recognizeVisible = ref(false);
  const recognizing = ref(false);
  const probeFile = ref<File>();
  const recognizeResult = ref<AdminFaceRecognizeResult>();

  const decisionLabel: Record<string, string> = {
    confirmed: '确认',
    ask: '反问',
    unknown: '不认识',
  };

  const formatQuality = (face: AdminFaceRecognizeFace) => {
    if (face.gatedBy) {
      return `门禁拦下(${face.gatedBy})`;
    }
    if (!face.quality) {
      return '-';
    }
    const size = face.quality.faceSize ?? '-';
    const blur = Math.round(Number(face.quality.blur ?? 0));
    return `尺寸${size} 模糊${blur}`;
  };

  const recognizeRows = computed(() =>
    (recognizeResult.value?.faces || []).map((face, index) => {
      const candidate = recognizeResult.value?.candidates?.[index]?.[0];
      return {
        index: index + 1,
        decisionLabel: decisionLabel[face.decision] || face.decision,
        top1Label: face.top1?.name || '-',
        distance: candidate ? candidate.distance.toFixed(3) : '-',
        qualityLabel: formatQuality(face),
      };
    })
  );

  const fetchPersons = async () => {
    if (!props.userId) return;
    loading.value = true;
    try {
      const { data } = await queryFacePersons(props.userId);
      persons.value = data || [];
    } catch {
      Message.error('家人相册加载失败');
    } finally {
      loading.value = false;
    }
  };

  const openRegister = (record: AdminFacePerson) => {
    registerTarget.value = record;
    registerFiles.value = [];
    registerVisible.value = true;
  };

  const handleFileChange = (_fileList: unknown, file: { file?: File }) => {
    if (file?.file) registerFiles.value = [...registerFiles.value, file.file];
  };

  const handleRegister = async () => {
    if (!registerTarget.value || !registerFiles.value.length) {
      Message.warning('请先选择照片');
      return;
    }
    submitting.value = true;
    try {
      const uploaded = await Promise.all(
        registerFiles.value
          .slice(0, 8)
          .map((file) => uploadAdminFile(file, { folder: 'face-albums' }))
      );
      const objectKeys = uploaded.map((item) => item.objectKey);
      const { data } = await registerFaceTemplates(
        props.userId,
        registerTarget.value.personId,
        objectKeys
      );
      Message.success(
        `已登记 ${data?.stored ?? 0} 张（跳过 ${data?.skipped ?? 0} 张）`
      );
      registerVisible.value = false;
      await fetchPersons();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '登记失败');
    } finally {
      submitting.value = false;
    }
  };

  const handleDelete = async (record: AdminFacePerson) => {
    try {
      const { data } = await deleteFaceTemplates(props.userId, record.personId);
      Message.success(`已清空 ${data?.deleted ?? 0} 张`);
      await fetchPersons();
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '清空失败');
    }
  };

  const openRecognize = () => {
    probeFile.value = undefined;
    recognizeResult.value = undefined;
    recognizeVisible.value = true;
  };

  const handleProbeChange = (_list: unknown, file: { file?: File }) => {
    probeFile.value = file?.file;
  };

  const handleRecognize = async () => {
    if (!probeFile.value) return;
    recognizing.value = true;
    try {
      const uploaded = await uploadAdminFile(probeFile.value, {
        folder: 'face-probes',
      });
      const { data } = await recognizeFaceImage({
        userId: props.userId,
        objectKey: uploaded.objectKey,
      });
      recognizeResult.value = data;
    } catch (error) {
      Message.error(error instanceof Error ? error.message : '识别失败');
    } finally {
      recognizing.value = false;
    }
  };

  const formatTime = (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm');

  onMounted(fetchPersons);

  defineExpose({ fetchPersons });
</script>

<style lang="less" scoped>
  .family-album-panel {
    &__header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 12px;
    }

    &__title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 4px;
    }
  }
</style>
