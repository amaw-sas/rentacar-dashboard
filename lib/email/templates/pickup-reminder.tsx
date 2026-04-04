import { Section, Text, Heading, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface PickupReminderEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  customerName: string;
  reserveCode: string;
  pickupDate: string;
  pickupHour: string;
  pickupLocation: string;
  pickupAddress?: string;
}

export function PickupReminderEmail(props: PickupReminderEmailProps) {
  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
    >
      <Section style={badgeContainer}>
        <Text style={badge}>RECORDATORIO</Text>
      </Section>

      <Heading as="h1" style={heading}>
        Recordatorio de tu Reserva
      </Heading>

      <Text style={intro}>
        Hola {props.customerName}, te recordamos que tienes una reserva
        programada. A continuaci&oacute;n los detalles:
      </Text>

      <Section style={detailsBox}>
        <Text style={detailRow}>
          <strong>C&oacute;digo de reserva:</strong> {props.reserveCode}
        </Text>
        <Text style={detailRow}>
          <strong>Fecha de recogida:</strong> {props.pickupDate}
        </Text>
        <Text style={detailRow}>
          <strong>Hora de recogida:</strong> {props.pickupHour}
        </Text>
        <Text style={detailRow}>
          <strong>Lugar de recogida:</strong> {props.pickupLocation}
        </Text>
        {props.pickupAddress && (
          <Text style={detailRow}>
            <strong>Direcci&oacute;n:</strong> {props.pickupAddress}
          </Text>
        )}
      </Section>

      <Hr style={divider} />

      <Text style={sectionTitle}>Recuerda llevar</Text>
      <Text style={requirement}>&#8226; Tarjeta de cr&eacute;dito a nombre del titular</Text>
      <Text style={requirement}>&#8226; Documento de identidad vigente</Text>
      <Text style={requirement}>&#8226; Licencia de conducci&oacute;n vigente</Text>

      <Hr style={divider} />

      <Section style={paymentNote}>
        <Text style={paymentNoteText}>
          El pago se realiza &uacute;nicamente con tarjeta de cr&eacute;dito al momento de la
          recogida del veh&iacute;culo.
        </Text>
      </Section>
    </EmailLayout>
  );
}

const badgeContainer = {
  textAlign: "center" as const,
  marginBottom: "8px",
};

const badge = {
  display: "inline-block" as const,
  backgroundColor: "#dbeafe",
  color: "#1e40af",
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
  marginBottom: "24px",
};

const detailsBox = {
  backgroundColor: "#f4f4f5",
  padding: "16px 20px",
  borderRadius: "8px",
};

const detailRow = {
  fontSize: "14px",
  color: "#18181b",
  margin: "6px 0",
  lineHeight: "1.5",
};

const sectionTitle = {
  fontSize: "16px",
  fontWeight: "bold" as const,
  color: "#18181b",
  marginBottom: "12px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "24px 0",
};

const requirement = {
  fontSize: "13px",
  color: "#3f3f46",
  margin: "4px 0",
  paddingLeft: "8px",
};

const paymentNote = {
  backgroundColor: "#fef3c7",
  padding: "12px 16px",
  borderRadius: "8px",
};

const paymentNoteText = {
  fontSize: "13px",
  color: "#92400e",
  margin: "0",
};
