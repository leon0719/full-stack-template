import { Upload } from "lucide-react";
import { type DragEvent, type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn, formatFileSize, matchesAccept } from "@/shared/lib";

export interface FileDropzoneProps {
  /** 通過檢查的檔案;有任何一個不合格時,合格的仍會送出,不合格的列在錯誤訊息裡 */
  onFiles: (files: File[]) => void;
  /** 同 `<input accept>`:".csv,.xlsx"、"image/*" */
  accept?: string;
  /** 單檔大小上限(bytes) */
  maxSize?: number;
  multiple?: boolean;
  /** multiple 時一次最多幾個檔案 */
  maxFiles?: number;
  disabled?: boolean;
  /** 取代預設的「支援格式 / 上限」提示 */
  hint?: ReactNode;
  className?: string;
  /** 放進 <Field htmlFor={id}> 時,label 會指向這個可聚焦的區塊 */
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}

/**
 * 拖放 + 點選的檔案選擇區。整塊是一個 <button>:Tab 可聚焦、Enter / Space 開啟檔案選擇。
 * 檔案格式與大小檢查只是 UX(拖放不受 accept 限制所以這裡再檢查一次),後端仍要驗。
 * 只負責「選檔」,上傳交給 apiPost(FormData) 或需要進度時的 apiUpload。
 */
export function FileDropzone({
  onFiles,
  accept,
  maxSize,
  multiple = false,
  maxFiles,
  disabled = false,
  hint,
  className,
  id,
  "aria-describedby": describedBy,
  "aria-invalid": ariaInvalid,
}: FileDropzoneProps) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const autoId = useId();
  const zoneId = id ?? autoId;
  const hintId = `${zoneId}-hint`;
  const errorId = `${zoneId}-errors`;

  const acceptLabel = (accept ?? "")
    .split(",")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .join(" / ");
  const sizeLabel = maxSize ? formatFileSize(maxSize) : "";

  const handleFiles = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (!multiple && files.length > 1) {
      setErrors([t("common.upload.single")]);
      return;
    }
    if (multiple && maxFiles !== undefined && files.length > maxFiles) {
      setErrors([t("common.upload.tooMany", { count: maxFiles })]);
      return;
    }
    const nextErrors: string[] = [];
    const accepted = files.filter((file) => {
      if (!matchesAccept(file, accept)) {
        nextErrors.push(t("common.upload.invalidType", { name: file.name, accept: acceptLabel }));
        return false;
      }
      if (maxSize !== undefined && file.size > maxSize) {
        nextErrors.push(t("common.upload.tooLarge", { name: file.name, size: sizeLabel }));
        return false;
      }
      return true;
    });
    setErrors(nextErrors);
    if (accepted.length > 0) onFiles(accepted);
  };

  const onDragOver = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (!disabled) setDragging(true);
  };
  const onDragLeave = (e: DragEvent<HTMLButtonElement>) => {
    // 滑到子元素上也會觸發 dragleave:還在區塊內就不算離開
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled) handleFiles(e.dataTransfer.files);
  };

  const defaultHint = [
    acceptLabel ? t("common.upload.accept", { accept: acceptLabel }) : null,
    sizeLabel ? t("common.upload.maxSize", { size: sizeLabel }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hintContent = hint ?? defaultHint;
  const ariaDescribedBy =
    [describedBy, hintContent ? hintId : null, errors.length ? errorId : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        id={zoneId}
        disabled={disabled}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid || errors.length > 0 || undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={onDragOver}
        onDragEnter={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={cn(
          "flex min-h-28 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
          dragging
            ? "border-primary bg-primary/5"
            : "border-foreground/20 hover:border-foreground/40 hover:bg-foreground/5",
          errors.length > 0 && !dragging && "border-destructive/50",
        )}
      >
        <Upload aria-hidden className="size-6 text-foreground/50" />
        <span className="text-sm font-medium">{t("common.upload.prompt")}</span>
        {hintContent && (
          <span id={hintId} className="text-xs text-foreground/60">
            {hintContent}
          </span>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        hidden
        tabIndex={-1}
        data-testid="file-dropzone-input"
        onChange={(e) => {
          handleFiles(e.currentTarget.files);
          // 清空才能再選同一個檔案(否則 change 不會觸發)
          e.currentTarget.value = "";
        }}
      />
      {errors.length > 0 && (
        <ul id={errorId} role="alert" className="flex flex-col gap-1 text-sm text-destructive">
          {errors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
