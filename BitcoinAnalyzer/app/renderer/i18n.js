/**
 * Bilingual layer. English is the base language; Spanish is a translation.
 *
 * TWO KINDS OF TEXT, HANDLED DIFFERENTLY:
 *
 *   1. UI CHROME (buttons, headings, labels) — plain key/value lookup.
 *
 *   2. ANALYSIS TEXT — produced by the engine as full English sentences with
 *      numbers already baked in ("RSI at 80: the move is already extended").
 *      Those are translated with PATTERNS: a regex captures the numbers and a
 *      template rebuilds the sentence in Spanish.
 *
 * Why patterns instead of making the engine emit keys: the engine is the part
 * that has been backtested and validated. Rewriting it to emit translation
 * keys would touch every module that produces a reason string, for a purely
 * cosmetic gain. The pattern layer sits on top and cannot break the analysis.
 *
 * If a sentence has no pattern, it passes through in English untouched. That
 * is deliberate: showing the original is better than showing nothing, and it
 * makes gaps visible instead of hiding them.
 */

const UI = {
  en: {
    tagline: 'Educational market analysis',
    actions: 'Actions',
    analyze: 'Analyze today',
    refresh: 'Refresh market data',
    whales: 'Whale positioning',
    validation: 'How reliable is this?',
    settings: 'Settings',
    language: 'Idioma',
    capital: 'Capital (USDT)',
    feeProfile: 'Fee profile',
    makerEntry: 'Enter with limit order (maker)',
    notLoaded: 'not loaded yet',
    updated: 'updated',
    disclaimer: 'Educational tool. Not financial advice. It does not connect to any account and never places orders.',

    askAnalyze: "What's the read today?",
    askRefresh: 'Refresh data and analyze',
    askWhales: 'Where is the big money positioned?',
    askValidation: 'How reliable is this system?',

    welcomeTitle: '👋 Welcome',
    welcomeIntro: 'This tool reads Bitcoin market data from public Binance endpoints and builds a technical scenario with a stop loss and a take profit, explaining the reasoning behind it.',
    gettingStarted: 'Getting started',
    step1: 'Press <strong>Analyze today</strong> for the current read and, if the conditions are met, a suggested scenario.',
    step2: 'Set your <strong>capital</strong> on the left to see exactly how much you would gain at the target and lose at the stop, fees included.',
    step3: '<strong>Whale positioning</strong> shows where large traders sit versus retail.',
    step4: '<strong>How reliable is this?</strong> shows the backtest results, including what failed.',
    welcomeFoot: 'Educational and research tool. Not financial advice. It knows nothing about your situation, never connects to an account and never places an order. Every decision and every risk is yours.',

    marketRead: 'Market read',
    noClearTrend: 'no clear trend',
    why: 'Why',
    against: 'Evidence against this read',
    suggested: 'Suggested scenario',
    reference: 'reference',
    entry: 'Entry',
    stopLoss: 'Stop loss',
    takeProfit: 'Take profit',
    netRR: 'Net risk/reward',
    needsHitRate: 'needs a hit rate above',
    feesTake: 'Fees take',
    ofGross: 'of gross profit',
    withCapital: 'With {n} USDT, no leverage',
    positionSize: 'Position size',
    ifTarget: 'If take profit hits',
    ifStop: 'If stop loss hits',
    feesIncluded: 'Fees included',
    tooSmall: 'Position under 100 USDT: check Binance minimum order size and quantity rounding, which change these figures at this scale.',
    stopRests: 'Stop rests on',
    targetFrom: 'Target from',
    weakPoints: 'Weak points of this scenario',
    noTrade: 'No trade suggested today',
    noTradeFoot: 'In the backtest, trading outside a trend produced negative expectancy. Standing aside is a decision backed by data, not a missing signal.',
    notTrending: 'The market is not trending (Efficiency Ratio {er}, threshold {th}).',
    noneAligned: 'There is a {dir} regime, but no scenario in that direction clears the minimum net risk/reward and risk limits.',

    posTitle: '🐋 Derivatives positioning',
    topByPosition: 'Top traders by position size',
    topByAccount: 'Top traders by account',
    allAccounts: 'All accounts (retail)',
    whaleGap: 'Whale − retail gap',
    openInterest: 'Open interest',
    takerRatio: 'Taker buy/sell',
    fundingRate: 'Funding rate (8h)',
    fundingPct: 'Funding percentile (30d)',
    moreLong: 'Large traders are notably more long than retail',
    moreShort: 'Large traders are notably more short than retail',
    noDivergence: 'No meaningful divergence between large traders and retail',
    posFoot: 'Ratios above 1 mean more longs than shorts. The "by position size" row is the one that reflects where the money is, since it weights by size rather than by number of accounts.<br><br><strong>Important:</strong> Binance only keeps ~30 days of history for these ratios, so they cannot be backtested. They are shown as context, never used to drive the suggestion automatically. Funding is the only derivatives series with deep history (since 2019).',

    valTitle: '🔬 What we actually measured',
    valIntro: 'The strategy was backtested on {n} trades over BTC data from 2018 to 2026, with real Binance fees, walk-forward (no future data leaked into any decision).',
    valNoFilter: 'Expectancy without regime filter',
    valWithFilter: 'Expectancy with regime filter',
    valHitRate: 'Hit rate with filter',
    valPValue: 'p-value of the improvement',
    valLevels: 'Support/resistance vs random lines',
    plainTerms: 'What this means in plain terms',
    valPoint1: 'With p = {p} there is <strong>no evidence</strong> that the regime filter helps at all. The confidence interval runs from losing to winning.',
    valPoint2: 'Replacing the levels with <strong>random lines gives the same or better results</strong> — 10 of 20 random sets beat the real ones. The levels contribute nothing.',
    valPoint3: 'Two independent tests were run and stopped there on purpose. Trying more statistics until one comes out significant is p-hacking.',
    valFoot: 'A tool that hides its own weak spots is more dangerous than one that has none. Every suggestion this app makes should be read as an unproven hypothesis, not as a forecast.',

    errorTitle: '⚠️ Could not complete the analysis',
    errorFoot: 'Check your internet connection. The app reads public Binance endpoints and needs network access.',
    errorPos: '⚠️ Could not read positioning',
    starting: 'Starting analysis...',
    loadingVal: 'Loading validation results...',
    loadingPos: 'Reading derivatives positioning...',
    clearChat: "Clear chat",
    notActionable: "NOT ACTIONABLE — no proven edge",
    notActionableWhy: "The scenario below is geometry, not a signal. This system has no measured edge (p = 0.27) and its levels perform no better than random lines. Shown so you can see what the chart offers, not as something to act on.",
    levelsCaveat: "Levels shown as ATR distances: the random-levels test showed they carry no information beyond the distance itself.",
    momentumDeteriorating: "momentum deteriorating",
    expectedFees: "Expected fees per trade",
    valSampleSize: "Sample size (n)",
    valBonferroni: "Bonferroni threshold (configs tried)",
    valPoint4: "With n = 163 this is <strong>not an underpowered test</strong>: a large edge would have shown. So the honest conclusion is not \"we need more data\" but <strong>\"if an edge exists, it is small\"</strong> — and the optimistic +0.27R bound is the best of 15 configurations, which is winner's curse.",
    LONG: 'LONG', SHORT: 'SHORT',
    BULLISH: 'BULLISH', BEARISH: 'BEARISH',
  },

  es: {
    tagline: 'Análisis de mercado educativo',
    actions: 'Acciones',
    analyze: 'Analizar hoy',
    refresh: 'Actualizar datos',
    whales: 'Posición de las ballenas',
    validation: '¿Es fiable esto?',
    settings: 'Ajustes',
    language: 'Idioma',
    capital: 'Capital (USDT)',
    feeProfile: 'Perfil de comisiones',
    makerEntry: 'Entrar con orden límite (maker)',
    notLoaded: 'sin cargar',
    updated: 'actualizado',
    disclaimer: 'Herramienta educativa. No es asesoramiento financiero. No se conecta a ninguna cuenta y nunca envía órdenes.',

    askAnalyze: '¿Qué lectura hay hoy?',
    askRefresh: 'Actualiza los datos y analiza',
    askWhales: '¿Dónde está posicionado el dinero grande?',
    askValidation: '¿Qué fiabilidad tiene este sistema?',

    welcomeTitle: '👋 Bienvenido',
    welcomeIntro: 'Esta herramienta lee datos de Bitcoin desde endpoints públicos de Binance y construye un escenario técnico con stop loss y take profit, explicando el razonamiento detrás.',
    gettingStarted: 'Para empezar',
    step1: 'Pulsa <strong>Analizar hoy</strong> para ver la lectura actual y, si se cumplen las condiciones, un escenario sugerido.',
    step2: 'Escribe tu <strong>capital</strong> a la izquierda para ver exactamente cuánto ganarías en el objetivo y cuánto perderías en el stop, comisiones incluidas.',
    step3: '<strong>Posición de las ballenas</strong> muestra dónde están los grandes traders frente al minorista.',
    step4: '<strong>¿Es fiable esto?</strong> muestra los resultados del backtest, incluido lo que falló.',
    welcomeFoot: 'Herramienta educativa y de investigación. No es asesoramiento financiero. No sabe nada de tu situación, no se conecta a ninguna cuenta y nunca envía una orden. Cada decisión y cada riesgo son tuyos.',

    marketRead: 'Lectura del mercado',
    noClearTrend: 'sin tendencia clara',
    why: 'Por qué',
    against: 'Evidencia en contra de esta lectura',
    suggested: 'Escenario sugerido',
    reference: 'referencia',
    entry: 'Entrada',
    stopLoss: 'Stop loss',
    takeProfit: 'Take profit',
    netRR: 'Riesgo/beneficio neto',
    needsHitRate: 'exige acertar más del',
    feesTake: 'Las comisiones se llevan',
    ofGross: 'del beneficio bruto',
    withCapital: 'Con {n} USDT, sin apalancar',
    positionSize: 'Tamaño de la posición',
    ifTarget: 'Si toca el take profit',
    ifStop: 'Si toca el stop loss',
    feesIncluded: 'Comisiones incluidas',
    tooSmall: 'Posición inferior a 100 USDT: comprueba el mínimo de orden de Binance y el redondeo de cantidad, que a esta escala alteran estas cifras.',
    stopRests: 'El stop se apoya en',
    targetFrom: 'El objetivo viene de',
    weakPoints: 'Puntos débiles de este escenario',
    noTrade: 'Hoy no se sugiere ninguna operación',
    noTradeFoot: 'En el backtest, operar fuera de tendencia dio expectativa negativa. Quedarse fuera es una decisión respaldada por datos, no una falta de señal.',
    notTrending: 'El mercado no está en tendencia (Efficiency Ratio {er}, umbral {th}).',
    noneAligned: 'Hay un régimen {dir}, pero ningún escenario en esa dirección supera los mínimos de riesgo/beneficio neto y de riesgo.',

    posTitle: '🐋 Posicionamiento en derivados',
    topByPosition: 'Grandes traders por tamaño de posición',
    topByAccount: 'Grandes traders por cuenta',
    allAccounts: 'Todas las cuentas (minorista)',
    whaleGap: 'Diferencia ballenas − minorista',
    openInterest: 'Interés abierto',
    takerRatio: 'Compra/venta agresiva',
    fundingRate: 'Tasa de funding (8h)',
    fundingPct: 'Percentil de funding (30d)',
    moreLong: 'Los grandes traders están notablemente más largos que el minorista',
    moreShort: 'Los grandes traders están notablemente más cortos que el minorista',
    noDivergence: 'Sin divergencia relevante entre grandes traders y minorista',
    posFoot: 'Un ratio por encima de 1 significa más largos que cortos. La fila "por tamaño de posición" es la que refleja dónde está el dinero, porque pondera por tamaño y no por número de cuentas.<br><br><strong>Importante:</strong> Binance solo guarda ~30 días de histórico de estos ratios, así que no se pueden backtestear. Se muestran como contexto, nunca se usan para decidir automáticamente. El funding es la única serie de derivados con histórico profundo (desde 2019).',

    valTitle: '🔬 Lo que hemos medido de verdad',
    valIntro: 'La estrategia se probó sobre {n} operaciones con datos de BTC de 2018 a 2026, con comisiones reales de Binance y en modo walk-forward (ningún dato del futuro se filtró a ninguna decisión).',
    valNoFilter: 'Expectativa sin filtro de régimen',
    valWithFilter: 'Expectativa con filtro de régimen',
    valHitRate: 'Acierto con el filtro',
    valPValue: 'p-valor de la mejora',
    valLevels: 'Soportes/resistencias frente a líneas al azar',
    plainTerms: 'Qué significa esto en claro',
    valPoint1: 'Con p = {p} <strong>no hay evidencia</strong> de que el filtro de régimen ayude en absoluto. El intervalo de confianza va de perder a ganar.',
    valPoint2: 'Sustituir los niveles por <strong>líneas al azar da resultados iguales o mejores</strong> — 10 de 20 conjuntos aleatorios superan a los reales. Los niveles no aportan nada.',
    valPoint3: 'Se hicieron dos pruebas independientes y se paró ahí a propósito. Seguir probando estadísticos hasta que uno salga significativo es p-hacking.',
    valFoot: 'Una herramienta que esconde sus puntos débiles es más peligrosa que una que no los tiene. Cada sugerencia de esta app debe leerse como una hipótesis sin demostrar, no como una predicción.',

    errorTitle: '⚠️ No se pudo completar el análisis',
    errorFoot: 'Comprueba tu conexión a internet. La app lee endpoints públicos de Binance y necesita acceso a la red.',
    errorPos: '⚠️ No se pudo leer el posicionamiento',
    starting: 'Iniciando análisis...',
    loadingVal: 'Cargando resultados de validación...',
    loadingPos: 'Leyendo posicionamiento en derivados...',
    clearChat: "Vaciar chat",
    notActionable: "NO ACCIONABLE — sin ventaja demostrada",
    notActionableWhy: "El escenario de abajo es geometría, no una señal. Este sistema no tiene ventaja medida (p = 0,27) y sus niveles no rinden mejor que líneas al azar. Se muestra para que veas qué ofrece el gráfico, no para actuar sobre ello.",
    levelsCaveat: "Los niveles se muestran como distancias en ATR: la prueba de niveles aleatorios demostró que no aportan información más allá de la propia distancia.",
    momentumDeteriorating: "momento deteriorándose",
    expectedFees: "Comisión esperada por operación",
    valSampleSize: "Tamaño de muestra (n)",
    valBonferroni: "Umbral Bonferroni (configs probadas)",
    valPoint4: "Con n = 163 <strong>no es un test infrapotenciado</strong>: una ventaja grande se habría visto. La conclusión honesta no es \"faltan datos\" sino <strong>\"si hay ventaja, es pequeña\"</strong> — y ese +0,27R optimista es el mejor de 15 configuraciones, o sea la maldición del ganador.",
    LONG: 'LARGO', SHORT: 'CORTO',
    BULLISH: 'ALCISTA', BEARISH: 'BAJISTA',
  },
};

/**
 * Sentence patterns for text produced by the engine.
 * Each entry: [regex over the English sentence, Spanish template with $1, $2...].
 * Order matters — more specific patterns must come before generic ones.
 */
const PATTERNS = [
  // regime
  [/^Regime: uptrend\. Price converts (\d+)% of its total path into net progress: it moves one way, not back and forth\.$/,
   'Régimen: tendencia alcista. El precio convierte el $1% de su recorrido en avance neto: se mueve en una dirección, no de ida y vuelta.'],
  [/^Regime: downtrend\. Price converts (\d+)% of its total path into net progress: it moves one way, not back and forth\.$/,
   'Régimen: tendencia bajista. El precio convierte el $1% de su recorrido en avance neto: se mueve en una dirección, no de ida y vuelta.'],
  [/^Regime: ranging\. Only (\d+)% of the path becomes net progress: price moves a lot and gets nowhere\.$/,
   'Régimen: rango. Solo el $1% del recorrido se convierte en avance: el precio se mueve mucho y llega poco.'],
  [/^Regime: transition\. Intermediate efficiency \((\d+)%\): neither a clean trend nor a clear range\.$/,
   'Régimen: transición. Eficiencia intermedia ($1%): ni tendencia limpia ni rango claro.'],
  // synthesis
  [/^All timeframes agree on: (.+)\.$/, 'Todas las temporalidades coinciden en: $1.'],
  [/^Vote by timeframe: (.+) — aggregate bias (\w+) \((\d+)% agreement\)\.$/,
   'Voto por temporalidad: $1 — sesgo agregado $2 ($3% de acuerdo).'],
  [/^Volatility (\w+) \(percentile (\d+) of the last year\)\. Daily ATR ([\d,]+) USDT\.$/,
   'Volatilidad $1 (percentil $2 del último año). ATR diario $3 USDT.'],
  [/^Positioning: large traders ([\d.]+) long\/short vs ([\d.]+) for all accounts — (.+)\.$/,
   'Posicionamiento: grandes traders $1 largos/cortos frente a $2 del total de cuentas — $3.'],
  [/^Funding ([\d.-]+)% per 8h \(percentile (\d+) of last 30 days\) — (.+)\.$/,
   'Funding $1% cada 8h (percentil $2 de los últimos 30 días) — $3.'],
  // signals inside the "against" list
  [/^\[(\w+)\] Pivot structure: (.+)\. Swing sequence (.+)\. Dow definition, no tunable parameters\.$/,
   '[$1] Estructura de pivotes: $2. Secuencia de giros $3. Definición de Dow, sin parámetros ajustables.'],
  [/^\[(\w+)\] Price vs EMA200: (\w+)\. Price ([\d.]+) vs EMA200 ([\d.]+) \(([-\d.]+)%\)\.$/,
   '[$1] Precio vs EMA200: $2. Precio $3 frente a EMA200 $4 ($5%).'],
  [/^\[(\w+)\] EMA50 \/ EMA200 cross: EMA50 (\w+)\. The intermediate average is (\w+) the slow one\.$/,
   '[$1] Cruce EMA50/EMA200: EMA50 $2. La media intermedia va $3 de la lenta.'],
  [/^\[(\w+)\] MACD momentum: (\w+) histogram\. Histogram ([-\d]+), (\w+)\.$/,
   '[$1] Impulso MACD: histograma $2. Histograma $3, $4.'],
  [/^\[(\w+)\] RSI at (\d+): the move is already extended, remaining upside may be smaller\.$/,
   '[$1] RSI en $2: el movimiento ya está extendido, el recorrido restante puede ser menor.'],
  [/^\[(\w+)\] RSI at (\d+): the decline is already extended, remaining downside may be smaller\.$/,
   '[$1] RSI en $2: la caída ya está extendida, el recorrido restante puede ser menor.'],
  [/^\[(\w+)\] Price at (\d+)% of its 60-candle range: entering late in the move\.$/,
   '[$1] Precio al $2% de su rango de 60 velas: entrar tarde en el movimiento.'],
  [/^\[(\w+)\] Volume at (\d+)% of normal: little participation behind the move\.$/,
   '[$1] Volumen al $2% de lo normal: poca participación detrás del movimiento.'],
  // scenario fields
  [/^zone with (\d+) touches$/, 'zona con $1 toques'],
  [/^volatility projection \(([\d.]+) ATR\) — no historical level in window$/,
   'proyección por volatilidad ($1 ATR) — sin nivel histórico en la ventana'],
  [/^structure$/, 'estructura'],
  [/^1 ATR floor \(structure was inside the noise\)$/, 'suelo de 1 ATR (la estructura quedaba dentro del ruido)'],
  [/^volatility \(no structural level in window\)$/, 'volatilidad (sin nivel estructural en la ventana)'],
  // penalties
  [/^runs against the aggregate technical bias$/, 'va en contra del sesgo técnico agregado'],
  [/^the stop rests on the ATR floor, not on real structure$/, 'el stop se apoya en el suelo de ATR, no en estructura real'],
  [/^the target is a volatility projection, not an observed level$/, 'el objetivo es una proyección de volatilidad, no un nivel observado'],
  [/^volume below 70% of normal$/, 'volumen por debajo del 70% de lo normal'],
];

/**
 * WHOLE PHRASES, replaced literally and before anything else.
 *
 * A phrase like "Price vs EMA200 (bullish)" contains parentheses, so the
 * word-boundary regex used for single words only catches the "bullish" inside
 * it and leaves the rest in English — half-translated output is worse than
 * none. Literal replacement of the full phrase avoids that.
 */
const PHRASES = [
  ['Price vs EMA200 (bullish)', 'Precio vs EMA200 (alcista)'],
  ['Price vs EMA200 (bearish)', 'Precio vs EMA200 (bajista)'],
  ['Pivot structure (bullish)', 'Estructura de pivotes (alcista)'],
  ['Pivot structure (bearish)', 'Estructura de pivotes (bajista)'],
  ['MACD momentum (bullish)', 'Impulso MACD (alcista)'],
  ['MACD momentum (bearish)', 'Impulso MACD (bajista)'],
  ['EMA50 / EMA200 cross (bullish)', 'Cruce EMA50/EMA200 (alcista)'],
  ['EMA50 / EMA200 cross (bearish)', 'Cruce EMA50/EMA200 (bajista)'],
  ['big money is more long than retail', 'el dinero grande está más largo que el minorista'],
  ['big money is more short than retail', 'el dinero grande está más corto que el minorista'],
  ['no meaningful divergence', 'sin divergencia relevante'],
  ['longs are paying shorts', 'los largos pagan a los cortos'],
  ['shorts are paying longs', 'los cortos pagan a los largos'],
];

/** Single words, guarded by delimiters so they never match inside another word. */
const FRAGMENTS = [
  ['normal', 'normal'], ['above', 'por encima'], ['below', 'por debajo'],
  ['widening', 'ampliándose'], ['narrowing', 'estrechándose'],
  ['bullish', 'alcista'], ['bearish', 'bajista'],
  ['positive', 'positivo'], ['negative', 'negativo'],
  ['high', 'alta'], ['low', 'baja'],
];

/**
 * Numbers arrive already formatted by the engine in en-US ("2,139"). Read as
 * Spanish, that string says "2 point 139" — a completely different number.
 * Any group that looks like en-US thousands separation is switched to dots.
 */
function localiseNumbers(s) {
  return s.replace(/\b\d{1,3}(?:,\d{3})+(?!\d)/g, (m) => m.split(',').join('.'));
}

/** Translates one engine-produced sentence. Unknown sentences pass through. */
export function tr(text, lang) {
  if (lang !== 'es' || typeof text !== 'string') return text;

  for (const [re, template] of PATTERNS) {
    const m = text.match(re);
    if (m) {
      let out = template;
      for (let i = 1; i < m.length; i++) out = out.split('$' + i).join(m[i]);
      // Whole phrases first, then single words.
      for (const [en, es] of PHRASES) out = out.split(en).join(es);
      for (const [en, es] of FRAGMENTS) {
        if (en === es) continue;
        out = out.replace(new RegExp('(^|[\\s(])' + en + '($|[\\s.,)])', 'g'), `$1${es}$2`);
      }
      return localiseNumbers(out);
    }
  }
  return text;
}

/** UI string lookup with {placeholder} substitution. */
export function t(key, lang, vars = {}) {
  let s = (UI[lang] && UI[lang][key]) ?? UI.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(v);
  return s;
}

export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
];
