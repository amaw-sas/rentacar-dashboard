import { Section, Text, Heading } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface MonthlyClientEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  franchiseWhatsapp?: string;
  franchiseLogo?: string;
  customerName: string;
  categoryName: string;
  pickupLocation: string;
  pickupDate: string;
  pickupHour: string;
  returnLocation: string;
  returnDate: string;
  returnHour: string;
  selectedDays: number;
  monthlyMileage?: number | null;
}

export function MonthlyClientEmail(props: MonthlyClientEmailProps) {
  const mileageLabels: Record<string, string> = {
    "1000": "1.000 km/mes",
    "2000": "2.000 km/mes",
    "3000": "3.000 km/mes",
  };

  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseWhatsapp={props.franchiseWhatsapp}
      franchiseLogo={props.franchiseLogo}
    >
      <Section style={badgeContainer}>
        <Text style={badge}>RESERVA MENSUAL</Text>
      </Section>

      <Heading as="h1" style={heading}>
        Solicitud recibida
      </Heading>

      <Text style={intro}>
        Hola <strong>{props.customerName}</strong>, recibimos tu solicitud de
        reserva mensual. Pronto nos pondremos en contacto contigo para
        coordinar los detalles y confirmar la disponibilidad del vehículo.
      </Text>

      <Section style={detailBox}>
        <table style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td style={detailLabel}>Categoría</td>
              <td style={detailValue}>{props.categoryName}</td>
            </tr>
            <tr>
              <td style={detailLabel}>Recogida</td>
              <td style={detailValue}>
                {props.pickupLocation}
                <br />
                {props.pickupDate} — {props.pickupHour}
              </td>
            </tr>
            <tr>
              <td style={detailLabel}>Devolución</td>
              <td style={detailValue}>
                {props.returnLocation}
                <br />
                {props.returnDate} — {props.returnHour}
              </td>
            </tr>
            <tr>
              <td style={detailLabel}>Duración</td>
              <td style={detailValue}>{props.selectedDays} días</td>
            </tr>
            {props.monthlyMileage && (
              <tr>
                <td style={detailLabel}>Kilometraje</td>
                <td style={detailValue}>
                  {mileageLabels[String(props.monthlyMileage)] ||
                    `${props.monthlyMileage} km/mes`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section style={noteBox}>
        <Text style={noteTitle}>¿Qué sigue?</Text>
        <Text style={noteItem}>
          • Un asesor validará tu solicitud con la rentadora
        </Text>
        <Text style={noteItem}>
          • Recibirás confirmación con los detalles del vehículo
        </Text>
        <Text style={noteItem}>
          • Te compartiremos el contrato y los pasos para la entrega
        </Text>
      </Section>

      <Text style={closing}>
        Si tienes alguna pregunta, no dudes en contactarnos.
      </Text>
    </EmailLayout>
  );
}

const badgeContainer = {
  textAlign: "center" as const,
  marginBottom: "12px",
};

const badge = {
  display: "inline-block" as const,
  backgroundColor: "#eff6ff",
  color: "#1d4ed8",
  fontSize: "11px",
  fontWeight: "700" as const,
  padding: "6px 16px",
  borderRadius: "9999px",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
  margin: "0",
};

const heading = {
  fontSize: "24px",
  fontWeight: "700" as const,
  color: "#18181b",
  textAlign: "center" as const,
  margin: "0 0 20px",
};

const intro = {
  fontSize: "15px",
  color: "#3f3f46",
  lineHeight: "1.7",
  marginBottom: "24px",
};

const detailBox = {
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  padding: "16px 20px",
  borderRadius: "10px",
  marginBottom: "24px",
};

const detailLabel = {
  fontSize: "12px",
  color: "#71717a",
  fontWeight: "600" as const,
  padding: "6px 12px 6px 0",
  verticalAlign: "top" as const,
  whiteSpace: "nowrap" as const,
};

const detailValue = {
  fontSize: "14px",
  color: "#18181b",
  padding: "6px 0",
  verticalAlign: "top" as const,
  lineHeight: "1.5",
};

const noteBox = {
  backgroundColor: "#f0f9ff",
  border: "1px solid #bae6fd",
  padding: "16px 20px",
  borderRadius: "10px",
  marginBottom: "24px",
};

const noteTitle = {
  fontSize: "14px",
  fontWeight: "700" as const,
  color: "#0c4a6e",
  margin: "0 0 8px",
};

const noteItem = {
  fontSize: "14px",
  color: "#0369a1",
  margin: "2px 0",
  lineHeight: "1.6",
};

const closing = {
  fontSize: "14px",
  color: "#71717a",
  lineHeight: "1.6",
  textAlign: "center" as const,
};
