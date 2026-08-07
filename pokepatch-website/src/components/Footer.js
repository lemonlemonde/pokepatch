import SocialLinks from "@/components/SocialLinks";

export default function Footer() {
  return (
    <footer className="relative z-10 mt-auto border-t border-ink/10 px-6 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 text-center">
        <p className="text-sm font-medium tracking-tight text-ink">
          PokePatch · Card Restorations
        </p>
        <SocialLinks />
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-ink/35">
          &copy; {new Date().getFullYear()} PokePatch
        </p>
      </div>
    </footer>
  );
}
