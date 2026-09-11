import { Provide } from '@midwayjs/core';
import { Processor } from '@midwayjs/bullmq';
import type { JobsOptions, QueueOptions, WorkerOptions } from 'bullmq';

export const MEMORY_PIPELINE_RUNTIME_QUEUE = 'memory-pipeline';
// memory-worker 角色下需要注册的队列白名单
const MEMORY_WORKER_QUEUES = new Set([
  MEMORY_PIPELINE_RUNTIME_QUEUE,
  'departure-duration', // 离世时长预计算
]);

export type NodeRuntimeRole = 'combined' | 'web' | 'memory-worker';

export function resolveNodeRuntimeRole(
  value = process.env.NODE_RUNTIME_ROLE
): NodeRuntimeRole {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'web' || normalized === 'memory-worker') {
    return normalized;
  }
  return 'combined';
}

export function shouldRegisterQueueProcessor(
  queueName: string,
  role = resolveNodeRuntimeRole()
): boolean {
  if (role === 'web') return queueName !== MEMORY_PIPELINE_RUNTIME_QUEUE;
  if (role === 'memory-worker') return MEMORY_WORKER_QUEUES.has(queueName);
  return true;
}

export function resolveMemoryWorkerConcurrency(
  value = process.env.NODE_MEMORY_WORKER_CONCURRENCY
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 2) : 1;
}

export function RuntimeProcessor(
  queueName: string,
  jobOptions?: JobsOptions,
  workerOptions?: Partial<WorkerOptions>,
  queueOptions?: Partial<QueueOptions>
): ClassDecorator {
  if (!shouldRegisterQueueProcessor(queueName)) {
    return Provide();
  }
  return Processor(queueName, jobOptions, workerOptions, queueOptions);
}
