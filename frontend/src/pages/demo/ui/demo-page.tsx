import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { useZodForm } from "@/shared/lib";
import { Button, Input } from "@/shared/ui";
import { useRepo } from "../api/use-repo";
import { useGreetingStore } from "../model/use-greeting-store";

// Keep in sync with the zod schema messages below (each must be a valid i18n key).
type DemoFieldKey = "pages.demo.form.nameMin";

const schema = z.object({
  name: z.string().min(2, "pages.demo.form.nameMin" satisfies DemoFieldKey),
});

function RepoSection() {
  const { data, isPending, isError } = useRepo();
  const { t } = useTranslation();

  return (
    <section>
      <h1 className="text-2xl font-bold">{t("pages.demo.title")}</h1>
      {isPending && <p className="mt-4">{t("pages.demo.loading")}</p>}
      {isError && <p className="mt-4 text-destructive">{t("pages.demo.error")}</p>}
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
        <div className="flex flex-col gap-1">
          <label htmlFor="name" className="text-sm font-medium">
            {t("pages.demo.form.nameLabel")}
          </label>
          <Input
            id="name"
            placeholder={t("pages.demo.form.namePlaceholder")}
            {...register("name")}
          />
          {errors.name && (
            <p className="text-sm text-destructive">{t(errors.name.message as DemoFieldKey)}</p>
          )}
        </div>
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
    </main>
  );
}
