import { Nunito } from "next/font/google";
import localFont from "next/font/local";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
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
  title: "PokePatch Card Restorations",
  description:
    "Gentle, careful trading card restorations with a cozy touch. Surface cleaning, edge repair, crease flattening, and full restorations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        className={`${nunito.variable} ${pixelify.variable} ${gugi.variable} flex min-h-screen flex-col font-sans antialiased`}
      >
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
