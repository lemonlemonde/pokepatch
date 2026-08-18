"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";

/** Old /contact URL — keep for bookmarks and external links. */
export default function ContactRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/quote/");
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoadingSpinner label="Redirecting to quote…" />
    </div>
  );
}
