import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  compressImage,
  downloadBlob,
  formatFileSize,
  SpreadsheetError,
  validateColumns,
} from "@/shared/lib";
import { Button, Field, FileDropzone } from "@/shared/ui";

const REQUIRED_COLUMNS = ["name", "email"];

export function UploadSection() {
  const { t } = useTranslation();
  const [compressed, setCompressed] = useState<string[]>([]);
  const [sheetResult, setSheetResult] = useState<{ ok: boolean; text: string } | null>(null);

  const onImages = async (files: File[]) => {
    const lines = await Promise.all(
      files.map(async (file) => {
        const out = await compressImage(file, { maxEdge: 1600 });
        // 真實專案:const form = new FormData(); form.append("file", out); await apiPost("/uploads", form)
        // 需要進度條改用 apiUpload(path, form, { onProgress })
        return t("pages.demo.upload.compressed", {
          name: out.name,
          before: formatFileSize(file.size),
          after: formatFileSize(out.size),
        });
      }),
    );
    setCompressed(lines);
  };

  const onSheet = async ([file]: File[]) => {
    try {
      const { valid, missing, headers } = await validateColumns(file, REQUIRED_COLUMNS);
      setSheetResult(
        valid
          ? { ok: true, text: t("pages.demo.upload.columnsOk", { columns: headers.join(", ") }) }
          : {
              ok: false,
              text: t("common.spreadsheet.missingColumns", { columns: missing.join(", ") }),
            },
      );
    } catch (error) {
      const reason = error instanceof SpreadsheetError ? error.reason : "unreadable";
      setSheetResult({ ok: false, text: t(`common.spreadsheet.${reason}`) });
    }
  };

  const downloadSample = () => {
    // 匯出後端檔案:const { blob, filename } = await apiDownload("/reports/export");
    // downloadBlob(blob, filename ?? "report.xlsx");
    // 加 BOM,Excel 開 UTF-8 CSV 才不會變亂碼
    const csv = `﻿${REQUIRED_COLUMNS.join(",")}\n王小明,ming@example.com\n`;
    downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "sample.csv");
  };

  return (
    <section className="mt-10 flex flex-col gap-6">
      <h2 className="text-xl font-bold">{t("pages.demo.upload.title")}</h2>

      <Field label={t("pages.demo.upload.imageLabel")} htmlFor="demo-images">
        <FileDropzone
          id="demo-images"
          accept="image/*"
          maxSize={20 * 1024 * 1024}
          multiple
          maxFiles={5}
          onFiles={onImages}
        />
      </Field>
      {compressed.length > 0 && (
        <ul className="text-sm text-foreground/70">
          {compressed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <Field
        label={t("pages.demo.upload.sheetLabel", { columns: REQUIRED_COLUMNS.join(", ") })}
        htmlFor="demo-sheet"
        error={sheetResult && !sheetResult.ok ? sheetResult.text : null}
      >
        <FileDropzone
          id="demo-sheet"
          accept=".csv,.xlsx"
          maxSize={5 * 1024 * 1024}
          onFiles={onSheet}
        />
      </Field>
      {sheetResult?.ok && <p className="text-sm text-success">{sheetResult.text}</p>}

      <Button variant="outline" className="w-fit" onClick={downloadSample}>
        {t("pages.demo.upload.download")}
      </Button>
    </section>
  );
}
