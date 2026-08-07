import { privatePageMetadata } from "@/lib/privatePageMetadata";

export const metadata = {
  title: "My Orders",
  ...privatePageMetadata,
};

export default function MyOrdersLayout({ children }) {
  return children;
}
