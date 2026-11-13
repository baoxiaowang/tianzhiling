<template>
  <div
    class="user-interview-panel"
    :class="{ 'user-interview-panel--embedded': embedded }"
  >
    <template v-if="!current">
      <a-card
        class="user-interview-panel__card"
        :class="{ 'user-interview-panel__card--embedded': embedded }"
        :bordered="false"
      >
        <div class="user-interview-panel__toolbar">
          <div class="user-interview-panel__toolbar-copy">
            <a-typography-text bold>用户访谈</a-typography-text>
            <a-typography-text type="secondary">
              上传访谈逐字稿，AI
              会按《用户访谈提问大纲》整理成表单；访谈后单独追问的内容可填在「补充材料」里。
            </a-typography-text>
          </div>
        </div>
        <a-form :model="form" layout="vertical">
          <a-row :gutter="16">
            <a-col :span="8">
              <a-form-item label="访谈日期">
                <a-date-picker
                  v-model="form.interviewDate"
                  value-format="YYYY-MM-DD"
                  style="width: 100%"
                />
              </a-form-item>
            </a-col>
            <a-col :span="16">
              <a-form-item label="标题（可选）">
                <a-input
                  v-model="form.title"
                  placeholder="默认使用「日期 + 用户访谈」"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-form-item label="访谈逐字稿">
            <div
              class="user-interview-panel__dropzone"
              :class="{
                'user-interview-panel__dropzone--active': dragOver,
                'user-interview-panel__dropzone--uploading': fileLoading,
              }"
              @click="triggerFilePick"
              @dragenter.prevent="dragOver = true"
              @dragover.prevent="dragOver = true"
              @dragleave.prevent="dragOver = false"
              @drop.prevent="handleDrop"
            >
              <input
                ref="fileInputRef"
                type="file"
                accept=".txt,.md,.csv,.docx,.pdf"
                class="user-interview-panel__file-input"
                @change="handleFileChange"
              />
              <icon-upload class="user-interview-panel__dropzone-icon" />
              <div class="user-interview-panel__dropzone-title">
                {{
                  dragOver
                    ? '松开鼠标即可上传'
                    : '拖拽逐字稿到这里，或点击选择文件'
                }}
              </div>
              <a-typography-text type="secondary">
                {{
                  form.transcriptFileName ||
                  '支持 .txt / .md / .docx / .pdf，单个文件不超过 20MB'
                }}
              </a-typography-text>
              <a-spin
                v-if="fileLoading"
                class="user-interview-panel__dropzone-spin"
              />
            </div>
            <a-textarea
              v-model="form.transcript"
              :auto-size="{ minRows: 8, maxRows: 20 }"
              placeholder="粘贴访谈逐字稿…"
            />
            <a-typography-text type="secondary">
              已输入 {{ form.transcript.length }} 字（上限 20 万字）
            </a-typography-text>
          </a-form-item>
          <a-form-item label="补充材料（可选）">
            <a-textarea
              v-model="form.supplement"
              :auto-size="{ minRows: 3, maxRows: 8 }"
              placeholder="访谈后单独追问的内容、回访记录等；AI 会用它补全逐字稿没提到的题目"
            />
          </a-form-item>
          <a-button
            type="primary"
            :loading="creating"
            :disabled="!form.transcript.trim()"
            @click="submitCreate"
          >
            创建并整理
          </a-button>
        </a-form>
      </a-card>
    </template>
    <template v-else>
      <a-card
        class="user-interview-panel__card"
        :class="{ 'user-interview-panel__card--embedded': embedded }"
        :bordered="false"
      >
        <div class="user-interview-panel__detail-head">
          <div class="user-interview-panel__detail-copy">
            <a-space>
              <a-typography-text bold>
                {{ current?.title || '访谈记录' }}
              </a-typography-text>
              <a-tag
                :color="current?.status === 'structured' ? 'green' : 'gray'"
              >
                {{ current?.status === 'structured' ? '已整理' : '草稿' }}
              </a-tag>
            </a-space>
            <a-typography-text type="secondary">
              访谈日期 {{ current?.interviewDate || '-' }} · 逐字稿
              {{ current?.transcriptChars || 0 }} 字
              <template v-if="current?.model">
                · 模型 {{ current.model }}</template
              >
            </a-typography-text>
          </div>
          <a-space>
            <a-button
              type="primary"
              :loading="structuring"
              :disabled="!current?.transcript"
              @click="runStructure"
            >
              {{ current?.status === 'structured' ? '重新整理' : 'AI 整理' }}
            </a-button>
            <a-button :loading="saving" @click="saveAnswers">保存</a-button>
            <a-popconfirm
              content="确认删除这条访谈记录？删除后可重新上传"
              @ok="removeCurrent"
            >
              <a-button status="danger">删除</a-button>
            </a-popconfirm>
          </a-space>
        </div>

        <a-alert
          v-if="current?.lastError"
          type="warning"
          class="user-interview-panel__alert"
        >
          {{ current.lastError }}
        </a-alert>

        <a-collapse class="user-interview-panel__transcript" :bordered="false">
          <a-collapse-item key="transcript" header="查看原始逐字稿">
            <pre class="user-interview-panel__transcript-text">{{
              current?.transcript
            }}</pre>
          </a-collapse-item>
          <a-collapse-item
            key="supplement"
            header="补充材料（访谈后追问 / 回访记录，可编辑）"
          >
            <a-textarea
              v-model="supplementText"
              :auto-size="{ minRows: 3, maxRows: 10 }"
              placeholder="访谈后单独追问、回访记录等；保存后再次「整理」会用上"
            />
          </a-collapse-item>
        </a-collapse>

        <div
          v-for="section in sections"
          :key="section.title"
          class="user-interview-panel__section"
        >
          <a-typography-title
            :heading="6"
            class="user-interview-panel__section-title"
          >
            {{ section.title }}
          </a-typography-title>
          <div
            v-for="item in sectionQuestions(section)"
            :key="item.no"
            class="user-interview-panel__question"
          >
            <div class="user-interview-panel__question-title">
              <span class="user-interview-panel__question-no">{{
                item.no
              }}</span>
              <span>{{ item.question }}</span>
            </div>
            <a-textarea
              v-model="answerText[item.no]"
              :auto-size="{ minRows: 2, maxRows: 8 }"
              placeholder="未提及 / 手动补充"
              class="user-interview-panel__answer"
            />
            <div
              v-if="answerQuotes[item.no]?.length"
              class="user-interview-panel__quotes"
            >
              <a-typography-text
                v-for="(quote, index) in answerQuotes[item.no]"
                :key="index"
                type="secondary"
                class="user-interview-panel__quote"
              >
                “{{ quote }}”
              </a-typography-text>
            </div>
          </div>
        </div>
      </a-card>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, reactive, ref, watch } from 'vue';
  import { Message } from '@arco-design/web-vue';
  import {
    createUserInterview,
    deleteUserInterview,
    extractInterviewDocx,
    extractInterviewPdf,
    getInterviewOutline,
    listUserInterviews,
    structureUserInterview,
    updateUserInterview,
  } from '@/api/user-interview';
  import type {
    InterviewAnswer,
    InterviewOutlineItem,
    InterviewSection,
    UserInterviewRecord,
  } from '@/api/user-interview';

  const props = defineProps<{
    userId?: string;
    embedded?: boolean;
  }>();

  const loading = ref(false);
  const saving = ref(false);
  const creating = ref(false);
  const structuring = ref(false);
  const records = ref<UserInterviewRecord[]>([]);
  const current = ref<UserInterviewRecord | null>(null);
  const outline = ref<InterviewOutlineItem[]>([]);
  const sections = ref<InterviewSection[]>([]);
  const answerText = reactive<Record<number, string>>({});
  const answerQuotes = reactive<Record<number, string[]>>({});

  const supplementText = ref('');
  const fileInputRef = ref<HTMLInputElement>();
  const dragOver = ref(false);
  const fileLoading = ref(false);
  const form = reactive({
    interviewDate: '',
    title: '',
    transcript: '',
    transcriptFileName: '',
    supplement: '',
  });

  const apiError = (error: unknown, fallback: string) => {
    const data = (error as { response?: { data?: { message?: string } } })
      ?.response?.data;
    return data?.message || fallback;
  };

  function todayString() {
    const now = new Date();
    const month = `${now.getMonth() + 1}`.padStart(2, '0');
    const day = `${now.getDate()}`.padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  }

  const sectionQuestions = (section: InterviewSection) =>
    outline.value.filter(
      (item) => item.no >= section.from && item.no <= section.to
    );

  async function fetchOutline() {
    try {
      const { data } = await getInterviewOutline();
      outline.value = data.outline;
      sections.value = data.sections;
    } catch (error) {
      Message.error(apiError(error, '加载访谈大纲失败'));
    }
  }

  async function fetchList() {
    if (!props.userId) {
      records.value = [];
      return;
    }
    loading.value = true;
    try {
      const { data } = await listUserInterviews(props.userId);
      records.value = data;
      if (data.length) {
        openDetail(data[0]);
      } else {
        current.value = null;
        resetCreateForm();
      }
    } catch (error) {
      Message.error(apiError(error, '加载访谈记录失败'));
    } finally {
      loading.value = false;
    }
  }

  function applyAnswers(answers: InterviewAnswer[]) {
    const map = new Map(answers.map((item) => [item.no, item]));
    outline.value.forEach((item) => {
      const hit = map.get(item.no);
      answerText[item.no] = hit?.answer || '';
      answerQuotes[item.no] = hit?.quotes?.length ? hit.quotes : [];
    });
  }

  function openDetail(record: UserInterviewRecord) {
    current.value = record;
    supplementText.value = record.supplement || '';
    applyAnswers(record.answers || []);
  }

  function resetCreateForm() {
    form.interviewDate = todayString();
    form.title = '';
    form.transcript = '';
    form.transcriptFileName = '';
    form.supplement = '';
  }

  function removeCurrent() {
    if (current.value) {
      removeRecord(current.value);
    }
  }

  function triggerFilePick() {
    fileInputRef.value?.click();
  }

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const buffer = reader.result as ArrayBuffer;
        const bytes = new Uint8Array(buffer);
        const chunk = 0x8000;
        const parts: string[] = [];
        Array.from(
          { length: Math.ceil(bytes.length / chunk) },
          (_, index) => index
        ).forEach((index) => {
          parts.push(
            String.fromCharCode(
              ...bytes.subarray(index * chunk, (index + 1) * chunk)
            )
          );
        });
        resolve(btoa(parts.join('')));
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(file);
    });
  }

  async function processFile(file: File) {
    if (file.size > 20 * 1024 * 1024) {
      Message.error('文件超过 20MB，请拆分后再上传');
      return;
    }
    const lower = file.name.toLowerCase();
    fileLoading.value = true;
    try {
      if (lower.endsWith('.docx')) {
        const base64 = await fileToBase64(file);
        const { data } = await extractInterviewDocx({
          fileName: file.name,
          base64,
        });
        form.transcript = data.text;
        Message.success(`已解析 ${data.chars} 字`);
      } else if (
        lower.endsWith('.txt') ||
        lower.endsWith('.md') ||
        lower.endsWith('.csv')
      ) {
        form.transcript = await file.text();
        Message.success(`已读取 ${form.transcript.length} 字`);
      } else if (lower.endsWith('.pdf')) {
        const base64 = await fileToBase64(file);
        const { data } = await extractInterviewPdf({
          fileName: file.name,
          base64,
        });
        form.transcript = data.text;
        Message.success(`已解析 ${data.pages} 页、${data.chars} 字`);
      } else if (lower.endsWith('.doc')) {
        Message.error('暂不支持旧版 .doc，请另存为 .docx / pdf 或 txt');
      } else {
        Message.error('仅支持 .txt / .md / .docx / .pdf');
        return;
      }
      form.transcriptFileName = file.name;
    } catch (error) {
      Message.error(apiError(error, '读取文件失败'));
    } finally {
      fileLoading.value = false;
    }
  }

  async function handleFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    await processFile(file);
  }

  async function handleDrop(event: DragEvent) {
    dragOver.value = false;
    const file = event.dataTransfer?.files?.[0];
    if (!file) return;
    await processFile(file);
  }

  async function submitCreate() {
    if (!props.userId) {
      Message.error('缺少用户信息');
      return;
    }
    const transcript = form.transcript.trim();
    if (!transcript) {
      Message.error('请先上传或粘贴逐字稿');
      return;
    }
    creating.value = true;
    try {
      const { data } = await createUserInterview({
        userId: props.userId,
        title: form.title.trim() || undefined,
        interviewDate: form.interviewDate || todayString(),
        transcript,
        transcriptFileName: form.transcriptFileName || undefined,
        supplement: form.supplement.trim() || undefined,
      });
      current.value = data;
      applyAnswers(data.answers || []);
      resetCreateForm();
      await runStructure();
      await fetchList();
    } catch (error) {
      Message.error(apiError(error, '创建访谈失败'));
    } finally {
      creating.value = false;
    }
  }

  async function runStructure() {
    if (!current.value) return;
    structuring.value = true;
    try {
      const { data } = await structureUserInterview(current.value.id);
      current.value = data;
      applyAnswers(data.answers || []);
      Message.success('AI 整理完成，请核对后保存');
    } catch (error) {
      Message.error(apiError(error, 'AI 整理失败，可手动填写'));
      await fetchList();
    } finally {
      structuring.value = false;
    }
  }

  async function saveAnswers() {
    if (!current.value) return;
    saving.value = true;
    try {
      const answers: InterviewAnswer[] = outline.value.map((item) => ({
        no: item.no,
        question: item.question,
        answer: (answerText[item.no] || '').trim(),
        quotes: answerQuotes[item.no]?.length
          ? answerQuotes[item.no]
          : undefined,
      }));
      const { data } = await updateUserInterview(current.value.id, {
        answers,
        supplement: supplementText.value,
      });
      current.value = data;
      Message.success('已保存');
      await fetchList();
    } catch (error) {
      Message.error(apiError(error, '保存失败'));
    } finally {
      saving.value = false;
    }
  }

  async function removeRecord(record: UserInterviewRecord) {
    try {
      await deleteUserInterview(record.id);
      Message.success('已删除');
      if (current.value?.id === record.id) {
        current.value = null;
        applyAnswers([]);
        supplementText.value = '';
        resetCreateForm();
      }
      await fetchList();
    } catch (error) {
      Message.error(apiError(error, '删除失败'));
    }
  }

  watch(
    () => props.userId,
    () => {
      current.value = null;
      applyAnswers([]);
      supplementText.value = '';
      resetCreateForm();
      fetchList();
    }
  );

  const hasRecords = computed(() => records.value.length > 0);

  onMounted(async () => {
    resetCreateForm();
    await fetchOutline();
    await fetchList();
  });

  defineExpose({ hasRecords });
</script>

<style lang="less" scoped>
  .user-interview-panel {
    &--embedded {
      :deep(.arco-card-body) {
        padding: 0;
      }
    }

    &__toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    &__toolbar-copy {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    &__detail-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }

    &__detail-copy {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    &__alert {
      margin-bottom: 12px;
    }

    &__transcript {
      margin-bottom: 16px;

      &-text {
        max-height: 320px;
        margin: 0;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: 12px;
        line-height: 1.7;
        color: var(--color-text-2);
      }
    }

    &__section {
      margin-bottom: 20px;
    }

    &__section-title {
      margin: 0 0 8px;
    }

    &__question {
      padding: 10px 12px;
      margin-bottom: 8px;
      border: 1px solid var(--color-border-2);
      border-radius: 8px;
      background: var(--color-fill-1);
    }

    &__question-title {
      display: flex;
      align-items: baseline;
      gap: 8px;
      margin-bottom: 6px;
      font-weight: 500;
    }

    &__question-no {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      background: rgb(var(--primary-1));
      color: rgb(var(--primary-6));
      font-size: 12px;
    }

    &__answer {
      background: #fff;
    }

    &__quotes {
      display: flex;
      flex-direction: column;
      gap: 2px;
      margin-top: 6px;
    }

    &__quote {
      font-size: 12px;
    }

    &__dropzone {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 4px;
      min-height: 120px;
      margin-bottom: 10px;
      padding: 16px;
      border: 1px dashed var(--color-border-3);
      border-radius: 8px;
      background: var(--color-fill-1);
      cursor: pointer;
      transition: border-color 0.2s, background-color 0.2s;

      &:hover {
        border-color: rgb(var(--primary-5));
        background: rgb(var(--primary-1));
      }

      &--active {
        border-color: rgb(var(--primary-6));
        background: rgb(var(--primary-1));
      }

      &--uploading {
        cursor: progress;
        opacity: 0.75;
      }
    }

    &__dropzone-icon {
      font-size: 22px;
      color: rgb(var(--primary-6));
    }

    &__dropzone-title {
      font-size: 14px;
      font-weight: 500;
      color: var(--color-text-1);
    }

    &__dropzone-spin {
      position: absolute;
      right: 12px;
      top: 12px;
    }

    &__file-input {
      display: none;
    }
  }
</style>
