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

export interface AdminAuthenticatedPayload {
  sub: string;
  account: string;
  roles: string[];
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

export interface AdminPasswordLoginResult {
  accessToken: string;
  tokenType: 'Bearer';
  expiresAt: number;
  admin: {
    id: string;
    account: string;
    roles: string[];
  };
}

export interface AdminBootstrapStatus {
  hasSuperAdmin: boolean;
}

export interface AdminBootstrapRegisterResult {
  admin: {
    id: string;
    account: string;
    name: string;
    roles: string[];
  };
}
