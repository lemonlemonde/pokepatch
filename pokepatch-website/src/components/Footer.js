import SocialLinks from "@/components/SocialLinks";

export default function Footer() {
  return (
    <footer className="mt-auto bg-gradient-to-b from-night/90 to-night/60 px-6 py-8 text-center text-sm text-blush/80">
      <p className="font-display text-base text-ink">
        PokePatch: Card Restorations
      </p>
      <SocialLinks className="mt-4" />
      <p className="mt-3 text-xs text-ink/50">
        &copy; {new Date().getFullYear()} PokePatch. All rights reserved.
      </p>
    </footer>
  );
}
