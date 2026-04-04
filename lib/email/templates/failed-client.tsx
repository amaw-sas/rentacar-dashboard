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
        Reserva Sin Disponibilidad
      </Heading>

      <Text style={intro}>
        Hola {props.customerName}, lamentamos informarte que la categoría{" "}
        <strong>{props.categoryName}</strong> no se encuentra disponible para las
        fechas y ubicación seleccionadas.
      </Text>

      <Section style={detailBox}>
        <Text style={detailText}>
          Fechas: {props.pickupDate} - {props.returnDate}
        </Text>
        <Text style={detailText}>Ubicación: {props.pickupLocation}</Text>
      </Section>

      <Text style={suggestion}>
        Te invitamos a realizar una nueva búsqueda con fechas o categorías
        alternativas. Si necesitas asistencia, no dudes en contactarnos.
      </Text>
    </EmailLayout>
  );
}

const badgeContainer = {
  textAlign: "center" as const,
  marginBottom: "8px",
};

const badge = {
  display: "inline-block" as const,
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontSize: "12px",
  fontWeight: "bold" as const,
  padding: "4px 12px",
  borderRadius: "9999px",
  textTransform: "uppercase" as const,
  margin: "0",
};

const heading = {
  fontSize: "22px",
  fontWeight: "bold" as const,
  color: "#18181b",
  textAlign: "center" as const,
  margin: "0 0 16px",
};

const intro = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  marginBottom: "16px",
};

const detailBox = {
  backgroundColor: "#f4f4f5",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
};

const detailText = {
  fontSize: "13px",
  color: "#3f3f46",
  margin: "4px 0",
};

const suggestion = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
};
