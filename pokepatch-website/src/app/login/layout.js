import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Log in",
  ...privatePageMetadata,
};

export default function LoginLayout({ children }) {
  return children;
}
