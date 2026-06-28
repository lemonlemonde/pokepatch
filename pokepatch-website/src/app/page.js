import Link from "next/link";
import SectionHeading from "@/components/SectionHeading";
import ServiceCard from "@/components/ServiceCard";
import FaqItem from "@/components/FaqItem";

const services = [
  {
    title: "Surface Restoration",
    price: "$9",
    unit: "/ card",
    features: [
      "Surface cleaning",
      "Scratch minimization",
      "Shine enhancement",
    ],
    bulk: [
      { label: "10+ cards", value: "$7 / card" },
      { label: "25+ cards", value: "$6 / card" },
    ],
    accent: "blush",
  },
  {
    title: "High-Value Handling",
    features: ["Added on top of restoration service"],
    bulk: [
      { label: "$200–$500", value: "+4%" },
      { label: "$500+", value: "+8%" },
    ],
    bulkLabel: "Surcharge Tiers",
    accent: "mint",
  },
  {
    title: "Precision Pressing & Flattening",
    price: "$28",
    unit: "/ card",
    features: ["Minor bends", "Light warping", "Subtle edge lift"],
    bulk: [{ label: "10+ cards", value: "$5 off / card" }],
    accent: "lavender",
  },
  {
    title: "Advanced Restoration",
    price: "$45+",
    unit: "/ card",
    features: ["Creases", "Heavy dents", "Severe warping"],
    bulk: [{ label: "25+ cards", value: "$10 off / card" }],
    accent: "peach",
  },
];

const faqs = [
  {
    question: "[ 📨 ]\u00A0 How do I send in my cards?",
    answer:
      "Fill out the quote form with details about your card, and what you'd like fixed for each one. You can opt for local drop-off (North San Jose) or shipping. We'll get in contact with you with a quote and discuss options on how to best restore your cards!",
  },
  {
    question: "[ 🃏 ]\u00A0 What kinds of cards do you restore?",
    answer:
      "Trading cards of all kinds — Pokémon, sports cards, TCG, and more. If you're unsure, send a photo through the contact form and we'll let you know!",
  },
  {
    question: "[ ⏳ ]\u00A0 How long does restoration take?",
    items: [
      { label: "Quote", text: "Turnaround time is 1 day." },
      {
        label: "Restoration",
        text: "Anywhere from a few hours to 2 weeks, depending on the number of cards, restoration type, and any pickup or shipping logistics.",
      },
    ],
  },
  {
    question: "[ 🎨 ]\u00A0 Can whitening on cards be fixed?",
    answer:
      "No — whitening cannot be truly fixed. It can only be addressed by painting the colors back in, but this alters the original card.",
  },
  {
    question: "[ 💎 ]\u00A0 Will restoration affect my card's value?",
    answer:
      "Any restoration can affect grading and resale value. We always discuss options with you first so you can decide what's best for your card.",
  },
  {
    question: "[ 📦 ]\u00A0 Is shipping covered?",
    answer:
      "Any shipping costs are not covered. Cards will be carefully be re-packaged and sent back in the same packaging they were sent in, whether that's top loaders, bubble wrap, or more. Feel free to reach out for any questions or to discuss options!",
  },
  {
    question: "[ 📸 ]\u00A0 Do you offer before-and-after photos?",
    answer:
      "Yes! We document every restoration and share before-and-after photos. Check out our Gallery page for examples.",
  },
];

export default function Home() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <section className="mb-16 animate-fade-up text-center">
        <div className="mb-6 flex justify-center">
          <div className="h-20 w-20 animate-pop-in rounded-full bg-pink-300 shadow-cozy" />
        </div>
        <h1 className="font-display text-5xl font-bold tracking-tight text-ink md:text-6xl">
          {"PokePatch \u00A0\u00A0!".split("").map((letter, i) => (
            <span
              key={i}
              className="inline-block animate-pixel-bob"
              style={{ animationDelay: `${i * 0.12}s` }}
            >
              {letter}
            </span>
          ))}
        </h1>
        <p className="mt-2 font-secondary text-lg text-ink/70 md:text-xl">
          Card Restorations
        </p>
        <p className="mt-3 font-secondary text-base italic text-berry">
          Where every card gets a Max Revive
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-block rounded-full bg-blush px-6 py-3 font-bold text-ink shadow-cozy transition-all duration-200 ease-out hover:-translate-y-1 hover:bg-blush/80 hover:shadow-[0_10px_0_0_rgba(74,63,85,0.2)] active:translate-y-0.5 active:shadow-cozy-sm"
        >
          Get a Quote
        </Link>
      </section>

      <section className="mb-16 animate-fade-up [animation-delay:150ms]">
        <SectionHeading subtitle="Choose the care your card needs">
          Restorations
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.title} {...service} />
          ))}
        </div>
      </section>

      <section className="animate-fade-up [animation-delay:300ms]">
        <SectionHeading subtitle="What to expect from PokePatch services">
          FAQ
        </SectionHeading>
        <div className="space-y-3">
          {faqs.map((faq) => (
            <FaqItem key={faq.question} {...faq} />
          ))}
        </div>
      </section>
    </div>
  );
}
