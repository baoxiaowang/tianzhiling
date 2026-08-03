import type {
  AddVoiceServiceMaterialsDTO,
  GenerateUserVoiceTimbreSpeechDTO,
  RecutVoiceServiceClipDTO,
  ReviewVoiceServiceClipDTO,
  SelectAgentVoiceTimbreDTO,
  SelectVoiceServiceAgentDTO,
  SendVoiceServiceMessageDTO,
  StartVoiceServiceTrainingDTO,
  SubmitVoiceServiceMaterialsDTO,
  UpdateUserVoiceTimbreDTO,
} from '@tzl/shared';

export class AddVoiceServiceMaterialsBodyDTO
  implements AddVoiceServiceMaterialsDTO
{
  materials: AddVoiceServiceMaterialsDTO['materials'];
}

export class SendVoiceServiceMessageBodyDTO
  implements SendVoiceServiceMessageDTO
{
  text: string;
}

export class SubmitVoiceServiceMaterialsBodyDTO
  implements SubmitVoiceServiceMaterialsDTO
{
  processingMode?: SubmitVoiceServiceMaterialsDTO['processingMode'];
}

export class ReviewVoiceServiceClipBodyDTO
  implements ReviewVoiceServiceClipDTO
{
  reviewStatus: ReviewVoiceServiceClipDTO['reviewStatus'];
  rejectionReason?: string;
}

export class RecutVoiceServiceClipBodyDTO implements RecutVoiceServiceClipDTO {
  instruction: string;
}

export class StartVoiceServiceTrainingBodyDTO
  implements StartVoiceServiceTrainingDTO
{
  agentId?: string;
}

export class SelectVoiceServiceAgentBodyDTO
  implements SelectVoiceServiceAgentDTO
{
  agentId: string;
}

export class SelectAgentVoiceTimbreBodyDTO
  implements SelectAgentVoiceTimbreDTO
{
  timbreId: string;
  replaceExisting?: boolean;
}

export class UpdateUserVoiceTimbreBodyDTO
  implements UpdateUserVoiceTimbreDTO
{
  name?: string;
  speechSpeed?: number;
  speechVolume?: number;
}

export class GenerateUserVoiceTimbreSpeechBodyDTO
  implements GenerateUserVoiceTimbreSpeechDTO
{
  text: string;
}
