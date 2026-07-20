import { zodResolver } from "@hookform/resolvers/zod";
import { type UseFormProps, type UseFormReturn, useForm } from "react-hook-form";
import type { ZodType, z } from "zod";

export function useZodForm<S extends ZodType<any, any>>(
  schema: S,
  options?: Omit<UseFormProps<z.infer<S>>, "resolver">,
): UseFormReturn<z.infer<S>> {
  return useForm({
    ...options,
    resolver: zodResolver(schema as any),
  }) as unknown as UseFormReturn<z.infer<S>>;
}
