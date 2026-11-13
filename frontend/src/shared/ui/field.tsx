import { cloneElement, isValidElement, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** react-hook-form 的 FieldError 形狀(只用到 message) */
interface FieldErrorLike {
  message?: string;
}

/**
 * 表單欄位外框:label + 控制項 + 提示 / 錯誤,並自動把 `aria-invalid`、`aria-describedby`
 * 接到唯一的子元素上(子元素自己給的同名 props 優先)。
 *
 * 搭配 useZodForm:直接傳 `errors.name`。zod message 是 i18n key,這裡會幫你 t();
 * 傳字串則視為已翻譯好的文字原樣顯示。
 * ```tsx
 * <Field label={t("x.name")} htmlFor="name" error={errors.name} hint={t("x.nameHint")} required>
 *   <Input id="name" {...register("name")} />
 * </Field>
 * ```
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: ReactNode;
  /** 必須等於子元素的 id */
  htmlFor: string;
  error?: string | FieldErrorLike | null;
  hint?: ReactNode;
  /** 只負責顯示必填標記;驗證仍由 schema 決定 */
  required?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const message =
    typeof error === "string"
      ? error
      : error?.message
        ? // zod message 是 i18n key;型別上無法證明,執行期找不到 key 時 i18next 會原樣回傳
          t(error.message as never)
        : null;
  const hintId = `${htmlFor}-hint`;
  const errorId = `${htmlFor}-error`;
  const describedBy = [hint ? hintId : null, message ? errorId : null].filter(Boolean).join(" ");

  const control = isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, {
        "aria-invalid": message ? true : undefined,
        "aria-describedby": describedBy || undefined,
        ...children.props,
      })
    : children;

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="text-xs text-foreground/60">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
