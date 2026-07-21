"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import LoadingSpinner from "@/components/LoadingSpinner";

export default function MessagesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/my-orders");
  }, [router]);

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LoadingSpinner label="Redirecting to My Orders…" />
    </div>
  );
}
