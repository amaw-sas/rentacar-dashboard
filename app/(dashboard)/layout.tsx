import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <main className="flex-1">
          <header className="flex h-14 items-center border-b px-4">
            <SidebarTrigger />
          </header>
          <div className="p-6">{children}</div>
          <Toaster richColors />
        </main>
      </SidebarProvider>
    </TooltipProvider>
  );
}
