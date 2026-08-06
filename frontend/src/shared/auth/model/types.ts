export type Role = "admin" | "user";

export interface User {
  id: string;
  name: string;
  roles: Role[];
  displayName?: string;
  pictureUrl?: string;
}

export interface AuthSession {
  user: User;
  token: string;
}

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

export interface AuthAdapter {
  getLineLoginUrl(): string;
  completeLineLogin(code: string): Promise<AuthSession>;
  logout(): Promise<void>;
  me(): Promise<AuthSession | null>;
}
