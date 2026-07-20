// src/pages/login/ui/login-page.tsx
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useAuth } from "@/shared/auth";
import { useZodForm } from "@/shared/lib";
import { Button, Input } from "@/shared/ui";

// Keep in sync with the zod schema messages below (each must be a valid i18n key).
type LoginValidationKey = "auth.login.usernameRequired" | "auth.login.passwordRequired";

const schema = z.object({
  username: z.string().min(1, "auth.login.usernameRequired" satisfies LoginValidationKey),
  password: z.string().min(1, "auth.login.passwordRequired" satisfies LoginValidationKey),
});

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useZodForm(schema, { defaultValues: { username: "", password: "" } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      navigate({ to: "/" });
    } catch {
      setFormError(t("auth.login.failed"));
    }
  });

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="mb-6 text-lg font-medium">{t("auth.login.title")}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.login.username")}
          <Input {...register("username")} />
          {errors.username && (
            <span className="text-destructive">
              {t(errors.username.message as LoginValidationKey)}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {t("auth.login.password")}
          <Input type="password" {...register("password")} />
          {errors.password && (
            <span className="text-destructive">
              {t(errors.password.message as LoginValidationKey)}
            </span>
          )}
        </label>
        {formError && <p className="text-sm text-destructive">{formError}</p>}
        <Button type="submit" disabled={isSubmitting}>
          {t("auth.login.submit")}
        </Button>
      </form>
    </div>
  );
}
