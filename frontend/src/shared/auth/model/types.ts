export type Role = "admin" | "user";

export interface User {
  id: string;
  name: string;
  roles: Role[];
}

export interface Credentials {
  username: string;
  password: string;
}

export interface AuthSession {
  user: User;
  token: string;
}

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

export interface AuthAdapter {
  login(credentials: Credentials): Promise<AuthSession>;
  logout(): Promise<void>;
  me(): Promise<AuthSession | null>;
}
