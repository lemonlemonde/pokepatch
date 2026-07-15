import AdminApp from "@/components/admin/AdminApp";

export const metadata = {
  title: "Admin · PokePatch",
  robots: {
    index: false,
    follow: false,
  },
};

// AdminApp lives in the layout so it stays mounted across the section routes
// (/admin/orders, /admin/gallery, /admin/studio). The per-section pages render
// nothing; the active tab is derived from the URL inside AdminApp.
export default function AdminLayout({ children }) {
  return (
    <>
      <AdminApp />
      {children}
    </>
  );
}
