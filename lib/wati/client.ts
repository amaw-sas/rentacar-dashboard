const WATI_API_URL = process.env.WATI_API_URL!;
const WATI_API_TOKEN = process.env.WATI_API_TOKEN!;

function headers() {
  return {
    Authorization: `Bearer ${WATI_API_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function cleanPhone(phone: string): string {
  return phone.replace(/[\s+\-()]/g, "");
}

export async function addContact(phone: string, name: string): Promise<void> {
  const cleanedPhone = cleanPhone(phone);
  const url = `${WATI_API_URL}/addContact/${cleanedPhone}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(
        `[wati] addContact failed for ${cleanedPhone}: ${res.status} ${body}`
      );
    }
  } catch (error) {
    console.error(`[wati] addContact error for ${cleanedPhone}:`, error);
  }
}

interface TemplateParam {
  name: string;
  value: string;
}

export async function sendTemplateMessage(
  phone: string,
  templateName: string,
  broadcastName: string,
  params: TemplateParam[]
): Promise<void> {
  const cleanedPhone = cleanPhone(phone);
  const url = `${WATI_API_URL}/sendTemplateMessage/${cleanedPhone}`;

  const res = await fetch(url, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      template_name: templateName,
      broadcast_name: broadcastName,
      parameters: params,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `[wati] sendTemplateMessage failed for ${cleanedPhone}: ${res.status} ${body}`
    );
  }
}
