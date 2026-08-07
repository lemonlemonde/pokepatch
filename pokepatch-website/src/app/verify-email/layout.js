import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Verify email",
  ...privatePageMetadata,
};

export default function VerifyEmailLayout({ children }) {
  return children;
}
