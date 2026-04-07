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
  franchiseWhatsapp?: string;
  franchiseLogo?: string;
  children: ReactNode;
}

export function EmailLayout({
  franchiseName,
  franchiseColor,
  franchiseWebsite,
  franchisePhone,
  franchiseWhatsapp,
  franchiseLogo,
  children,
}: EmailLayoutProps) {
  const whatsappUrl = franchiseWhatsapp
    ? `https://wa.me/${franchiseWhatsapp.replace(/[^0-9]/g, "")}`
    : null;

  return (
    <Html lang="es">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section
            style={{
              height: "6px",
              backgroundColor: franchiseColor,
            }}
          />

          <Section style={header}>
            {franchiseLogo ? (
              <Img
                src={franchiseLogo}
                alt={franchiseName}
                height="44"
                style={{ margin: "0 auto", display: "block" }}
              />
            ) : (
              <Text style={{ ...headerTitle, color: franchiseColor }}>
                {franchiseName}
              </Text>
            )}
          </Section>

          <Section
            style={{
              height: "1px",
              backgroundColor: "#e4e4e7",
            }}
          />

          <Section style={content}>{children}</Section>

          <Section style={footerSection}>
            <Hr style={divider} />

            {franchiseLogo && (
              <Img
                src={franchiseLogo}
                alt={franchiseName}
                height="28"
                style={{
                  margin: "0 auto 16px",
                  display: "block",
                  opacity: 0.7,
                }}
              />
            )}

            <Text style={footerBrand}>
              <Link
                href={franchiseWebsite}
                style={{
                  color: franchiseColor,
                  textDecoration: "none",
                  fontWeight: 600,
                }}
              >
                {franchiseWebsite.replace(/^https?:\/\//, "")}
              </Link>
            </Text>

            {(franchisePhone || whatsappUrl) && (
              <Text style={footerContact}>
                {franchisePhone && (
                  <Link href={`tel:${franchisePhone}`} style={footerLink}>
                    {"\u260E\uFE0F"} {franchisePhone}
                  </Link>
                )}
                {franchisePhone && whatsappUrl && (
                  <span style={{ margin: "0 8px", color: "#d4d4d8" }}>|</span>
                )}
                {whatsappUrl && (
                  <Link href={whatsappUrl} style={footerLink}>
                    {"\uD83D\uDCF2"} WhatsApp
                  </Link>
                )}
              </Text>
            )}

            <Text style={footerCopy}>
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
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  margin: "0",
  padding: "40px 0",
};

const container = {
  maxWidth: "560px",
  margin: "0 auto",
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  overflow: "hidden" as const,
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.08)",
};

const header = {
  padding: "28px 24px",
  textAlign: "center" as const,
};

const headerTitle = {
  fontSize: "22px",
  fontWeight: "700" as const,
  margin: "0",
  letterSpacing: "-0.3px",
};

const content = {
  padding: "32px 32px 24px",
};

const footerSection = {
  padding: "0 32px 28px",
};

const divider = {
  borderColor: "#e4e4e7",
  margin: "0 0 24px",
};

const footerBrand = {
  fontSize: "13px",
  margin: "0 0 8px",
  textAlign: "center" as const,
};

const footerContact = {
  fontSize: "13px",
  margin: "0 0 4px",
  textAlign: "center" as const,
};

const footerLink = {
  color: "#52525b",
  textDecoration: "none" as const,
};

const footerCopy = {
  color: "#a1a1aa",
  fontSize: "11px",
  margin: "12px 0 0",
  textAlign: "center" as const,
};
