import Link from "next/link";

const VARIANTS = {
  primary: "bg-ink text-night shadow-none sm:hover:bg-ink/90",
  secondary:
    "border border-ink/20 bg-transparent text-ink shadow-none sm:hover:border-ink/40 sm:hover:bg-ink/5",
};

const VARIANT_MOTION =
  "active:translate-y-0 shadow-none sm:hover:-translate-y-0.5";

/**
 * Shared pill CTA. Renders a Next.js Link when `href` is given, otherwise a
 * plain <button>. All primary actions across the site should use this so the
 * color and press/hover motion stay consistent.
 */
export default function Button({
  href,
  variant = "primary",
  fullWidth = false,
  className = "",
  children,
  ...props
}) {
  const classes = [
    "inline-block rounded-full px-6 py-3 font-bold min-h-11",
    "transition-all duration-200 ease-out",
    VARIANT_MOTION,
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0",
    VARIANTS[variant] ?? VARIANTS.primary,
    fullWidth ? "w-full text-center" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (href) {
    return (
      <Link href={href} className={classes} {...props}>
        {children}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} {...props}>
      {children}
    </button>
  );
}
