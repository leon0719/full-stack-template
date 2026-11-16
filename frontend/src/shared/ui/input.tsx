import type { ComponentProps } from "react";
import { cn } from "@/shared/lib";

/** React 19:ref 是一般 prop,ComponentProps<"input"> 已包含 ref */
export type InputProps = ComponentProps<"input">;

export const Input = ({ className, ...props }: InputProps) => (
  <input
    className={cn(
      "flex h-9 w-full rounded-md border border-foreground/20 bg-background px-3 py-2 text-sm",
      "placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-2",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/30",
      className,
    )}
    {...props}
  />
);
