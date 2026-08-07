import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Reset password",
  ...privatePageMetadata,
};

export default function ResetPasswordLayout({ children }) {
  return children;
}
