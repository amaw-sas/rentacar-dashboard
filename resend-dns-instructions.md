# Registros DNS para Resend — alquilame.co

Hola,

Para terminar la migración de correos transaccionales de Alquílame a Resend, necesitamos agregar 3 registros DNS al dominio `alquilame.co`. El DNS está hospedado en HostGator (NS `ns1517/ns1518.websitewelcome.com`), así que los registros se cargan desde **cPanel → Zone Editor**.

Los 3 registros van bajo el subdominio `mail`. La operación normal del correo apex (`info@alquilame.co`) y la web no se tocan: estos registros viven en otro subdominio.

---

## Los 3 registros

| # | Tipo | Nombre | Valor | Prioridad | TTL |
|---|---|---|---|---|---|
| 1 | TXT | `send.mail` | `v=spf1 include:amazonses.com ~all` | — | 1 hora |
| 2 | MX  | `send.mail` | `feedback-smtp.sa-east-1.amazonses.com` | 10 | 1 hora |
| 3 | TXT | `resend._domainkey.mail` | (ver abajo) | — | 1 hora |

Valor del DKIM (#3) — pegar exactamente esto, en **una sola línea, sin espacios ni saltos**:

```
p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC1+ANqFtoCAAZB+WyTVFqsT5GKh5bv6kEAXEzecr3BTvfT0BH458gMny2V3ss03vfPJponZK09zleOiZkFrpQ4XFh2F20oEMxMFBUC4/hOhiwKB8VCcQYn+Lqqyd05CDi94cE7AMUhrtujuurOPMy7ZnJbcEbNzT1tYYJrRSWvawIDAQAB
```

Tip importante: si al pegar en cPanel se rompe en varias líneas o aparecen espacios, pegarlo primero en el Bloc de notas (texto plano) y desde ahí al panel. Cualquier espacio incrustado invalida la firma DKIM y Resend rechaza el dominio.

---

## Notas

- Los registros 1 y 2 viven en el mismo subdominio (`send.mail.alquilame.co`); cPanel los acepta sin conflicto porque son tipos distintos (TXT y MX).
- No hay que modificar el SPF apex actual (`v=spf1 a mx include:websitewelcome.com ~all`) — sigue manejando el correo de HostGator.
- No hay que modificar el MX apex (`mail.alquilame.co`) — el inbox `info@alquilame.co` sigue funcionando igual.

---

Cuando los 3 registros estén cargados, avísenme y verifico la propagación antes de darle "Verify" en Resend.

Gracias.
