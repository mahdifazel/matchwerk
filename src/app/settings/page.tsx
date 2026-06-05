import { BoardCta } from "@/components/board-cta";
import { CvUpload } from "@/components/cv-upload";
import { SettingsForm } from "@/components/settings-form";

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-10 px-5 pb-24 sm:px-8">
      <header className="pt-10">
        <p className="eyebrow mb-4">Configuration</p>
        <h1 className="font-display text-[2.2rem] leading-[1.05] tracking-tight sm:text-[2.6rem]">
          Settings
        </h1>
        <p className="text-muted-foreground mt-3 max-w-xl text-[0.95rem] leading-relaxed">
          Your CV and search preferences, set once, reused for every search.
        </p>
      </header>
      <CvUpload />
      <SettingsForm />
      <BoardCta />
    </main>
  );
}
