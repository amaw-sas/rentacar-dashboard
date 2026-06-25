-- Fix the seguro básico description in the chat knowledge base. The 070 seed
-- framed the $3.570.000 figure backwards ("cubre todo excepto daños > $3.570.000"),
-- which made the bot tell customers the basic insurance covers small damages and
-- not large ones. It is the opposite: $3.570.000 is a DEDUCTIBLE — the renter
-- absorbs up to that amount per claim and the insurance covers the excess.
--
-- Targeted replace() on the two wrong substrings only: it does not overwrite other
-- edits made via /chat-knowledge, and it is idempotent (a no-op once the text is
-- already corrected, e.g. fixed by hand in the dashboard).
update public.chat_knowledge
set content = replace(
      replace(
        content,
        $old1$| **Básico** | Incluido | Cubre prácticamente todo **excepto daños > $3.570.000 COP**. |$old1$,
        $new1$| **Básico** | Incluido | Deducible de **$3.570.000 COP**: el cliente asume hasta ese monto por daños y el seguro cubre el excedente. Daño menor a $3.570.000 → lo paga el cliente completo; daño mayor → el cliente paga $3.570.000 y el seguro cubre el resto. |$new1$
      ),
      $old2$- **¿Qué cubre el seguro?** → "Seguro básico incluido que cubre casi todo, excepto daños superiores a $3.570.000. Todo riesgo opcional en sede."$old2$,
      $new2$- **¿Qué cubre el seguro?** → "El alquiler ya incluye seguro básico, con un deducible de $3.570.000: tú asumes hasta ese monto por daños y el seguro cubre el excedente (si el daño es menor a $3.570.000 lo pagas tú; si es mayor, pagas $3.570.000 y el seguro cubre el resto). El seguro total es opcional, se toma en sede con costo adicional y reduce ese deducible."$new2$
    ),
    updated_at = now()
where scope = 'shared';
