export default function Footer() {
  return (
    <footer className="mt-auto border-t-2 border-ink/10 bg-lavender/30 px-6 py-8 text-center font-secondary text-sm text-ink/70">
      <p className="font-display text-base text-ink">
        PokePatch: Card Restorations
      </p>
      <p className="mt-1">
        Questions?{" "}
        <a
          href="mailto:rayli0224@gmail.com"
          className="font-semibold text-ink underline decoration-blush decoration-2 underline-offset-2 hover:text-ink/80"
        >
          rayli0224@gmail.com
        </a>
      </p>
      <p className="mt-3 text-xs text-ink/50">
        &copy; {new Date().getFullYear()} PokePatch. All rights reserved.
      </p>
    </footer>
  );
}
