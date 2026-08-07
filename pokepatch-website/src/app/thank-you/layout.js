import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Thank you",
  ...privatePageMetadata,
};

export default function ThankYouLayout({ children }) {
  return children;
}
