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
      <p className="font-display text-6xl font-bold text-ink">404</p>
      <h1 className="mt-4 font-display text-3xl font-bold text-ink md:text-4xl">
        Page not found
      </h1>
      <p className="mt-3 text-sm text-ink/70 md:text-base">
        That link doesn&apos;t go anywhere on PokePatch. Try one of these instead:
      </p>
      <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Button href="/">Back to home</Button>
        <Button href="/gallery" variant="secondary">
          View gallery
        </Button>
      </div>
      <p className="mt-6 text-sm text-ink/60">
        Need a quote?{" "}
        <Link href="/quote" className="font-semibold text-ink hover:underline">
          Get in touch
        </Link>
        .
      </p>
    </div>
  );
}
