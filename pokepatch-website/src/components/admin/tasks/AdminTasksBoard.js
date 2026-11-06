"use client";

import AdminMessagesTask from "@/components/admin/tasks/AdminMessagesTask";

/** Modular admin Tasks board — add future modules as grid siblings. */
export default function AdminTasksBoard({ onOpenOrder }) {
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:gap-6">
      <AdminMessagesTask onOpenOrder={onOpenOrder} />
    </div>
  );
}
