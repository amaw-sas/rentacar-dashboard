const GHL_BASE_URL = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-07-28";
const TIMEOUT_MS = 30_000;

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: GHL_API_VERSION,
  };
}

async function request<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T | null> {
  const url = `${GHL_BASE_URL}${path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: headers(apiKey),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        `[ghl] ${method} ${path} failed: ${res.status} ${text}`
      );
      return null;
    }

    return (await res.json()) as T;
  } catch (error) {
    console.error(`[ghl] ${method} ${path} error:`, error);
    return null;
  }
}

// --- Contacts ---

interface UpsertContactPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  locationId: string;
  source?: string;
}

interface UpsertContactResponse {
  contact: { id: string };
}

export async function upsertContact(
  apiKey: string,
  locationId: string,
  contact: Omit<UpsertContactPayload, "locationId">
): Promise<string | null> {
  const result = await request<UpsertContactResponse>(
    apiKey,
    "POST",
    "/contacts/upsert",
    { ...contact, locationId }
  );
  return result?.contact?.id ?? null;
}

// --- Opportunities ---

interface OpportunityPayload {
  pipelineId: string;
  pipelineStageId: string;
  name: string;
  status: "open" | "won" | "lost" | "abandoned";
  monetaryValue?: number;
  contactId: string;
  customFields?: { key: string; field_value: string }[];
}

interface OpportunityResponse {
  opportunity: { id: string };
}

export async function createOpportunity(
  apiKey: string,
  opportunity: OpportunityPayload
): Promise<string | null> {
  const result = await request<OpportunityResponse>(
    apiKey,
    "POST",
    "/opportunities/",
    opportunity
  );
  return result?.opportunity?.id ?? null;
}

export async function updateOpportunity(
  apiKey: string,
  opportunityId: string,
  data: Partial<OpportunityPayload>
): Promise<boolean> {
  const result = await request(
    apiKey,
    "PUT",
    `/opportunities/${opportunityId}`,
    data
  );
  return result !== null;
}

interface SearchOpportunitiesResponse {
  opportunities: { id: string }[];
}

export async function searchOpportunities(
  apiKey: string,
  pipelineId: string,
  contactId: string
): Promise<{ id: string }[]> {
  const params = new URLSearchParams({
    pipeline_id: pipelineId,
    contact_id: contactId,
  });
  const result = await request<SearchOpportunitiesResponse>(
    apiKey,
    "GET",
    `/opportunities/search?${params.toString()}`
  );
  return result?.opportunities ?? [];
}
