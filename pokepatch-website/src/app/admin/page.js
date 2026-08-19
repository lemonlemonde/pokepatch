"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** `/admin` has no board of its own — land on Orders. */
export default function AdminPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/orders/");
  }, [router]);

  return null;
}
