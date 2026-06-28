export default function SectionHeading({ children, subtitle }) {
  return (
    <div className="mb-8 text-center">
      <h2 className="font-display text-3xl font-bold text-ink md:text-4xl">
        {children}
      </h2>
      {subtitle && (
        <p className="mt-2 font-secondary text-sm text-ink/60 md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}
