import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useZodForm } from "@/shared/lib";
import {
  Button,
  ErrorState,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  PageHeader,
} from "@/shared/ui";
import { useRepo } from "../api/use-repo";
import { useGreetingStore } from "../model/use-greeting-store";
import { ComponentGallery, GalleryNav } from "./gallery/component-gallery";
import { ThemeSpecimen } from "./gallery/theme-specimen";
import { RealtimeSection } from "./realtime-section";
import { UploadSection } from "./upload-section";

const schema = z.object({
  name: z.string().min(2, "pages.demo.form.nameMin"),
});

function RepoSection() {
  const { data, isPending, isError, refetch } = useRepo();
  const { t } = useTranslation();

  return (
    <section>
      <h3 className="text-lg font-semibold">{t("pages.demo.repoTitle")}</h3>
      {isPending && <p className="mt-4">{t("pages.demo.loading")}</p>}
      {isError && <ErrorState title={t("pages.demo.error")} onRetry={() => refetch()} />}
      {data && (
        <p className="mt-4">
          {data.full_name} ⭐ {data.stargazers_count}
        </p>
      )}
    </section>
  );
}

function GreetingSection() {
  const { name, setName } = useGreetingStore();
  const { t } = useTranslation();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useZodForm(schema);

  const onSubmit = handleSubmit((data) => setName(data.name));

  return (
    <section>
      <h3 className="flex items-center gap-2 text-lg font-semibold">
        <Sparkles aria-hidden size={18} />
        {t("pages.demo.form.title")}
      </h3>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">
            {t("pages.demo.form.nameLabel")}
            <span aria-hidden className="text-destructive">
              *
            </span>
          </FieldLabel>
          <Input
            id="name"
            aria-invalid={!!errors.name}
            aria-required
            placeholder={t("pages.demo.form.namePlaceholder")}
            {...register("name")}
          />
          <FieldDescription>{t("pages.demo.form.hint")}</FieldDescription>
          {/* zod message 是 i18n key;FieldError 會幫忙 t() */}
          <FieldError errors={[errors.name]} />
        </Field>
        <Button type="submit" className="w-fit">
          {t("pages.demo.form.submit")}
        </Button>
      </form>
      {name && (
        <p className="mt-6 text-lg font-semibold">{t("pages.demo.form.greeting", { name })}</p>
      )}
    </section>
  );
}

export function DemoPage() {
  const { t } = useTranslation();
  // AppLayout 已提供 <main>,這裡不再包一層
  return (
    <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
      <GalleryNav
        className="sticky top-6 hidden max-h-[calc(100svh-3rem)] self-start overflow-y-auto [scrollbar-width:thin] lg:block"
        extra={[{ href: "#integration", label: t("pages.demo.integration") }]}
      />
      <div className="flex max-w-4xl min-w-0 flex-col gap-10">
        <PageHeader title={t("pages.demo.title")} description={t("pages.demo.description")} />
        <ThemeSpecimen />
        <ComponentGallery />
        <section id="integration" aria-labelledby="integration-title" className="scroll-mt-6">
          <h2
            id="integration-title"
            className="mb-8 border-b pb-2 text-xl font-semibold tracking-tight"
          >
            {t("pages.demo.integration")}
          </h2>
          <div className="flex flex-col gap-10">
            <RepoSection />
            <GreetingSection />
            <UploadSection />
            <RealtimeSection />
          </div>
        </section>
      </div>
    </div>
  );
}
