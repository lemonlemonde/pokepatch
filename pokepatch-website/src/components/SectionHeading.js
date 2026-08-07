export default function SectionHeading({ children, subtitle, as: Tag = "h2" }) {
  return (
    <div className="mb-8 text-center">
      <Tag className="font-display text-3xl font-bold text-ink md:text-4xl">
        {children}
      </Tag>
      {subtitle && (
        <p className="mt-2 text-sm text-ink/60 md:text-base">
          {subtitle}
        </p>
      )}
    </div>
  );
}
