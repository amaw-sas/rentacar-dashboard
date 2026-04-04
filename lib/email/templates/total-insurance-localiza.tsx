import { Section, Text, Heading, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { ReservationDetails } from "./components/reservation-details";

interface TotalInsuranceLocalizaEmailProps {
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
  reserveCode?: string | null;
  extraDriver: boolean;
  babySeat: boolean;
  wash: boolean;
}

export function TotalInsuranceLocalizaEmail(props: TotalInsuranceLocalizaEmailProps) {
  const extras: string[] = [];
  if (props.extraDriver) extras.push("Conductor Adicional");
  if (props.babySeat) extras.push("Silla de Bebé");
  if (props.wash) extras.push("Lavado");

  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
      franchiseLogo={props.franchiseLogo}
    >
      <Heading as="h1" style={heading}>
        Notificación de Reserva con Seguro Total
      </Heading>

      <Text style={greeting}>Cordial saludo, Señores Localiza.</Text>

      <Text style={body}>
        Se ha registrado una reserva en la cual el cliente requiere{" "}
        <strong>seguro total</strong>.
      </Text>

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
        reserveCode={props.reserveCode}
      />

      <Hr style={divider} />

      <Section style={insuranceBox}>
        <Text style={insuranceText}>
          El cliente requiere <strong>seguro total</strong> para esta reserva.
        </Text>
      </Section>

      {extras.length > 0 && (
        <>
          <Hr style={divider} />
          <Text style={sectionTitle}>Otros Extras Solicitados</Text>
          {extras.map((extra) => (
            <Text key={extra} style={extraItem}>
              • {extra}
            </Text>
          ))}
        </>
      )}

      <Hr style={divider} />

      <Text style={closing}>
        Quedamos atentos a su confirmación.
      </Text>
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

const greeting = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
};

const body = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  marginBottom: "8px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "24px 0",
};

const insuranceBox = {
  backgroundColor: "#fef3c7",
  padding: "12px 16px",
  borderRadius: "8px",
};

const insuranceText = {
  fontSize: "14px",
  color: "#92400e",
  margin: "0",
  textAlign: "center" as const,
};

const sectionTitle = {
  fontSize: "16px",
  fontWeight: "bold" as const,
  color: "#18181b",
  marginBottom: "12px",
};

const extraItem = {
  fontSize: "13px",
  color: "#3f3f46",
  margin: "4px 0",
  paddingLeft: "8px",
};

const closing = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  fontStyle: "italic" as const,
};
