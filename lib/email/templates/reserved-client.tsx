import { Section, Text, Heading, Hr, Row, Column } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";
import { ReservationDetails } from "./components/reservation-details";

const formatCOP = (value: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    minimumFractionDigits: 0,
  }).format(value);

interface ReservedClientEmailProps {
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
  reserveCode: string;
  totalPrice: number;
  taxFee: number;
  ivaFee: number;
  totalPriceToPay: number;
  totalInsurance: number;
  extraDriver: boolean;
  babySeat: boolean;
  wash: boolean;
}

export function ReservedClientEmail(props: ReservedClientEmailProps) {
  const extras: string[] = [];
  if (props.totalInsurance > 0) extras.push(`Seguro Total: ${formatCOP(props.totalInsurance)}`);
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
      <Section style={badgeContainer}>
        <Text style={badge}>CONFIRMADA</Text>
      </Section>

      <Heading as="h1" style={heading}>
        Reserva Aprobada
      </Heading>

      <Text style={intro}>
        Tu reserva ha sido confirmada exitosamente. A continuación encontrarás
        los detalles de tu reserva.
      </Text>

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

      <Text style={sectionTitle}>Resumen de Precios</Text>

      <Section style={priceTable}>
        <Row style={priceRow}>
          <Column style={priceLabel}>Tarifa Base</Column>
          <Column style={priceValue}>{formatCOP(props.totalPrice)}</Column>
        </Row>
        <Row style={priceRow}>
          <Column style={priceLabel}>Impuesto</Column>
          <Column style={priceValue}>{formatCOP(props.taxFee)}</Column>
        </Row>
        <Row style={priceRow}>
          <Column style={priceLabel}>IVA</Column>
          <Column style={priceValue}>{formatCOP(props.ivaFee)}</Column>
        </Row>
        <Row style={totalRow}>
          <Column style={totalLabel}>Total a Pagar</Column>
          <Column style={totalValue}>{formatCOP(props.totalPriceToPay)}</Column>
        </Row>
      </Section>

      {extras.length > 0 && (
        <>
          <Hr style={divider} />
          <Text style={sectionTitle}>Extras Seleccionados</Text>
          {extras.map((extra) => (
            <Text key={extra} style={extraItem}>
              • {extra}
            </Text>
          ))}
        </>
      )}

      <Hr style={divider} />

      <Text style={sectionTitle}>Requisitos para la Recogida</Text>
      <Text style={requirement}>• Tarjeta de crédito a nombre del titular</Text>
      <Text style={requirement}>• Documento de identidad vigente</Text>
      <Text style={requirement}>• Licencia de conducción vigente</Text>

      <Hr style={divider} />

      <Section style={paymentNote}>
        <Text style={paymentNoteText}>
          El pago se realiza únicamente con tarjeta de crédito al momento de la
          recogida del vehículo.
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
  backgroundColor: "#dcfce7",
  color: "#166534",
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

const priceTable = {
  width: "100%",
};

const priceRow = {
  borderBottom: "1px solid #f4f4f5",
};

const priceLabel = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#71717a",
};

const priceValue = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#18181b",
  textAlign: "right" as const,
};

const totalRow = {
  backgroundColor: "#f4f4f5",
};

const totalLabel = {
  padding: "10px 12px",
  fontSize: "14px",
  fontWeight: "bold" as const,
  color: "#18181b",
};

const totalValue = {
  padding: "10px 12px",
  fontSize: "14px",
  fontWeight: "bold" as const,
  color: "#18181b",
  textAlign: "right" as const,
};

const extraItem = {
  fontSize: "13px",
  color: "#3f3f46",
  margin: "4px 0",
  paddingLeft: "8px",
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
