import { Rule, RuleType } from '@midwayjs/validate';

const requiredStringRule = RuleType.string().required();

export class SendSmsCodeDTO {
  @Rule(requiredStringRule.pattern(/^1[3-9]\d{9}$/))
  phone: string;
}

export class PhoneLoginDTO {
  @Rule(requiredStringRule.pattern(/^1[3-9]\d{9}$/))
  phone: string;

  @Rule(requiredStringRule.pattern(/^\d{6}$/))
  code: string;
}

export class PasswordLoginDTO {
  @Rule(requiredStringRule)
  account: string;

  @Rule(requiredStringRule)
  password: string;
}

export class WeappLoginDTO {
  @Rule(requiredStringRule.max(256))
  jsCode: string;
}

export class WeappPhoneLoginDTO {
  @Rule(requiredStringRule.max(256))
  jsCode: string;

  @Rule(requiredStringRule.max(512))
  phoneCode: string;
}

export class UpdateUserNameDTO {
  @Rule(requiredStringRule.max(20))
  name: string;
}

export class UpdateUserAvatarDTO {
  @Rule(requiredStringRule.max(1000))
  avatar: string;
}
