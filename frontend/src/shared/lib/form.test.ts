import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { useZodForm } from "./form";

const schema = z.object({ email: z.email() });

describe("useZodForm", () => {
  it("flags validation errors from the schema", async () => {
    const { result } = renderHook(() => {
      const form = useZodForm(schema, { defaultValues: { email: "nope" } });
      void form.formState.errors; // subscribe so the proxy updates on re-render
      return form;
    });
    await act(async () => {
      await result.current.handleSubmit(() => {})();
    });
    expect(result.current.formState.errors.email).toBeDefined();
  });

  it("passes validation for valid input", async () => {
    let submitted: { email: string } | null = null;
    const { result } = renderHook(() => {
      const form = useZodForm(schema, { defaultValues: { email: "a@b.com" } });
      void form.formState.errors; // subscribe so the proxy updates on re-render
      return form;
    });
    await act(async () => {
      await result.current.handleSubmit((values) => {
        submitted = values;
      })();
    });
    expect(submitted).toEqual({ email: "a@b.com" });
  });
});
