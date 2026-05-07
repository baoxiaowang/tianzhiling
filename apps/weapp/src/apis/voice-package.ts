import type {
  AgentVoicePackageCenterDTO,
  VoicePackageRecordDTO,
  VoiceTrainingTaskRecordDTO,
  VoiceTrainingTaskStatusDTO,
} from '@tzl/shared'
import { get } from '../api/api-client'

export interface VoicePackageRecord {
  id: string
  code: string
  name: string
  description: string
  priceAmount: number
  originalPriceAmount?: number
  currency: string
  deliverables: Array<{ title: string; description?: string }>
  materialRequirement: string
  estimatedServiceDays?: number
}

export interface VoiceTrainingTaskRecord {
  id: string
  agentId: string
  orderId: string
  voicePackageId: string
  voicePackageCode: string
  voicePackageName?: string
  status: VoiceTrainingTaskStatusDTO
  voiceTimbreId?: string
  remark: string
  paidAt?: string
  completedAt?: string
  createdAt: string
  updatedAt: string
}

export interface AgentVoicePackageCenter {
  packages: VoicePackageRecord[]
  task?: VoiceTrainingTaskRecord
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asString(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function asNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    return Number.isFinite(parsed) ? parsed : 0
  }

  return 0
}

function parseTaskStatus(value: unknown): VoiceTrainingTaskStatusDTO {
  const status = asString(value)

  if (
    status === 'paid' ||
    status === 'awaiting_material' ||
    status === 'processing' ||
    status === 'training' ||
    status === 'completed' ||
    status === 'failed' ||
    status === 'refunded'
  ) {
    return status
  }

  return 'paid'
}

function parsePackage(value: unknown): VoicePackageRecord {
  const raw = asRecord(value)
  const deliverables = Array.isArray(raw.deliverables)
    ? raw.deliverables.map((item) => {
        const deliverable = asRecord(item)
        return {
          title: asString(deliverable.title),
          description:
            deliverable.description == null
              ? undefined
              : asString(deliverable.description),
        }
      })
    : []

  return {
    id: asString(raw.id),
    code: asString(raw.code),
    name: asString(raw.name),
    description: asString(raw.description),
    priceAmount: asNumber(raw.priceAmount),
    originalPriceAmount:
      raw.originalPriceAmount == null
        ? undefined
        : asNumber(raw.originalPriceAmount),
    currency: asString(raw.currency) || 'CNY',
    deliverables,
    materialRequirement: asString(raw.materialRequirement),
    estimatedServiceDays:
      raw.estimatedServiceDays == null
        ? undefined
        : asNumber(raw.estimatedServiceDays),
  }
}

function parseTask(value: unknown): VoiceTrainingTaskRecord {
  const raw = asRecord(value)

  return {
    id: asString(raw.id),
    agentId: asString(raw.agentId),
    orderId: asString(raw.orderId),
    voicePackageId: asString(raw.voicePackageId),
    voicePackageCode: asString(raw.voicePackageCode),
    voicePackageName:
      raw.voicePackageName == null
        ? undefined
        : asString(raw.voicePackageName),
    status: parseTaskStatus(raw.status),
    voiceTimbreId:
      raw.voiceTimbreId == null ? undefined : asString(raw.voiceTimbreId),
    remark: asString(raw.remark),
    paidAt: raw.paidAt == null ? undefined : asString(raw.paidAt),
    completedAt:
      raw.completedAt == null ? undefined : asString(raw.completedAt),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  }
}

function parseCenter(value: unknown): AgentVoicePackageCenter {
  const raw = asRecord(value)
  const packages = Array.isArray(raw.packages)
    ? raw.packages.map(parsePackage)
    : []

  return {
    packages,
    task: raw.task ? parseTask(raw.task) : undefined,
  }
}

export async function getAgentVoicePackageCenter(agentId: string) {
  const data = await get<AgentVoicePackageCenterDTO>(
    `/api/voice-packages/agent/${encodeURIComponent(agentId)}/center`
  )

  return parseCenter(data)
}

export type {
  AgentVoicePackageCenterDTO,
  VoicePackageRecordDTO,
  VoiceTrainingTaskRecordDTO,
  VoiceTrainingTaskStatusDTO,
}
