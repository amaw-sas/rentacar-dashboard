import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Link,
  Img,
} from "@react-email/components";
import type { ReactNode } from "react";

interface EmailLayoutProps {
  franchiseName: string;
  franchiseColor: string;
  franchiseWebsite: string;
  franchisePhone: string;
  franchiseLogo?: string;
  children: ReactNode;
}

export function EmailLayout({
  franchiseName,
  franchiseColor,
  franchiseWebsite,
  franchisePhone,
  franchiseLogo,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="es">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={{ ...header, backgroundColor: franchiseColor }}>
            {franchiseLogo ? (
              <Img
                src={franchiseLogo}
                alt={franchiseName}
                height="50"
                style={{ margin: "0 auto" }}
              />
            ) : (
              <Text style={headerTitle}>{franchiseName}</Text>
            )}
          </Section>

          <Section style={content}>{children}</Section>

          <Hr style={divider} />

          <Section style={footer}>
            {franchiseLogo && (
              <Img
                src={franchiseLogo}
                alt={franchiseName}
                height="30"
                style={{ margin: "0 auto 12px" }}
              />
            )}
            <Text style={footerText}>
              <Link href={franchiseWebsite} style={{ color: franchiseColor }}>
                {franchiseWebsite}
              </Link>
            </Text>
            <Text style={footerText}>Tel: {franchisePhone}</Text>
            <Text style={footerText}>
              &copy; {new Date().getFullYear()} {franchiseName}. Todos los
              derechos reservados.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const body = {
  backgroundColor: "#f4f4f5",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  margin: "0",
  padding: "0",
};

const container = {
  maxWidth: "600px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
};

const header = {
  padding: "24px",
  textAlign: "center" as const,
};

const headerTitle = {
  color: "#ffffff",
  fontSize: "24px",
  fontWeight: "bold" as const,
  margin: "0",
};

const content = {
  padding: "32px 24px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "0",
};

const footer = {
  padding: "24px",
  textAlign: "center" as const,
};

const footerText = {
  color: "#71717a",
  fontSize: "12px",
  margin: "4px 0",
};
