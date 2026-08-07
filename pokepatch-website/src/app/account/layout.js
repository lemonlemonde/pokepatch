import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Account",
  ...privatePageMetadata,
};

export default function AccountLayout({ children }) {
  return children;
}
