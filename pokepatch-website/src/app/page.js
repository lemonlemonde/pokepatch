import Image from "next/image";
import Button from "@/components/Button";
import SectionHeading from "@/components/SectionHeading";
import logo from "./pokepatch_icon.png";
import ServiceCard from "@/components/ServiceCard";
import FaqItem from "@/components/FaqItem";
import FeaturedRestorations from "@/components/FeaturedRestorations";
import { marketingServices } from "@/lib/servicePricing";

const steps = [
  {
    title: "Request a quote",
    text: "Fill out the quote form with photos of your cards and the damage you'd like fixed.",
  },
  {
    title: "Get your quote",
    text: "We review your photos and reply with a quote — usually within 2 hours.",
  },
  {
    title: "Send your cards",
    text: "Drop off locally in North San Jose or mail your cards in from anywhere in the US.",
  },
  {
    title: "Cards come home",
    text: "We restore your cards with before-and-after photos, then return them the way they came.",
  },
];

const services = marketingServices();

const faqs = [
  {
    question: "📨\u00A0 How do I send in my cards?",
    answer:
      "Fill out the quote form with details about your card, and what you'd like fixed for each one. You can opt for local drop-off (North San Jose) or shipping. We'll get in contact with you with a quote and discuss options on how to best restore your cards!",
  },
  {
    question: "🃏\u00A0 What kinds of cards do you restore?",
    answer:
      "Trading cards of all kinds — Pokémon, One Piece, Sports, Magic, Yugioh, and more. If you're unsure, send a photo through the contact form and we'll let you know!",
  },
  {
    question: "⏳\u00A0 How soon can I get a quote?",
    answer: "Turnaround time is less than 2 hours.",
  },
  {
    question: "🛠️\u00A0 How long does restoration take?",
    answer:
      "Anywhere from a few hours to 2 weeks, depending on the number of cards, restoration type, and any pickup or shipping logistics.",
  },
  {
    question: "🎨\u00A0 Can whitening on cards be fixed?",
    answer:
      "No — whitening cannot be fixed, and the card will be marked as altered if graded.",
  },
  {
    question: "📦\u00A0 Is shipping covered?",
    answer:
      "Any shipping costs are not covered. Cards will be carefully re-packaged and sent back in the same packaging they were sent in.",
  },
  {
    question: "📸\u00A0 Do you offer before-and-after photos?",
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
        <h1
          aria-label="PokePatch!"
          className="font-display text-5xl font-bold tracking-tight text-ink md:text-6xl"
        >
          <span aria-hidden="true">
            {"PokePatch \u00A0\u00A0!".split("").map((letter, i) => (
              <span
                key={i}
                className="inline-block animate-pixel-bob"
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                {letter}
              </span>
            ))}
          </span>
        </h1>
        <p className="mt-2 font-secondary text-lg text-berry md:text-xl">
          Card Restorations
        </p>
        <p className="mt-2 text-sm text-ink/70 md:text-base">
          Bay Area Drop-Off • Nationwide Mail-In
        </p>
        <Button href="/contact" className="mt-6">
          Get a Quote
        </Button>
      </section>

      <section className="mb-16 animate-fade-up [animation-delay:150ms]">
        <SectionHeading subtitle="Recent before-and-afters from our workshop">
          Recent Restorations
        </SectionHeading>
        <FeaturedRestorations />
      </section>

      <section className="mb-16 animate-fade-up [animation-delay:300ms]">
        <SectionHeading subtitle="From damaged to displayed in four steps">
          How It Works
        </SectionHeading>
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="pixel-border rounded-2xl border-blush/10 bg-cream/60 p-5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-berry font-display text-sm font-bold text-night">
                {index + 1}
              </span>
              <h3 className="mt-3 font-display text-base font-bold text-ink">
                {step.title}
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink/70">
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-16 animate-fade-up [animation-delay:300ms]">
        <SectionHeading subtitle="Choose the care your card needs">
          Restorations
        </SectionHeading>
        <div className="grid gap-4 sm:grid-cols-2">
          {services.map((service) => (
            <ServiceCard key={service.title} {...service} />
          ))}
        </div>
      </section>

      <section className="mb-16 animate-fade-up [animation-delay:300ms]">
        <SectionHeading subtitle="What to expect from PokePatch services">
          FAQ
        </SectionHeading>
        <div className="space-y-3">
          {faqs.map((faq) => (
            <FaqItem key={faq.question} {...faq} />
          ))}
        </div>
      </section>

      <section className="animate-fade-up text-center [animation-delay:300ms]">
        <h2 className="font-display text-2xl font-bold text-ink md:text-3xl">
          Ready to revive your cards?
        </h2>
        <p className="mt-2 text-sm text-ink/70 md:text-base">
          Send us a few photos and get a quote within 2 hours.
        </p>
        <Button href="/contact" className="mt-5">
          Get a Quote
        </Button>
      </section>
    </div>
  );
}
