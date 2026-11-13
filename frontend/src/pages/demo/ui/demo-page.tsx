import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useZodForm } from "@/shared/lib";
import { Button, ErrorState, Field, Input, PageHeader } from "@/shared/ui";
import { useRepo } from "../api/use-repo";
import { useGreetingStore } from "../model/use-greeting-store";
import { RealtimeSection } from "./realtime-section";
import { UiKitSection } from "./ui-kit-section";
import { UploadSection } from "./upload-section";

// zod message 是 i18n key;<Field error={errors.name}> 會幫忙 t()
const schema = z.object({
  name: z.string().min(2, "pages.demo.form.nameMin"),
});

function RepoSection() {
  const { data, isPending, isError, refetch } = useRepo();
  const { t } = useTranslation();

  return (
    <section>
      <PageHeader title={t("pages.demo.title")} />
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
    <section className="mt-10">
      <h2 className="flex items-center gap-2 text-xl font-bold">
        <Sparkles size={20} />
        {t("pages.demo.form.title")}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <Field
          label={t("pages.demo.form.nameLabel")}
          htmlFor="name"
          error={errors.name}
          hint={t("pages.demo.form.hint")}
          required
        >
          <Input
            id="name"
            placeholder={t("pages.demo.form.namePlaceholder")}
            {...register("name")}
          />
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
  return (
    <main className="mx-auto max-w-2xl p-8">
      <RepoSection />
      <GreetingSection />
      <UiKitSection />
      <UploadSection />
      <RealtimeSection />
    </main>
  );
}
