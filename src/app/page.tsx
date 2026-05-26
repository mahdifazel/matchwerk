import { JobBoard } from "@/components/job-board";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 sm:px-8">
      <JobBoard />
    </main>
  );
}
