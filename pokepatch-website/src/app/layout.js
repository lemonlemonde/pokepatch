import {
  Nunito,
  Instrument_Sans,
  Geist_Mono,
} from "next/font/google";
import localFont from "next/font/local";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import PostHogProvider from "@/components/PostHogProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  style: ["normal", "italic"],
});

// Marketing-page type system: Instrument Sans + mono labels.
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

const pixelify = localFont({
  src: "./fonts/PixelifySans-VariableFont_wght.ttf",
  variable: "--font-pixelify",
  weight: "400 700",
  display: "swap",
});

const gugi = localFont({
  src: "./fonts/Gugi-Regular.ttf",
  variable: "--font-gugi",
  weight: "400",
  display: "swap",
});

export const metadata = {
  metadataBase: new URL("https://pokepatch.cards"),
  title: {
    default: "PokePatch Card Restorations",
    template: "%s — PokePatch",
  },
  description:
    "Careful trading card restorations. Surface cleaning, edge repair, crease flattening, and full restorations. Bay Area drop-off or US mail-in.",
  openGraph: {
    siteName: "PokePatch Card Restorations",
    url: "https://pokepatch.cards",
    type: "website",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${nunito.variable} ${pixelify.variable} ${gugi.variable} ${instrumentSans.variable} ${geistMono.variable} marketing-page flex min-h-screen flex-col antialiased`}
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
