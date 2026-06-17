import { getCategoryNameMap } from "@/lib/api/category-names";
import { enrichCategoryDescriptions } from "@/lib/api/availability-enrichment";
import { getCategoryCapacityMap } from "@/lib/api/category-capacity";
import { enrichCategoryCapacity } from "@/lib/api/availability-capacity-enrichment";
import { ServiceError } from "@/lib/api/service-error";

/**
 * Availability core (issue #72 Step 2), extracted behavior-preserving from
 * `app/api/reservations/availability/route.ts`. The public route delegates here
 * after auth + parse; an in-process MCP server can call it directly.
 *
 * Contract (unchanged for both funnels rentacar-web + rentacar-reservas):
 * - On a parseable Localiza business error, the proxy status + structured
 *   `{error, message, shortText}` payload propagate verbatim (as ServiceError)
 *   so the funnels render the matching toast.
 * - On a non-parseable proxy error or a network failure, a generic 502 envelope.
 * - On success: the proxy array enriched with curated ES category descriptions
 *   (#74) under SAFE DEGRADATION — if the name lookup fails, the RAW proxy array
 *   is served and the failure logged.
 */
export interface SearchAvailabilityInput {
  pickupLocation: string;
  returnLocation: string;
  pickupDateTime: string;
  returnDateTime: string;
}

export async function searchAvailability(
  input: SearchAvailabilityInput,
): Promise<unknown> {
  const { pickupLocation, returnLocation, pickupDateTime, returnDateTime } =
    input;

  const proxyUrl = process.env.LOCALIZA_PROXY_URL;
  const proxyApiKey = process.env.PROXY_API_KEY;

  if (!proxyUrl || !proxyApiKey) {
    console.error("[availability] Missing LOCALIZA_PROXY_URL or PROXY_API_KEY");
    throw new ServiceError(500, {
      error: "Configuración del servidor incompleta",
    });
  }

  try {
    const proxyResponse = await fetch(`${proxyUrl}/api/localiza/availability`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": proxyApiKey,
      },
      body: JSON.stringify({
        pickupLocation,
        returnLocation,
        pickupDateTime,
        returnDateTime,
      }),
    });

    if (!proxyResponse.ok) {
      const errorBody = await proxyResponse.text();
      console.error(
        `[availability] Proxy error ${proxyResponse.status}:`,
        errorBody,
      );
      // Localiza business errors are serialized by the proxy as structured
      // {error, message, shortText} JSON — forward verbatim so the Nuxt client
      // can render the matching toast. Only fall back to the generic envelope
      // when the body is not parseable (network/HTML error pages).
      try {
        const parsed = JSON.parse(errorBody);
        if (
          parsed &&
          typeof parsed === "object" &&
          typeof parsed.error === "string"
        ) {
          throw new ServiceError(proxyResponse.status, parsed);
        }
      } catch (e) {
        if (e instanceof ServiceError) throw e;
        // not parseable JSON — fall through to the generic response below
      }
      throw new ServiceError(502, {
        error: "Error al consultar disponibilidad",
      });
    }

    const data = await proxyResponse.json();
    if (Array.isArray(data)) {
      let items = data;
      // Name enrichment (#74): on failure, keep the RAW proxy array.
      try {
        const nameMap = await getCategoryNameMap();
        items = enrichCategoryDescriptions(items, nameMap);
      } catch (e) {
        console.error(
          "[availability] category name enrichment failed, serving raw:",
          e,
        );
      }
      // Capacity enrichment (#72): independent safe degradation — on failure,
      // serve the (possibly name-enriched) items WITHOUT the capacity fields.
      try {
        const capacityMap = await getCategoryCapacityMap();
        items = enrichCategoryCapacity(items, capacityMap);
      } catch (e) {
        console.error(
          "[availability] category capacity enrichment failed, serving without capacity:",
          e,
        );
      }
      return items;
    }
    return data;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    console.error("[availability] Request failed:", error);
    throw new ServiceError(502, {
      error: "Error al conectar con el servicio de disponibilidad",
    });
  }
}
