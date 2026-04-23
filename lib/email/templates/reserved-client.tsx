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
  extraDriverDayPrice: number;
  washPrice: number;
  washOnsitePrice: number;
  washDeepPrice: number;
  washDeepUpholsteryPrice: number;
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

      <Text style={sectionTitle}>Antes de recoger el vehículo</Text>
      <Text style={paragraph}>
        Preséntese en el lugar de recogida 30 minutos antes de la hora
        programada con los siguientes documentos:
      </Text>
      <Text style={requirement}>
        <strong>1. Tarjeta de Crédito.</strong> Sólo se reciben pagos con
        tarjetas de crédito físicas, NO se aceptan pagos en efectivo ni otros
        medios de pago.
      </Text>
      <Text style={requirement}>
        <strong>2. Cédula o Pasaporte.</strong>
      </Text>
      <Text style={requirement}>
        <strong>3. Licencia de Conducción.</strong> La licencia determina el
        documento de identificación a presentar: si tiene una licencia de
        conducción colombiana debe presentar su cédula colombiana (no se acepta
        pasaporte). Si tiene una licencia extranjera debe presentar su
        pasaporte, incluso si es colombiano residente en el exterior.
      </Text>
      <Text style={paragraph}>
        Verifique el cupo y la fecha de vencimiento de su tarjeta de crédito y
        la fecha de vencimiento de su licencia de conducción.
      </Text>

      <Hr style={divider} />

      <Text style={sectionTitle}>Conductor adicional</Text>
      <Text style={paragraph}>
        Si el vehículo será conducido por otra(s) persona(s) diferente(s) al
        titular del contrato, se debe cancelar en la agencia un cargo adicional
        de {formatCOP(props.extraDriverDayPrice)} pesos diarios por su seguro ya
        que se hace responsable del vehículo. Los conductores adicionales y el
        titular de la tarjeta de crédito deben estar presentes para la firma de
        contratos.
      </Text>

      <Hr style={divider} />

      <Text style={sectionTitle}>Durante la recogida del vehículo</Text>
      <Text style={requirement}>
        • Elija el vehículo de su agrado según disponibilidad y gama
        seleccionada (tenga en cuenta las restricciones de movilidad de las
        zonas a transitar).
      </Text>
      <Text style={requirement}>
        • Verifique que el vehículo esté limpio y con el tanque lleno.
      </Text>
      <Text style={requirement}>
        • Realice un registro fotográfico del vehículo si lo considera
        necesario.
      </Text>
      <Text style={requirement}>
        • Puede adquirir o rechazar servicios adicionales según su necesidad
        como son: seguro total, seguro de conductor adicional, entrega en otras
        sedes, lavada prepagada, silla de bebé y GPS (los 2 últimos bajo
        disponibilidad de la agencia).
      </Text>

      <Hr style={divider} />

      <Text style={sectionTitle}>Durante el periodo de renta</Text>
      <Text style={requirement}>
        • En caso de emergencia o asistencia en carretera comuníquese de
        inmediato con las líneas de atención, las 24 horas del día, los 365 días
        del año.
      </Text>
      <Text style={requirement}>
        <strong>Línea de atención AUTOSEGURO las 24 horas / 4-4442001
        Asistencia #570</strong>
      </Text>
      <Text style={requirement}>
        • Evite multas, tenga en cuenta las restricciones de movilidad
        "pico y placa" de las diferentes ciudades por donde transite.
      </Text>
      <Text style={requirement}>
        • Puede recorrer todo el país. Si adquirió una mensualidad tenga en
        cuenta los kilómetros contratados para evitar sobrecostos.
      </Text>
      <Text style={requirement}>
        • No puede ser usado para trabajos en aplicaciones de movilidad como
        Uber, Cabify o similares.
      </Text>
      <Text style={requirement}>• El vehículo no puede salir del país.</Text>

      <Hr style={divider} />

      <Text style={sectionTitle}>Antes de retornar el vehículo</Text>
      <Text style={requirement}>
        • Verifique que el tanque esté lleno y el vehículo limpio para evitar
        costos adicionales.
      </Text>
      <Text style={requirement}>
        • Verifique el interior del vehículo y no olvide sus artículos
        personales.
      </Text>

      <Hr style={divider} />

      <Text style={sectionTitle}>Lavado de vehículo</Text>
      <Text style={paragraph}>
        El vehículo debe entregarse en las mismas condiciones de limpieza en
        que lo recibió. Contamos con el servicio de lavado al momento de hacer
        su reserva, el costo será de {formatCOP(props.washPrice)} IVA incluido.
        Si, por el contrario, solicita el servicio al momento de devolver el
        vehículo en la agencia, el valor a pagar será de{" "}
        {formatCOP(props.washOnsitePrice)} IVA incluido.
      </Text>
      <Text style={paragraph}>
        Se aplicarán cobros adicionales en los siguientes casos: si transportó
        mascotas en el vehículo, si el vehículo regresa con olor fuerte a
        cigarrillo o alcohol, o si condujo en condiciones adversas y se
        evidencia exceso de barro. En estos casos, el servicio de lavado tendrá
        un costo de:
      </Text>
      <Text style={requirement}>
        • Lavado completo con aspirado: {formatCOP(props.washDeepPrice)} IVA
        incluido.
      </Text>
      <Text style={requirement}>
        • Lavado completo con aspirado y tapicería:{" "}
        {formatCOP(props.washDeepUpholsteryPrice)} IVA incluido.
      </Text>

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

const paragraph = {
  fontSize: "13px",
  color: "#3f3f46",
  lineHeight: "1.6",
  margin: "0 0 12px",
};

const requirement = {
  fontSize: "13px",
  color: "#3f3f46",
  lineHeight: "1.6",
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
