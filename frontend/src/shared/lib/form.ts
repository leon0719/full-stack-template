import { zodResolver } from "@hookform/resolvers/zod";
import { type FieldValues, type UseFormProps, useForm } from "react-hook-form";
import type { z } from "zod";

/**
 * react-hook-form + zod。欄位值型別是 schema 的 input,handleSubmit 拿到的是 output
 * (經過 transform / coerce / default 之後的值)。
 */
export function useZodForm<S extends z.ZodType<FieldValues, FieldValues>>(
  schema: S,
  options?: Omit<UseFormProps<z.input<S>, unknown, z.output<S>>, "resolver">,
) {
  return useForm<z.input<S>, unknown, z.output<S>>({
    ...options,
    resolver: zodResolver(schema),
  });
}
