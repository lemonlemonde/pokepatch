import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "Messages",
  ...privatePageMetadata,
};

export default function MessagesLayout({ children }) {
  return children;
}
