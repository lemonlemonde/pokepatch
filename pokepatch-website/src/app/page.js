import Link from "next/link";
import Image from "next/image";
import SectionHeading from "@/components/SectionHeading";
import logo from "./pokepatch_icon.png";
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
      "Trading cards of all kinds — Pokémon, One Piece, Sports, Magic, Yugioh, and more. If you're unsure, send a photo through the contact form and we'll let you know!",
  },
  {
    question: "[ ⏳ ]\u00A0 How soon can I get a quote?",
    answer: "Turnaround time is less than 2 hours.",
  },
  
  {
    question: "[ ⏳ ]\u00A0 How long does restoration take?",
    answer: "Anywhere from a few hours to 2 weeks, depending on the number of cards, restoration type, and any pickup or shipping logistics.",
  },
  {
    question: "[ 🎨 ]\u00A0 Can whitening on cards be fixed?",
    answer:
      "No — whitening cannot be fixed, and the card will be marked as altered if graded.",
  },
  {
    question: "[ 📦 ]\u00A0 Is shipping covered?",
    answer:
      "Any shipping costs are not covered. Cards will be carefully be re-packaged and sent back in the same packaging they were sent in, whether that's top loaders, bubble wrap, or more.",
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
        <div className="mb-3 flex justify-center">
          <Image
            src={logo}
            alt="PokePatch logo"
            priority
            className="h-24 w-auto animate-pop-in md:h-28"
          />
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
        <p className="mt-2 font-secondary text-lg text-berry md:text-xl">
          Card Restorations
        </p>
        {/* <p className="mt-2 font-secondary text-sm text-ink/50 md:text-base">
          where every card gets a Max Revive
        </p> */}
        <p className="mt-2 font-secondary text-sm text-ink/70 md:text-base">
        Bay Area Drop-Off • Nationwide Mail-In
        </p>
        <p className="mt-3 font-secondary text-base italic text-berry">
          
        </p>
        <Link
          href="/contact"
          className="mt-6 inline-block rounded-full bg-gradient-to-b from-[#441937] to-[#1A0F2E] px-6 py-3 font-secondary font-bold text-[#FFE3EE] shadow-cozy transition-all duration-200 ease-out active:translate-y-0.5 active:shadow-cozy-sm sm:hover:-translate-y-1 sm:hover:from-[#581f47] sm:hover:to-[#22143C] sm:hover:shadow-[0_10px_0_0_rgba(0,0,0,0.35)]"
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
