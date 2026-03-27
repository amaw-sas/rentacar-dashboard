"use client";

import {
  Building2,
  Car,
  DollarSign,
  LayoutDashboard,
  LogOut,
  MapPin,
  Tags,
  UserRound,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "@/lib/actions/auth";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";

const navGroups = [
  {
    label: "General",
    items: [
      { title: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Datos de Referencia",
    items: [
      { title: "Rentadoras", href: "/rental-companies", icon: Building2 },
      { title: "Sucursales", href: "/locations", icon: MapPin },
      { title: "Categorías", href: "/categories", icon: Car },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { title: "Referidos", href: "/referrals", icon: Tags },
      { title: "Clientes", href: "/customers", icon: Users },
      { title: "Reservas", href: "/reservations", icon: UserRound },
    ],
  },
  {
    label: "Finanzas",
    items: [
      { title: "Comisiones", href: "/commissions", icon: DollarSign },
    ],
  },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="border-b px-4 py-3">
        <span className="text-lg font-semibold">Rentacar</span>
      </SidebarHeader>
      <SidebarContent>
        {navGroups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        item.href === "/"
                          ? pathname === "/"
                          : pathname.startsWith(item.href)
                      }
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter className="border-t p-4">
        <form action={signOut}>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <LogOut className="mr-2 h-4 w-4" />
            Cerrar sesión
          </Button>
        </form>
      </SidebarFooter>
    </Sidebar>
  );
}
