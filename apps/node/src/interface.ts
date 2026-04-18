/**
 * @description User-Service parameters
 */
export interface IUserOptions {
  uid: number;
}

export interface LoginUserProfile {
  id: string;
  name: string;
  avatar: string;
  account: string;
  phone: string;
  phoneVerified: boolean;
}

export interface AuthenticatedUserPayload {
  sub: string;
  accountId: string;
  account: string;
  iat: number;
  exp: number;
  nonce: string;
}

export interface PasswordLoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: number;
  isNewUser?: boolean;
  user: LoginUserProfile;
}

export interface SendSmsCodeResult {
  expiresInSeconds: number;
  resendAfterSeconds: number;
  debugCode?: string;
}

export interface LogoutResult {
  loggedOutAt: number;
}
