import { Section, Text, Row, Column } from "@react-email/components";

interface ReservationDetailsProps {
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
}

export function ReservationDetails({
  customerName,
  categoryName,
  pickupLocation,
  pickupDate,
  pickupHour,
  returnLocation,
  returnDate,
  returnHour,
  selectedDays,
  reserveCode,
}: ReservationDetailsProps) {
  return (
    <Section>
      <Text style={sectionTitle}>Detalles de la Reserva</Text>

      <Section style={table}>
        {reserveCode && (
          <Row style={tableRow}>
            <Column style={labelCell}>Código de Reserva</Column>
            <Column style={valueCell}>
              <Text style={codeText}>{reserveCode}</Text>
            </Column>
          </Row>
        )}
        <Row style={tableRow}>
          <Column style={labelCell}>Cliente</Column>
          <Column style={valueCell}>{customerName}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Categoría</Column>
          <Column style={valueCell}>{categoryName}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Lugar de Recogida</Column>
          <Column style={valueCell}>{pickupLocation}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Fecha de Recogida</Column>
          <Column style={valueCell}>
            {pickupDate} - {pickupHour}
          </Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Lugar de Devolución</Column>
          <Column style={valueCell}>{returnLocation}</Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Fecha de Devolución</Column>
          <Column style={valueCell}>
            {returnDate} - {returnHour}
          </Column>
        </Row>
        <Row style={tableRow}>
          <Column style={labelCell}>Días</Column>
          <Column style={valueCell}>{selectedDays}</Column>
        </Row>
      </Section>
    </Section>
  );
}

const sectionTitle = {
  fontSize: "16px",
  fontWeight: "bold" as const,
  color: "#18181b",
  marginBottom: "12px",
};

const table = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const tableRow = {
  borderBottom: "1px solid #e4e4e7",
};

const labelCell = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#71717a",
  width: "40%",
  verticalAlign: "top" as const,
};

const valueCell = {
  padding: "8px 12px",
  fontSize: "13px",
  color: "#18181b",
  fontWeight: "500" as const,
};

const codeText = {
  fontSize: "16px",
  fontWeight: "bold" as const,
  color: "#18181b",
  margin: "0",
};
