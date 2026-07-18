import Link from "next/link";

const VARIANTS = {
  primary: "bg-lavender text-night sm:hover:bg-lavender/80",
  secondary: "bg-blush text-night sm:hover:bg-blush/80",
};

/**
 * Shared pill CTA. Renders a Next.js Link when `href` is given, otherwise a
 * plain <button>. All primary actions across the site should use this so the
 * color, shadow, and press/hover motion stay consistent.
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
    "inline-block rounded-full px-6 py-3 font-bold shadow-cozy",
    "transition-all duration-200 ease-out",
    "active:translate-y-0.5 active:shadow-cozy-sm",
    "sm:hover:-translate-y-1 sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 disabled:active:shadow-cozy",
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
