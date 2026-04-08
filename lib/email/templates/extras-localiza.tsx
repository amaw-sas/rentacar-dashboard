import { Section, Text, Heading } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface ExtrasLocalizaEmailProps {
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
  reserveCode?: string | null;
  extraDriver: boolean;
  babySeat: boolean;
  wash: boolean;
}

export function ExtrasLocalizaEmail(props: ExtrasLocalizaEmailProps) {
  const extras = [];
  if (props.extraDriver) extras.push("Conductor adicional");
  if (props.babySeat) extras.push("Silla de bebé");
  if (props.wash) extras.push("Servicio de lavado");

  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseWhatsapp={props.franchiseWhatsapp}
      franchiseLogo={props.franchiseLogo}
    >
      <Text style={greeting}>Cordial saludo, Señores Localiza</Text>

      <Text style={body}>
        Les informamos que la siguiente reserva requiere servicios adicionales:
      </Text>

      {props.reserveCode && (
        <Heading as="h2" style={codeHeading}>
          Código de Reserva: {props.reserveCode}
        </Heading>
      )}

      <Section style={detailBox}>
        <Text style={detailText}>Cliente: {props.customerName}</Text>
        <Text style={detailText}>Categoría: {props.categoryName}</Text>
        <Text style={detailText}>
          Recogida: {props.pickupLocation} — {props.pickupDate} {props.pickupHour}
        </Text>
        <Text style={detailText}>
          Devolución: {props.returnLocation} — {props.returnDate} {props.returnHour}
        </Text>
        <Text style={detailText}>Días: {props.selectedDays}</Text>
      </Section>

      <Section style={extrasBox}>
        <Text style={extrasTitle}>Servicios adicionales solicitados:</Text>
        {extras.map((extra, i) => (
          <Text key={i} style={extraItem}>
            • {extra}
          </Text>
        ))}
      </Section>

      <Text style={closing}>
        Agradecemos su atención y pronta respuesta.
      </Text>
    </EmailLayout>
  );
}

const greeting = {
  fontSize: "15px",
  color: "#18181b",
  lineHeight: "1.6",
  marginBottom: "8px",
};

const body = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  marginBottom: "16px",
};

const codeHeading = {
  fontSize: "18px",
  fontWeight: "700" as const,
  color: "#18181b",
  textAlign: "center" as const,
  margin: "0 0 16px",
};

const detailBox = {
  backgroundColor: "#fafafa",
  border: "1px solid #e4e4e7",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
};

const detailText = {
  fontSize: "13px",
  color: "#3f3f46",
  margin: "4px 0",
};

const extrasBox = {
  backgroundColor: "#fffbeb",
  border: "1px solid #fde68a",
  padding: "12px 16px",
  borderRadius: "8px",
  marginBottom: "16px",
};

const extrasTitle = {
  fontSize: "14px",
  fontWeight: "700" as const,
  color: "#92400e",
  margin: "0 0 8px",
};

const extraItem = {
  fontSize: "14px",
  color: "#b45309",
  margin: "2px 0",
};

const closing = {
  fontSize: "14px",
  color: "#71717a",
  lineHeight: "1.6",
};
