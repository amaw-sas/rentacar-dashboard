import { Section, Text, Heading } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface FailedClientEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  franchiseLogo?: string;
  customerName: string;
  categoryName: string;
  pickupDate: string;
  returnDate: string;
  pickupLocation: string;
}

export function FailedClientEmail(props: FailedClientEmailProps) {
  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseLogo={props.franchiseLogo}
    >
      <Section style={badgeContainer}>
        <Text style={badge}>SIN DISPONIBILIDAD</Text>
      </Section>

      <Heading as="h1" style={heading}>
        Lo sentimos
      </Heading>

      <Text style={intro}>
        Hola <strong>{props.customerName}</strong>, lamentamos informarte que la
        categoría <strong>{props.categoryName}</strong> no se encuentra disponible
        para tu solicitud.
      </Text>

      <Section style={detailBox}>
        <table style={{ width: "100%" }}>
          <tbody>
            <tr>
              <td style={detailLabel}>Fechas</td>
              <td style={detailValue}>
                {props.pickupDate} — {props.returnDate}
              </td>
            </tr>
            <tr>
              <td style={detailLabel}>Ubicación</td>
              <td style={detailValue}>{props.pickupLocation}</td>
            </tr>
            <tr>
              <td style={detailLabel}>Categoría</td>
              <td style={detailValue}>{props.categoryName}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section style={suggestionBox}>
        <Text style={suggestionTitle}>¿Qué puedes hacer?</Text>
        <Text style={suggestionItem}>• Intentar con fechas diferentes</Text>
        <Text style={suggestionItem}>• Probar con otra categoría de vehículo</Text>
        <Text style={suggestionItem}>• Seleccionar otra ubicación de recogida</Text>
      </Section>

      <Text style={closing}>
        Si necesitas ayuda, no dudes en contactarnos. Estamos para asistirte.
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
  backgroundColor: "#fef2f2",
  color: "#b91c1c",
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
  padding: "4px 12px 4px 0",
  verticalAlign: "top" as const,
  whiteSpace: "nowrap" as const,
};

const detailValue = {
  fontSize: "14px",
  color: "#18181b",
  padding: "4px 0",
  verticalAlign: "top" as const,
};

const suggestionBox = {
  backgroundColor: "#f0f9ff",
  border: "1px solid #bae6fd",
  padding: "16px 20px",
  borderRadius: "10px",
  marginBottom: "24px",
};

const suggestionTitle = {
  fontSize: "14px",
  fontWeight: "700" as const,
  color: "#0c4a6e",
  margin: "0 0 8px",
};

const suggestionItem = {
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
