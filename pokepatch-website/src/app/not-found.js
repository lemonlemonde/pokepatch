import Link from "next/link";
import Button from "@/components/Button";
import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Page not found",
  ...privatePageMetadata,
};

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-ink/40">
        404
      </p>
      <h1 className="mt-4 text-[1.85rem] font-medium leading-tight tracking-[-0.02em] text-ink sm:text-4xl md:text-5xl">
        Page not found
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-ink/60 md:text-base">
        That link doesn&apos;t go anywhere on PokePatch. Try one of these instead:
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button href="/">Back to home</Button>
        <Button href="/gallery" variant="secondary">
          View gallery
        </Button>
      </div>
      <p className="mt-6 text-sm text-ink/55">
        Need a quote?{" "}
        <Link
          href="/quote"
          className="font-medium text-ink underline-offset-4 hover:underline"
        >
          Get Free Quote
        </Link>
        .
      </p>
    </div>
  );
}
