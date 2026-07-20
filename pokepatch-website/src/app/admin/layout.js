import { Suspense } from "react";
import AdminApp from "@/components/admin/AdminApp";

export const metadata = {
  title: "Admin · PokePatch",
  robots: {
    index: false,
    follow: false,
  },
};

// AdminApp lives in the layout so it stays mounted across the section routes
// (/admin/orders, /admin/orders/all, /admin/gallery, /admin/messages, /admin/studio). The
// per-section pages render nothing; the active view is derived from the URL
// inside AdminApp (including ?edit=<orderId> for the order editor).
export default function AdminLayout({ children }) {
  return (
    <div className="admin-plain-type">
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 text-sm text-ink/60">
            Loading admin…
          </div>
        }
      >
        <AdminApp />
      </Suspense>
      {children}
    </div>
  );
}
