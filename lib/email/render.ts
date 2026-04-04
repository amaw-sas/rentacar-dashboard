import { render } from "@react-email/components";
import type { ReactElement } from "react";

export async function renderEmail(template: ReactElement): Promise<string> {
  return render(template);
}
