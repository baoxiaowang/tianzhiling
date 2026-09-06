import { Provide } from '@midwayjs/core';
import { Processor } from '@midwayjs/bullmq';
import type { JobsOptions, QueueOptions, WorkerOptions } from 'bullmq';

export const MEMORY_PIPELINE_RUNTIME_QUEUE = 'memory-pipeline';

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
  const isMemoryPipeline = queueName === MEMORY_PIPELINE_RUNTIME_QUEUE;
  if (role === 'web') return !isMemoryPipeline;
  if (role === 'memory-worker') return isMemoryPipeline;
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
