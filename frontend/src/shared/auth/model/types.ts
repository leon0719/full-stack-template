export type Role = "admin" | "user";

export interface User {
  id: string;
  name: string;
  roles: Role[];
  displayName?: string;
  pictureUrl?: string;
}

export type AuthStatus = "idle" | "loading" | "authenticated" | "unauthenticated";

/** 憑證是後端種的 HttpOnly cookie,前端拿不到也不存;adapter 只回傳 user,`me()` 在未登入時回 null */
export interface AuthAdapter {
  getLineLoginUrl(): string;
  completeLineLogin(code: string): Promise<User>;
  logout(): Promise<void>;
  me(): Promise<User | null>;
}
