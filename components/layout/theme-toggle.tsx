"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
    >
      <Sun className="mr-2 h-4 w-4 dark:hidden" />
      <Moon className="mr-2 hidden h-4 w-4 dark:block" />
      <span className="dark:hidden">Modo oscuro</span>
      <span className="hidden dark:block">Modo claro</span>
    </Button>
  );
}
