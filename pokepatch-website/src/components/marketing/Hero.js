import Image from "next/image";
import Button from "@/components/Button";
import ScrollReveal from "@/components/marketing/ScrollReveal";
import logo from "@/app/pokepatch_icon.png";

const STATS = [
  { label: "Quote time", value: "< 2 hrs" },
  { label: "Drop-off", value: "N. San Jose" },
  { label: "Mail-in", value: "US-wide" },
];

const HERO_PAIR = {
  title: "Giovanni's Nidoking",
  before: "/gallery/nidoking-before-front.webp",
  after: "/gallery/nidoking-after-front.webp",
};

function HeroPairSide({ src, label, title }) {
  return (
    <figure className="min-w-0">
      <div className="relative aspect-[3/4] overflow-hidden rounded-sm bg-night/30 ring-1 ring-ink/10">
        <Image
          src={src}
          alt={`${title} ${label.toLowerCase()} restoration`}
          fill
          priority
          sizes="(max-width: 1024px) 45vw, 280px"
          className="object-cover"
        />
      </div>
      <figcaption className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-ink/45 sm:text-[10px]">
        {label}
      </figcaption>
    </figure>
  );
}

/**
 * Brand-first hero in the dark editorial system.
 * Copy stays shop-plain; type stays Instrument / professional.
 * Right column shows a real before/after so the first viewport proves the product.
 */
export default function Hero() {
  return (
    <section className="relative px-4 pb-16 pt-10 sm:px-6 md:px-10 md:pb-28 md:pt-16">
      <div className="mx-auto w-full max-w-6xl">
        <ScrollReveal>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b border-ink/10 pb-4 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/40 sm:tracking-[0.28em] md:text-[11px]">
            <span>PokePatch</span>
            <span className="hidden sm:block">Card Restorations</span>
            <span className="ml-auto sm:ml-0">Bay Area · Mail-in</span>
          </div>
        </ScrollReveal>

        <div className="mt-12 grid items-end gap-12 sm:mt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <ScrollReveal variant="dramatic">
            <div className="mb-7 sm:mb-9">
              <Image
                src={logo}
                alt="PokePatch logo"
                priority
                className="h-14 w-auto sm:h-16 md:h-20"
              />
            </div>

            <h1 className="text-[2.35rem] font-medium leading-[1.05] tracking-[-0.03em] text-ink sm:text-5xl sm:leading-[0.98] md:text-6xl lg:text-7xl">
              Trading cards,
              <br />
              carefully restored.
            </h1>

            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ink/60 sm:mt-6 sm:max-w-xl sm:text-base md:text-lg">
              Creases, edge lifts, dirt, dents — we fix what we can, document
              every card with before-and-after photos, and return them looking
              like themselves again.
            </p>

            <div className="mt-8 flex w-full flex-col gap-3 sm:mt-10 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
              <Button
                href="/contact"
                variant="marketing"
                className="w-full min-h-12 text-center font-mono text-xs uppercase tracking-[0.18em] sm:w-auto"
              >
                Get Free Quote
              </Button>
              <Button
                href="/gallery"
                variant="marketing-secondary"
                className="w-full min-h-12 text-center font-mono text-xs uppercase tracking-[0.18em] sm:w-auto"
              >
                View Gallery
              </Button>
            </div>
          </ScrollReveal>

          <ScrollReveal>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <HeroPairSide
                src={HERO_PAIR.before}
                label="Before"
                title={HERO_PAIR.title}
              />
              <HeroPairSide
                src={HERO_PAIR.after}
                label="After"
                title={HERO_PAIR.title}
              />
            </div>
            <p className="mt-3 truncate text-center font-mono text-[10px] uppercase tracking-[0.14em] text-ink/40">
              {HERO_PAIR.title}
            </p>
          </ScrollReveal>
        </div>

        <ScrollReveal>
          <dl className="mt-12 grid grid-cols-3 gap-3 border-t border-ink/10 pt-6 sm:mt-14 sm:gap-8 md:mt-16">
            {STATS.map((stat) => (
              <div key={stat.label} className="min-w-0">
                <dt className="font-mono text-[9px] uppercase tracking-[0.16em] text-ink/45 sm:text-[10px] sm:tracking-[0.25em]">
                  {stat.label}
                </dt>
                <dd className="mt-1 text-sm font-medium tracking-tight text-ink sm:mt-2 sm:text-lg md:text-xl">
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </ScrollReveal>
      </div>
    </section>
  );
}
