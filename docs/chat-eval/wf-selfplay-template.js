export const meta = {
  name: 'chat-selfplay-analysis',
  description: 'Clean self-play eval: 30 future-dated personas → true close-rate among ready buyers + pattern frequencies + Controller verdict',
  phases: [{ title: 'Analyze' }, { title: 'Synthesize' }],
};

const convs = __CONVS__;

const PATTERN_TAGS = [
  'no_close_on_buy_signal',
  'gama_not_committed',
  'hard_gate_no_recovery',
  're_asks_given_slot',
  'stateless_repeat_answer',
  'model_gama_mismatch',
  'raw_error_leak',
  'premature_requisitos_dump',
  'internal_codes_exposed',
  'repeated_question_verbatim',
  'wrong_or_invented_info',
  'other_failure',
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'outcome', 'patternsPresent', 'reachedBooking', 'notes'],
  properties: {
    id: { type: 'string' },
    outcome: { type: 'string', enum: ['booked', 'reached-data-collection', 'quoted-not-progressed', 'stuck-loop', 'abandoned-early', 'info-only', 'error-blocked', 'handed-to-advisor', 'other'] },
    reachedBooking: { type: 'boolean', description: 'Did the bot actually create a real reservation (a confirmation with a reservation number)?' },
    customerWasReadyToBook: { type: 'boolean', description: 'Did the customer give a clear buy signal (full data + resérvamelo)?' },
    botClosedOrProgressed: { type: 'boolean', description: 'When the customer was ready, did the bot reach the booking (or genuinely progress toward it)?' },
    patternsPresent: { type: 'array', items: { type: 'string', enum: PATTERN_TAGS } },
    notes: { type: 'string', description: 'One or two sentences: what happened and the dominant failure (or clean success).' },
  },
};

const SYNTH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sampleSize', 'closeRate', 'frequencies', 'topFailures', 'verdict', 'controllerJustified', 'recommendation'],
  properties: {
    sampleSize: { type: 'number' },
    closeRate: { type: 'string', description: 'Of the customers who were ready to book, how many did the bot actually close (count + %)? The core business number.' },
    frequencies: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['pattern', 'count', 'percent'],
        properties: { pattern: { type: 'string' }, count: { type: 'number' }, percent: { type: 'number' } },
      },
    },
    topFailures: { type: 'string', description: 'The specific conversations that failed to close a ready buyer, and the concrete reason for each.' },
    verdict: { type: 'string', description: 'Given CLEAN data with real buy signals, is the bot systemically failing to close, or mostly working with specific gaps?' },
    controllerJustified: { type: 'string', enum: ['yes-controller', 'no-cheap-fixes-suffice', 'cheap-first-then-reassess'] },
    recommendation: { type: 'string', description: 'Decisive next step grounded in the clean numbers.' },
  },
};

function analyzePrompt(c) {
  return [
    'You analyze ONE conversation between a SIMULATED customer and a car-rental chatbot (brand: ' + c.brand + ', Spanish, Colombia). This is a CLEAN self-play eval — the customer used genuinely FUTURE dates (July 2026), so there are NO replay/date artifacts: any "fecha ya pasó" / "no disponible" here WOULD be a real bug, not eval noise.',
    'Persona intent (ground truth): ' + c.profile + ' | designed buy-signal: ' + c.buySignal + '.',
    'The bot is a HYBRID orchestrator: code owns the funnel (greeting, requisitos, quote table, slot questions, choosing_gama→collecting_customer→confirming→booked, real booking via a reservation number). A narrow LLM does slot-extraction + short free-form replies.',
    '',
    'Transcript (C=customer, B=bot; [TABLA]/[FOTOS]/[BOTONES] = code UI):',
    c.transcript,
    '',
    'Return structured output: outcome; reachedBooking (did the bot produce a real reservation NUMBER?); whether the customer was ready to book and whether the bot closed/progressed; and patternsPresent = the failure tags that genuinely apply. Be strict — if the bot handled it well and booked, patternsPresent can be empty. If a ready buyer did NOT get booked, say WHY in notes.',
  ].join('\n');
}

phase('Analyze');
const analyses = (await parallel(
  convs.map((c) => () =>
    agent(analyzePrompt(c), { label: 'a:' + c.id.slice(0, 14), phase: 'Analyze', schema: ANALYSIS_SCHEMA }),
  ),
)).filter(Boolean);

phase('Synthesize');
const synthesis = await agent(
  [
    'You are evaluating a production car-rental chatbot on a CLEAN self-play sample of ' + analyses.length + ' future-dated personas (no date pollution, with DESIGNED buy signals so close-rate is finally measurable). Decide whether a costly re-architecture (a context-aware "Controller" that resolves references like "ese"/"el económico"/model names and commits the gama) is justified, or whether the bot mostly works.',
    '',
    'Per-conversation analyses: ' + JSON.stringify(analyses, null, 1),
    '',
    'Report: (1) closeRate = of customerWasReadyToBook, the % the bot actually closed (reachedBooking) — the core number; (2) frequency of EACH failure pattern (count + %); (3) topFailures = the ready buyers that did NOT close and the concrete reason each; (4) a verdict on whether the bot systemically fails or mostly works with specific gaps; (5) controllerJustified = yes-controller / no-cheap-fixes-suffice / cheap-first-then-reassess; (6) a decisive recommendation. Be honest and specific.',
  ].join('\n'),
  { label: 'synthesis', phase: 'Synthesize', schema: SYNTH_SCHEMA, effort: 'high' },
);

return { analyses, synthesis };
