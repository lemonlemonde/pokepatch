export default function Footer() {
  return (
    <footer className="mt-auto bg-gradient-to-b from-night/90 to-night/60 px-6 py-8 text-center font-secondary text-sm text-blush/80">
      <p className="font-display text-base text-ink">
        PokePatch: Card Restorations
      </p>
      <p className="mt-3 text-xs text-ink/50">
        &copy; {new Date().getFullYear()} PokePatch. All rights reserved.
      </p>
    </footer>
  );
}
