import {
  faqPageJsonLd,
  localBusinessJsonLd,
} from "@/lib/homeStructuredData";

function JsonLd({ data }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function HomeStructuredData({ faqs }) {
  return (
    <>
      <JsonLd data={localBusinessJsonLd()} />
      <JsonLd data={faqPageJsonLd(faqs)} />
    </>
  );
}
