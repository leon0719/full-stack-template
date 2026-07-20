import { create } from "zustand";

interface GreetingState {
  name: string;
  setName: (name: string) => void;
}

export const useGreetingStore = create<GreetingState>((set) => ({
  name: "",
  setName: (name) => set({ name }),
}));
