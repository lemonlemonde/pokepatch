"use client";

import { useState } from "react";
import AdminMessagesInbox from "@/components/admin/AdminMessagesInbox";
import AdminTaskModule, {
  taskRefreshButtonClassName,
} from "@/components/admin/tasks/AdminTaskModule";

export default function AdminMessagesTask({ onOpenOrder }) {
  const [count, setCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <AdminTaskModule
      eyebrow="Inbox"
      title="Messages"
      description="Orders with new customer messages. Opening one marks those messages as read."
      accent="sky"
      count={count}
      countLabel="Orders with unread messages"
      actions={
        <button
          type="button"
          onClick={() => setRefreshToken((n) => n + 1)}
          disabled={loading}
          className={taskRefreshButtonClassName()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      }
    >
      <AdminMessagesInbox
        refreshToken={refreshToken}
        onOpenOrder={onOpenOrder}
        onStatsChange={({ count: nextCount, loading: nextLoading }) => {
          if (nextCount != null) setCount(nextCount);
          if (typeof nextLoading === "boolean") setLoading(nextLoading);
        }}
      />
    </AdminTaskModule>
  );
}
