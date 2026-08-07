const SITE_URL = "https://pokepatch.cards";
const SITE_NAME = "PokePatch Card Restorations";
const SITE_DESCRIPTION =
  "Gentle, careful trading card restorations with a cozy touch. Surface cleaning, edge repair, crease flattening, and full restorations.";

/** FAQ titles on the page include emoji — schema.org names should be plain text. */
function faqQuestionForSchema(question) {
  return question
    .replace(/^[\p{Extended_Pictographic}\uFE0F\u00A0\s]+/gu, "")
    .trim();
}

export function faqPageJsonLd(faqs) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map(({ question, answer }) => ({
      "@type": "Question",
      name: faqQuestionForSchema(question),
      acceptedAnswer: {
        "@type": "Answer",
        text: answer,
      },
    })),
  };
}

export function localBusinessJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    image: `${SITE_URL}/opengraph-image.png`,
    email: "pokepatch.cards@gmail.com",
    areaServed: [
      {
        "@type": "City",
        name: "San Jose",
        containedInPlace: {
          "@type": "State",
          name: "California",
        },
      },
      {
        "@type": "Country",
        name: "United States",
      },
    ],
    sameAs: ["https://www.instagram.com/pokepatch.cards/"],
  };
}
