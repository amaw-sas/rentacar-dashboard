import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { NotificationBell } from "@/components/layout/notification-bell";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  getRecentNotifications,
  getUnreadCount,
} from "@/lib/queries/operator-notifications";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Operator notification center (#215). Fetched here so the bell is present in
  // every dashboard view (SCEN-006). Both reads fail open (0 / []), so a stats
  // hiccup never breaks the shell.
  const [unreadCount, notifications] = await Promise.all([
    getUnreadCount(),
    getRecentNotifications(),
  ]);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <main className="flex-1">
          <header className="flex h-14 items-center justify-between border-b px-4">
            <SidebarTrigger />
            <NotificationBell items={notifications} unreadCount={unreadCount} />
          </header>
          <div className="p-6">{children}</div>
          <Toaster richColors />
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
