import {
  Nunito,
  Instrument_Sans,
  Geist_Mono,
} from "next/font/google";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PostHogProvider from "@/components/PostHogProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

/** Kept for admin Studio canvas text (see studioLayout LABEL_FONT_FAMILY). */
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  style: ["normal", "italic"],
});

const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const SITE_URL = "https://pokepatch.cards";
const SITE_DESCRIPTION =
  "Careful trading card restorations. Surface cleaning, edge repair, crease flattening, and full restorations. Bay Area drop-off or US mail-in.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "PokePatch Card Restorations",
    template: "%s — PokePatch",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    siteName: "PokePatch Card Restorations",
    url: SITE_URL,
    type: "website",
    title: "PokePatch Card Restorations",
    description: SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image.png",
        width: 1200,
        height: 630,
        alt: "PokePatch Card Restorations",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PokePatch Card Restorations",
    description: SITE_DESCRIPTION,
    images: ["/opengraph-image.png"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${nunito.variable} ${instrumentSans.variable} ${geistMono.variable} marketing-page flex min-h-screen flex-col antialiased`}
      >
        <div className="marketing-site-bg pointer-events-none fixed inset-0 -z-[9]" aria-hidden="true">
          <div className="marketing-glow absolute inset-0" />
          <div className="marketing-grain absolute inset-0" />
        </div>
        <AuthProvider>
          <PostHogProvider>
            <Navbar />
            <main className="relative z-10 flex-1">{children}</main>
            <Footer />
          </PostHogProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
