import SectionHeading from "@/components/SectionHeading";

const galleryItems = [
  {
    title: "Vintage Holo",
    beforeColor: "bg-stone-300",
    afterColor: "bg-amber-200",
  },
  {
    title: "Worn Edges",
    beforeColor: "bg-stone-400",
    afterColor: "bg-emerald-200",
  },
  {
    title: "Creased Promo",
    beforeColor: "bg-stone-300",
    afterColor: "bg-sky-200",
  },
  {
    title: "Full Restoration",
    beforeColor: "bg-stone-500",
    afterColor: "bg-rose-200",
  },
];

function PlaceholderCard({ label, colorClass }) {
  return (
    <div
      className={`flex aspect-[3/4] flex-col items-center justify-center rounded-xl ${colorClass} pixel-border`}
    >
      <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-wide text-ink/60">
        {label}
      </span>
    </div>
  );
}

export default function GalleryPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="animate-fade-up">
        <SectionHeading subtitle="Real restorations coming soon — here's a peek at the format!">
          Gallery
        </SectionHeading>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {galleryItems.map((item, index) => (
          <div
            key={item.title}
            className="animate-fade-up space-y-3"
            style={{ animationDelay: `${100 + index * 100}ms` }}
          >
            <h3 className="text-center font-display text-lg font-bold text-ink">
              {item.title}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <PlaceholderCard label="Before" colorClass={item.beforeColor} />
              <PlaceholderCard label="After" colorClass={item.afterColor} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
