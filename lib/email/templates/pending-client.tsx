import { Section, Text, Heading, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { ReservationDetails } from "./components/reservation-details";

interface PendingClientEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
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
}

export function PendingClientEmail(props: PendingClientEmailProps) {
  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseLogo={props.franchiseLogo}
    >
      <Section style={badgeContainer}>
        <Text style={badge}>PENDIENTE</Text>
      </Section>

      <Heading as="h1" style={heading}>
        Reserva Pendiente
      </Heading>

      <Text style={intro}>
        Tu solicitud de reserva está en proceso de verificación. Recibirás una
        confirmación por correo electrónico una vez que sea aprobada.
      </Text>

      <Section style={infoBox}>
        <Text style={infoText}>
          Tiempo promedio de respuesta: ~5 horas
        </Text>
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

const badgeContainer = {
  textAlign: "center" as const,
  marginBottom: "8px",
};

const badge = {
  display: "inline-block" as const,
  backgroundColor: "#fef3c7",
  color: "#92400e",
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

const infoBox = {
  backgroundColor: "#eff6ff",
  padding: "12px 16px",
  borderRadius: "8px",
};

const infoText = {
  fontSize: "13px",
  color: "#1e40af",
  margin: "0",
  textAlign: "center" as const,
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "24px 0",
};
