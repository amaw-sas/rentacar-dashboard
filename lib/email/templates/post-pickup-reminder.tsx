import { Section, Text, Heading, Hr } from "@react-email/components";
import { EmailLayout } from "./components/email-layout";

interface PostPickupReminderEmailProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  customerName: string;
}

export function PostPickupReminderEmail(props: PostPickupReminderEmailProps) {
  return (
    <EmailLayout
      franchiseName={props.franchiseName}
      franchiseColor={props.franchiseColor}
      franchiseWebsite={props.franchiseWebsite}
      franchisePhone={props.franchisePhone}
    >
      <Heading as="h1" style={heading}>
        &iquest;C&oacute;mo va tu experiencia?
      </Heading>

      <Text style={intro}>
        Hola {props.customerName}, esperamos que est&eacute;s disfrutando de tu
        veh&iacute;culo. Queremos asegurarnos de que todo est&eacute; en orden.
      </Text>

      <Hr style={divider} />

      <Section style={infoBox}>
        <Text style={infoText}>
          Si tienes alguna pregunta o necesitas asistencia durante tu alquiler,
          no dudes en contactarnos al{" "}
          <strong>{props.franchisePhone}</strong>.
        </Text>
      </Section>

      <Text style={closing}>
        Gracias por confiar en {props.franchiseName}. &iexcl;Te deseamos un
        excelente viaje!
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

const intro = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  marginBottom: "24px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "24px 0",
};

const infoBox = {
  backgroundColor: "#f0fdf4",
  padding: "16px 20px",
  borderRadius: "8px",
};

const infoText = {
  fontSize: "14px",
  color: "#166534",
  margin: "0",
  lineHeight: "1.6",
};

const closing = {
  fontSize: "14px",
  color: "#3f3f46",
  lineHeight: "1.6",
  marginTop: "24px",
};
