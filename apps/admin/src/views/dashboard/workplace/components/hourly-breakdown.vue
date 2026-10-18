<template>
  <a-spin :loading="loading" style="width: 100%">
    <a-card class="general-card hourly-card" :bordered="false">
      <template #title>今日分时段</template>
      <template #extra>
        <a-space>
          <a-switch v-model="autoRefresh" size="small">
            <template #checked>自动刷新</template>
            <template #unchecked>自动刷新</template>
          </a-switch>
          <a-date-picker
            v-model="pickedDate"
            size="small"
            :allow-clear="false"
            :disabled-date="disabledDate"
            value-format="YYYY-MM-DD"
            @change="load"
          />
        </a-space>
      </template>
      <Chart height="289px" :option="chartOption" />
      <div class="hourly-card__hint">
        1 小时粒度 ·
        新增用户按注册时间、活跃用户为该小时发消息的用户数、消息数不含系统与已归档消息
      </div>
    </a-card>
  </a-spin>
</template>

<script lang="ts" setup>
  import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
  import dayjs from 'dayjs';
  import useLoading from '@/hooks/loading';
  import {
    queryHourlyBreakdown,
    HourlyBreakdownBucket,
    HourlyBreakdownRes,
  } from '@/api/operations';

  const { loading, setLoading } = useLoading();
  const buckets = ref<HourlyBreakdownBucket[]>([]);
  const pickedDate = ref(dayjs().format('YYYY-MM-DD'));
  const autoRefresh = ref(true);
  let timer: ReturnType<typeof setInterval> | null = null;

  const disabledDate = (current?: Date) =>
    dayjs(current).isAfter(dayjs(), 'day');

  const load = async () => {
    try {
      setLoading(true);
      const { data } = await queryHourlyBreakdown(pickedDate.value);
      const res = data as unknown as HourlyBreakdownRes;
      buckets.value = res.buckets || [];
    } catch (error) {
      buckets.value = [];
    } finally {
      setLoading(false);
    }
  };

  const hours = computed(() => buckets.value.map((item) => `${item.hour}时`));
  const chartOption = computed(() => ({
    tooltip: { trigger: 'axis' },
    legend: { data: ['新增用户', '活跃用户', '消息数'], top: 0 },
    grid: { left: 40, right: 52, top: 44, bottom: 28 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: hours.value,
      axisLabel: { interval: 1 },
    },
    yAxis: [
      { type: 'value', name: '人数', minInterval: 1 },
      { type: 'value', name: '消息数', minInterval: 1 },
    ],
    series: [
      {
        name: '新增用户',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: buckets.value.map((item) => item.newUsers),
      },
      {
        name: '活跃用户',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: buckets.value.map((item) => item.activeUsers),
      },
      {
        name: '消息数',
        type: 'line',
        smooth: true,
        showSymbol: false,
        yAxisIndex: 1,
        data: buckets.value.map((item) => item.messages),
      },
    ],
  }));

  onMounted(() => {
    load();
    timer = setInterval(() => {
      if (autoRefresh.value) load();
    }, 60000);
  });

  onBeforeUnmount(() => {
    if (timer) clearInterval(timer);
  });
</script>

<style lang="less" scoped>
  .hourly-card__hint {
    margin-top: 8px;
    color: var(--color-text-3);
    font-size: 12px;
  }
</style>
