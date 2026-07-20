import { beforeEach, describe, expect, it, vi } from "vitest";
import { tokenStorage } from "./token-storage";

const makeStorage = (): Storage => {
  const store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  };
};

describe("tokenStorage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  it("returns null when no token stored", () => {
    expect(tokenStorage.get()).toBeNull();
  });

  it("persists and reads a token", () => {
    tokenStorage.set("abc");
    expect(tokenStorage.get()).toBe("abc");
  });

  it("clears the token", () => {
    tokenStorage.set("abc");
    tokenStorage.clear();
    expect(tokenStorage.get()).toBeNull();
  });
});
