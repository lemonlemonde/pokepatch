import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Redirecting",
  ...privatePageMetadata,
};

export default function ContactLayout({ children }) {
  return children;
}
