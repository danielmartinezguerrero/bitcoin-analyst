/**
 * MODULO 10 - Backtest de la estrategia completa.
 *
 * Hasta ahora habiamos validado los NIVELES. Esto valida la ESTRATEGIA: la
 * regla entera, de principio a fin, con costes reales. Es la unica forma de
 * saber si el sistema tiene expectativa positiva, y por tanto la unica forma
 * de saber si un cambio futuro mejora algo o solo lo cambia.
 *
 * COMO FUNCIONA
 *   1. recorre el historico dia a dia
 *   2. en cada dia construye el analisis SOLO con velas anteriores
 *   3. aplica los mismos criterios que el selector diario
 *   4. si hay candidato apto, abre la operacion al cierre de ese dia
 *   5. sigue el precio en velas de 4h hasta que toque stop u objetivo
 *   6. anota el resultado en R NETO, con comisiones y deslizamiento
 *
 * TRES DECISIONES QUE EVITAN INFLAR EL RESULTADO
 *
 *   VENTANA FIJA. Cada dia se analiza con las ultimas N velas, nunca con
 *   toda la serie. Ademas de ser lo realista, evita que el analisis del dia
 *   1000 sea mas "sabio" que el del dia 300 por tener mas datos.
 *
 *   RESOLUCION DE 4h. El seguimiento no usa velas diarias sino de 4 horas.
 *   Con velas diarias, un dia que toca stop y objetivo es ambiguo y hay que
 *   adivinar; a 4h la ambiguedad se reduce mucho.
 *
 *   EL STOP GANA LOS EMPATES. Si dentro de la misma vela de 4h se tocan los
 *   dos, se cuenta como stop. No sabemos el orden dentro de la vela, y
 *   suponer lo favorable es la forma mas rapida de fabricar un backtest
 *   brillante que pierde dinero en vivo.
 */
import { analizarTemporalidad, sintetizar } from './analisis.mjs';
import { seleccionDiaria, CRITERIOS } from './seleccion.mjs';
import { escenarioNeto } from './costes.mjs';
import { clasificarRegimen } from './regimen.mjs';
import { atr } from './indicadores.mjs';
import { simularConGestion, GESTION_POR_DEFECTO } from './gestion.mjs';

const POR_DEFECTO = {
  ventana: 250,          // velas de contexto para el analisis
  maxDiasEnPosicion: 30, // si no se resuelve, se cierra a mercado
  costes: { perfil: 'futuros', opciones: { entradaComoMaker: true } },
  criterios: CRITERIOS,
  unaOperacionALaVez: true,
  /**
   * FILTRO DE REGIMEN — la hipotesis que este backtest debe contrastar.
   *   'ninguno'    opera siempre que haya candidato apto
   *   'tendencia'  solo cuando el mercado avanza de verdad (ER alto)
   *   'alineado'   ademas, solo en la direccion del propio regimen
   */
  filtroRegimen: 'ninguno',
  gestion: GESTION_POR_DEFECTO,
  nivelesAleatorios: false,
  rng: Math.random,
};

/** Envuelve un tramo de velas en el formato que espera analizarTemporalidad. */
function comoSerie(velas, intervalo) {
  return { intervalo, cantidad: velas.length, ultimaEnCurso: false, velas };
}

/**
 * Sigue una operacion abierta sobre las velas de 4h posteriores.
 * Devuelve como acabo y cuanto tardo.
 */
function seguirOperacion(velas4h, desdeMs, op, maxMs) {
  const esLargo = op.direccion === 'alcista';
  let mfe = 0, mae = 0;

  for (const v of velas4h) {
    if (v.t < desdeMs) continue;
    if (v.t - desdeMs > maxMs) {
      return { resultado: 'tiempo', precioSalida: v.c, cerradoEnMs: v.t, mfe, mae };
    }

    const favorable = esLargo ? (v.h - op.entrada) : (op.entrada - v.l);
    const adverso = esLargo ? (v.l - op.entrada) : (op.entrada - v.h);
    if (favorable > mfe) mfe = favorable;
    if (adverso < mae) mae = adverso;

    const tocaStop = esLargo ? v.l <= op.stop : v.h >= op.stop;
    const tocaObjetivo = esLargo ? v.h >= op.objetivo : v.l <= op.objetivo;

    // El stop se comprueba primero: en un empate dentro de la vela, pierde.
    if (tocaStop) return { resultado: 'stop', precioSalida: op.stop, cerradoEnMs: v.t, mfe, mae };
    if (tocaObjetivo) return { resultado: 'objetivo', precioSalida: op.objetivo, cerradoEnMs: v.t, mfe, mae };
  }
  return { resultado: 'sin resolver', precioSalida: null, cerradoEnMs: null, mfe, mae };
}

export function backtest(velasDiarias, velas4h, opciones = {}) {
  const opc = { ...POR_DEFECTO, ...opciones };
  const maxMs = opc.maxDiasEnPosicion * 86400000;

  const operaciones = [];
  const diasSinSenal = [];
  let ocupadoHastaMs = 0;

  for (let t = opc.ventana; t < velasDiarias.length - 1; t++) {
    const hoy = velasDiarias[t];

    if (opc.unaOperacionALaVez && hoy.t < ocupadoHastaMs) continue;

    // SOLO PASADO: la ventana termina en t inclusive; la vela t ya ha cerrado.
    const ventana1d = velasDiarias.slice(t - opc.ventana + 1, t + 1);
    const ventana4h = velas4h.filter((v) => v.t <= hoy.tCierre).slice(-opc.ventana);
    if (ventana4h.length < 210) continue;

    let analisis;
    try {
      analisis = [
        analizarTemporalidad(comoSerie(ventana1d, '1d')),
        analizarTemporalidad(comoSerie(ventana4h, '4h')),
      ];
    } catch { continue; }

    const sintesis = sintetizar(analisis);

    /**
     * PRUEBA DE NIVELES ALEATORIOS.
     *
     * Sustituye los niveles de soporte y resistencia por lineas trazadas al
     * azar en el mismo rango, dejando TODO lo demas igual: mismo regimen,
     * mismos criterios, mismos costes, misma gestion.
     *
     * Es la prueba mas dura que se le puede hacer al sistema. Si el resultado
     * no empeora, los niveles no aportan nada y el R:R que se publica no es
     * una ventaja: es solo la distancia que el algoritmo eligio poner.
     */
    if (opc.nivelesAleatorios) {
      for (const a of analisis) {
        const ventana = a.temporalidad === '1d' ? ventana1d : ventana4h;
        const min = Math.min(...ventana.map((v) => v.l));
        const max = Math.max(...ventana.map((v) => v.h));
        const cuantos = a.niveles.resistencias.length + a.niveles.soportes.length;
        const falsos = [];
        for (let k = 0; k < Math.max(cuantos, 4); k++) {
          const precio = min + opc.rng() * (max - min);
          falsos.push({
            precio, toques: 2, fuerza: 50,
            tipo: precio < a.precio ? 'soporte' : 'resistencia',
            distanciaPct: Number((((precio - a.precio) / a.precio) * 100).toFixed(2)),
            distanciaATR: Number((Math.abs(precio - a.precio) / a.indicadores.atr14).toFixed(2)),
            ultimoToque: ventana[ventana.length - 1].fecha,
          });
        }
        a.niveles = {
          precioActual: a.precio,
          resistencias: falsos.filter((n) => n.precio > a.precio).sort((x, y) => x.precio - y.precio),
          soportes: falsos.filter((n) => n.precio < a.precio).sort((x, y) => y.precio - x.precio),
          enDescubrimiento: false, cobertura: a.niveles.cobertura,
        };
        a.niveles.resistenciaInmediata = a.niveles.resistencias[0] ?? null;
        a.niveles.soporteInmediato = a.niveles.soportes[0] ?? null;
      }
    }

    // Regimen calculado SOLO con la ventana pasada, igual que todo lo demas.
    const regimen = clasificarRegimen(ventana1d, atr(ventana1d, 14));

    if (opc.filtroRegimen !== 'ninguno' && !regimen.esTendencia) {
      diasSinSenal.push(hoy.fecha);
      continue;
    }

    const sel = seleccionDiaria(analisis, sintesis, opc.costes, opc.criterios);

    if (!sel.hayApto) {
      diasSinSenal.push(hoy.fecha);
      continue;
    }

    let m = sel.mejor;

    // 'alineado': ademas de haber tendencia, el escenario debe ir en su misma
    // direccion. Operar a contratendencia dentro de un regimen tendencial es
    // justo lo que el filtro pretende evitar.
    if (opc.filtroRegimen === 'alineado') {
      const aptoAlineado = sel.aptos.find((c) => c.direccion === regimen.direccion);
      if (!aptoAlineado) { diasSinSenal.push(hoy.fecha); continue; }
      m = aptoAlineado;
    }

    const op = {
      fecha: hoy.fecha,
      temporalidad: m.temporalidad,
      direccion: m.direccion,
      calidad: m.calidad,
      // Entrada al cierre del dia que genero la senal: es el primer precio
      // al que se podria haber operado sin conocer el futuro.
      entrada: hoy.c,
      stop: m.invalidacion.precio,
      objetivo: m.objetivo.precio,
      rrNetoEsperado: m.objetivo.rrNeto,
      alineadoConSesgo: m.alineadoConSesgo,
      regimen: regimen.tipo,
      er: regimen.er,
      volatilidad: regimen.volatilidadEstado,
    };

    const sim = simularConGestion(velas4h, hoy.tCierre, { ...op, atr: analisis[0].indicadores.atr14 }, maxMs, opc.gestion);
    if (!sim) continue; // sigue abierta al final de la serie
    const r = { resultado: sim.motivo, precioSalida: sim.precioSalida, cerradoEnMs: sim.cerradoEnMs, mfe: 0, mae: 0 };

    // Resultado en R NETO: se recalcula con el precio de salida real, que en
    // un cierre por tiempo no es ni el stop ni el objetivo.
    const neto = escenarioNeto(op.entrada, op.stop, op.objetivo,
      opc.costes.perfil, opc.costes.opciones);
    const riesgoPct = neto.netoPerdidaPct / 100;

    /**
     * El resultado bruto lo da la simulacion (que ya aplico la gestion).
     * Aqui solo se descuentan los costes, y se descuentan segun COMO se salio:
     * por objetivo es una orden limit (maker), por stop es a mercado (taker
     * mas deslizamiento). Aplicar el mismo coste a las dos ramas abarata
     * artificialmente las perdidas.
     */
    const brutoR = sim.resultadoRBruto;
    const salioPorStop = sim.motivo === 'stop' || sim.motivo === 'break-even';
    const costeSalida = salioPorStop ? neto.costes.totalSiPierde : neto.costes.totalSiGana;

    /**
     * FUNDING, con la duracion REAL de cada operacion.
     *
     * Antes esto se omitia: costesOperacion() usa horasEnPosicion = 0 por
     * defecto, asi que el funding salia cero y el backtest cobraba de menos.
     * Con una duracion media de 4,6 dias son ~13 periodos de 8h — alrededor
     * de 0,13% del nominal, que sobre un riesgo tipico del 4,2% equivale a
     * 0,032R por operacion. No es un matiz: es una cuarta parte de la
     * expectativa que estabamos publicando.
     *
     * Solo aplica a perpetuos. En spot no existe funding.
     */
    const horasReales = r.cerradoEnMs ? (r.cerradoEnMs - hoy.tCierre) / 3600000 : 0;
    const conFunding = escenarioNeto(op.entrada, op.stop, op.objetivo,
      opc.costes.perfil, { ...opc.costes.opciones, horasEnPosicion: horasReales });
    const costeFundingEnR = conFunding.costes.funding / riesgoPct;

    const costeEnR = (costeSalida + neto.costes.deslizamientoEntrada) / riesgoPct;
    const resultadoR = brutoR - Math.abs(costeEnR) - costeFundingEnR;

    operaciones.push({
      ...op,
      resultado: r.resultado,
      precioSalida: r.precioSalida,
      resultadoR: Number(resultadoR.toFixed(3)),
      diasEnPosicion: r.cerradoEnMs ? Number(((r.cerradoEnMs - hoy.tCierre) / 86400000).toFixed(1)) : null,
      mfeR: Number(sim.mfeR.toFixed(2)),
      maeR: Number(sim.maeR.toFixed(2)),
      huboParcial: sim.huboParcial,
    });

    if (opc.unaOperacionALaVez && r.cerradoEnMs) ocupadoHastaMs = r.cerradoEnMs;
  }

  return resumir(operaciones, diasSinSenal, opc, velasDiarias);
}

/** Estadisticas de la serie de operaciones. */
function resumir(ops, diasSinSenal, opc, velasDiarias) {
  if (!ops.length) {
    return { operaciones: [], total: 0, diasSinSenal: diasSinSenal.length, sinDatos: true };
  }

  const ganadoras = ops.filter((o) => o.resultadoR > 0);
  const perdedoras = ops.filter((o) => o.resultadoR <= 0);
  const sumaR = ops.reduce((s, o) => s + o.resultadoR, 0);
  const tasaAcierto = ganadoras.length / ops.length;

  const mediaGanancia = ganadoras.length
    ? ganadoras.reduce((s, o) => s + o.resultadoR, 0) / ganadoras.length : 0;
  const mediaPerdida = perdedoras.length
    ? Math.abs(perdedoras.reduce((s, o) => s + o.resultadoR, 0) / perdedoras.length) : 0;

  /**
   * DRAWDOWN en R sobre la curva acumulada. Es la medida que decide si una
   * estrategia es operable en la practica: una con expectativa positiva pero
   * con rachas de -15R es psicologicamente insostenible, y quien la opera la
   * abandona justo antes de que se recupere.
   */
  let acumulado = 0, pico = 0, drawdown = 0, rachaPerdedora = 0, peorRacha = 0;
  const curva = [];
  for (const o of ops) {
    acumulado += o.resultadoR;
    curva.push(Number(acumulado.toFixed(2)));
    if (acumulado > pico) pico = acumulado;
    const dd = pico - acumulado;
    if (dd > drawdown) drawdown = dd;
    if (o.resultadoR <= 0) { rachaPerdedora++; if (rachaPerdedora > peorRacha) peorRacha = rachaPerdedora; }
    else rachaPerdedora = 0;
  }

  const porTipo = (tipo) => ops.filter((o) => o.resultado === tipo).length;
  const dias = (velasDiarias[velasDiarias.length - 1].t - velasDiarias[opc.ventana].t) / 86400000;

  return {
    sinDatos: false,
    parametros: opc,
    periodo: { desde: ops[0].fecha.slice(0, 10), hasta: ops[ops.length - 1].fecha.slice(0, 10), dias: Math.round(dias) },
    total: ops.length,
    diasSinSenal: diasSinSenal.length,
    frecuencia: Number((ops.length / (dias / 30)).toFixed(2)), // operaciones al mes
    ganadoras: ganadoras.length,
    perdedoras: perdedoras.length,
    tasaAcierto,
    cierres: { objetivo: porTipo('objetivo'), stop: porTipo('stop'), tiempo: porTipo('tiempo') },
    mediaGanancia: Number(mediaGanancia.toFixed(3)),
    mediaPerdida: Number(mediaPerdida.toFixed(3)),
    /**
     * EXPECTATIVA: R medio por operacion. Es EL numero. Si es negativo, no hay
     * ajuste de gestion, disciplina ni tamano de posicion que lo arregle:
     * operar mas solo hace perder mas deprisa.
     */
    expectativaR: Number((sumaR / ops.length).toFixed(4)),
    totalR: Number(sumaR.toFixed(2)),
    drawdownMaxR: Number(drawdown.toFixed(2)),
    peorRachaPerdedora: peorRacha,
    diasMediosEnPosicion: Number((ops.reduce((s, o) => s + (o.diasEnPosicion ?? 0), 0) / ops.length).toFixed(1)),
    // Tasa de acierto que haria falta para empatar, con el R:R medio logrado.
    winRateNecesario: mediaPerdida > 0 ? 1 / (1 + mediaGanancia / mediaPerdida) : 1,
    curva,
    operaciones: ops,
  };
}
