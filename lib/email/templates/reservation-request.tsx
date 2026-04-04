import { Section, Text, Heading, Hr, Row, Column } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { ReservationDetails } from "./components/reservation-details";

interface ReservationRequestEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  franchiseLogo?: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  categoryName: string;
  pickupLocation: string;
  pickupDate: string;
  pickupHour: string;
  returnLocation: string;
  returnDate: string;
  returnHour: string;
  selectedDays: number;
}

export function ReservationRequestEmail(props: ReservationRequestEmailProps) {
  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseLogo={props.franchiseLogo}
    >
      <Heading as="h1" style={heading}>
        Solicitud de Reserva en Proceso
      </Heading>

      <Text style={intro}>
        Hola {props.customerName}, hemos recibido tu solicitud de reserva.
        Estamos procesando tu petición.
      </Text>

      <Section style={infoBox}>
        <Text style={infoText}>
          Recibirás un <strong>CÓDIGO DE RESERVA</strong> por correo electrónico
          una vez confirmada tu reserva.
        </Text>
      </Section>

      <Hr style={divider} />

      <Text style={sectionTitle}>Datos del Cliente</Text>
      <Section style={clientTable}>
        <Row style={tableRow}>
          <Column style={labelCell}>Nombre</Column>
          <Column style={valueCell}>{props.customerName}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Email</Column>
          <Column style={valueCell}>{props.customerEmail}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Teléfono</Column>
          <Column style={valueCell}>{props.customerPhone}</Column>
        </Row>
      </Section>

      <Hr style={divider} />

      <ReservationDetails
        customerName={props.customerName}
        categoryName={props.categoryName}
        pickupLocation={props.pickupLocation}
        pickupDate={props.pickupDate}
        pickupHour={props.pickupHour}
        returnLocation={props.returnLocation}
        returnDate={props.returnDate}
        returnHour={props.returnHour}
        selectedDays={props.selectedDays}
      />
    </EmailLayout>
  );
}

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

const infoBox = {
  backgroundColor: "#eff6ff",
  padding: "16px",
  borderRadius: "8px",
  textAlign: "center" as const,
};

const infoText = {
  fontSize: "14px",
  color: "#1e40af",
  margin: "0",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "24px 0",
};

const sectionTitle = {
  fontSize: "16px",
  fontWeight: "bold" as const,
  color: "#18181b",
  marginBottom: "12px",
};

const clientTable = {
  width: "100%",
};

const tableRow = {
  borderBottom: "1px solid #e4e4e7",
};

const labelCell = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#71717a",
  width: "30%",
};

const valueCell = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#18181b",
  fontWeight: "500" as const,
};
