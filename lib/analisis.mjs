/**
 * MODULO 4 - Motor de analisis. Funde indicadores + estructura y produce un
 * DOSSIER: el conjunto de hechos tecnicos medidos, con su desglose.
 *
 * PRINCIPIO RECTOR: nada de numeros magicos. Cada senal declara su lectura,
 * su voto y su motivo. El resultado final es la suma de votos visibles, no
 * una puntuacion salida de una caja negra. Si el dossier dice "sesgo alcista
 * 62%", tiene que poderse reconstruir a mano a partir de la tabla de senales.
 *
 * LO QUE ESTE MODULO NO HACE: recomendar operar. Describe el estado tecnico,
 * su fuerza, y sobre todo la evidencia que lo contradice.
 */
import { ema, rsi, macd, atr, volumenRelativo, ultimo } from './indicadores.mjs';
import { pivotes, estructuraMercado, nivelesClave, contextoNiveles, posicionEnRango } from './estructura.mjs';

/**
 * Peso de cada temporalidad en el voto final.
 * El diario manda: sus senales tardan mas en formarse y mas en romperse.
 * El horario aporta timing, no direccion. Ignorar esta jerarquia es la via
 * rapida a operar ruido de 1h contra una tendencia diaria.
 */
const PESOS = { '1d': 4, '4h': 3, '1h': 2, '15m': 1 };

/** Analiza una temporalidad y devuelve sus hechos medidos. */
export function analizarTemporalidad(serie) {
  // Solo velas CERRADAS: la viva repinta y cambiaria el dossier cada minuto.
  const velas = serie.ultimaEnCurso ? serie.velas.slice(0, -1) : serie.velas;
  const cierres = velas.map((v) => v.c);
  const precio = cierres[cierres.length - 1];

  const e20 = ultimo(ema(cierres, 20));
  const e50 = ultimo(ema(cierres, 50));
  const e200 = ultimo(ema(cierres, 200));
  const r14 = ultimo(rsi(cierres, 14));
  const m = macd(cierres);
  const hist = ultimo(m.histograma);
  const histPrevio = m.histograma.filter((x) => x !== null).slice(-2)[0] ?? null;
  const atr14 = ultimo(atr(velas, 14));
  const volRel = ultimo(volumenRelativo(velas.map((v) => v.v), 20));

  const p = pivotes(velas, 5, 5);
  const est = estructuraMercado(p);
  const niveles = nivelesClave(velas, p, atr14, { toleranciaATR: 0.5, maxNiveles: 20, semivida: 50 });
  const dias = Math.round((velas[velas.length - 1].t - velas[0].t) / 86400000);
  const ctx = contextoNiveles(niveles, precio, 3, {
    barras: velas.length, dias,
    desde: velas[0].fecha.slice(0, 10),
    maximo: Math.max(...velas.map((v) => v.h)),
  });
  const rango = posicionEnRango(velas, 60);

  /**
   * SENALES DIRECCIONALES. Cuatro, deliberadamente pocas y poco solapadas.
   * Meter quince indicadores que miden lo mismo no aporta informacion: solo
   * multiplica la misma senal y produce una falsa sensacion de confluencia.
   */
  const senales = [
    {
      nombre: 'Estructura de pivotes',
      lectura: est.tendencia,
      voto: est.tendencia === 'alcista' ? 1 : est.tendencia === 'bajista' ? -1 : 0,
      porque: 'Secuencia de giros ' + (est.secuenciaReciente.join(' ') || 'insuficiente')
        + '. Definicion de Dow, sin parametros ajustables.',
    },
    {
      nombre: 'Precio vs EMA200',
      lectura: precio > e200 ? 'por encima' : 'por debajo',
      voto: e200 === null ? 0 : precio > e200 ? 1 : -1,
      porque: e200 === null ? 'Sin datos suficientes.'
        : 'Precio ' + precio.toFixed(0) + ' frente a EMA200 ' + e200.toFixed(0)
          + ' (' + (((precio - e200) / e200) * 100).toFixed(1) + '%).',
    },
    {
      nombre: 'Cruce EMA50 / EMA200',
      lectura: e50 === null || e200 === null ? 'sin datos' : e50 > e200 ? 'EMA50 encima' : 'EMA50 debajo',
      voto: e50 === null || e200 === null ? 0 : e50 > e200 ? 1 : -1,
      porque: e50 === null || e200 === null ? 'Sin datos suficientes.'
        : 'La media intermedia va ' + (e50 > e200 ? 'por encima' : 'por debajo') + ' de la lenta.',
    },
    {
      nombre: 'Impulso MACD',
      lectura: hist === null ? 'sin datos' : hist > 0 ? 'histograma positivo' : 'histograma negativo',
      voto: hist === null ? 0 : hist > 0 ? 1 : -1,
      porque: hist === null ? 'Sin datos suficientes.'
        : 'Histograma ' + hist.toFixed(0)
          + (histPrevio !== null
            ? ', ' + (Math.abs(hist) > Math.abs(histPrevio) ? 'ampliandose' : 'estrechandose')
            : '') + '.',
    },
  ];

  const suma = senales.reduce((s, x) => s + x.voto, 0);

  /**
   * CONTEXTO NO DIRECCIONAL. Estas lecturas NO votan, y es a proposito.
   * Un RSI de 80 no es bajista: en tendencia fuerte puede quedarse ahi
   * semanas. Convertir "sobrecompra" en voto de venta es el error clasico
   * que hace que los sistemas se pongan cortos contra tendencias intactas.
   * Son moduladores del riesgo, no de la direccion.
   */
  const contexto = {
    rsi: r14,
    rsiEstado: r14 === null ? 'sin datos'
      : r14 >= 70 ? 'extendido al alza' : r14 <= 30 ? 'extendido a la baja' : 'neutro',
    atr: atr14,
    atrPctPrecio: atr14 ? Number(((atr14 / precio) * 100).toFixed(2)) : null,
    volumenRelativo: volRel,
    volumenEstado: volRel === null ? 'sin datos'
      : volRel >= 1.5 ? 'por encima de lo normal' : volRel <= 0.6 ? 'flojo' : 'normal',
    posicionEnRango: rango.posicion,
    amplitudRangoPct: rango.amplitudPct,
  };

  return {
    temporalidad: serie.intervalo,
    precio,
    ultimaVelaCerrada: velas[velas.length - 1].fecha,
    indicadores: { ema20: e20, ema50: e50, ema200: e200, rsi14: r14, macdHist: hist, atr14, volRel },
    contexto,
    estructura: est,
    niveles: ctx,
    rango,
    senales,
    voto: suma,
    peso: PESOS[serie.intervalo] ?? 1,
  };
}

/**
 * Funde las temporalidades. Lo importante no es el numero final sino el
 * DESACUERDO: cuando el diario y el horario apuntan a lados distintos, esa
 * discrepancia es informacion de primer orden, no ruido que promediar.
 */
export function sintetizar(analisis) {
  const votoMaximoPorTf = 4; // cuatro senales de -1 a +1
  let ponderado = 0;
  let maximo = 0;

  for (const a of analisis) {
    ponderado += a.voto * a.peso;
    maximo += votoMaximoPorTf * a.peso;
  }

  const normalizado = maximo === 0 ? 0 : ponderado / maximo; // -1 .. +1

  const sesgo =
    normalizado >= 0.5 ? 'alcista'
    : normalizado >= 0.15 ? 'moderadamente alcista'
    : normalizado > -0.15 ? 'sin sesgo definido'
    : normalizado > -0.5 ? 'moderadamente bajista'
    : 'bajista';

  // Acuerdo entre temporalidades, senal a senal.
  const conflictos = [];
  const confluencias = [];
  const nombres = analisis[0]?.senales.map((s) => s.nombre) ?? [];

  for (const nombre of nombres) {
    const votos = analisis.map((a) => ({
      tf: a.temporalidad,
      voto: a.senales.find((s) => s.nombre === nombre).voto,
      lectura: a.senales.find((s) => s.nombre === nombre).lectura,
    }));
    const positivos = votos.filter((v) => v.voto > 0);
    const negativos = votos.filter((v) => v.voto < 0);

    if (positivos.length && negativos.length) {
      conflictos.push({
        senal: nombre,
        alcistaEn: positivos.map((v) => v.tf),
        bajistaEn: negativos.map((v) => v.tf),
        detalle: votos.map((v) => v.tf + ': ' + v.lectura).join('  |  '),
      });
    } else if (positivos.length === analisis.length || negativos.length === analisis.length) {
      confluencias.push({
        senal: nombre,
        direccion: positivos.length ? 'alcista' : 'bajista',
        detalle: votos.map((v) => v.tf + ': ' + v.lectura).join('  |  '),
      });
    }
  }

  /**
   * EVIDENCIA EN CONTRA. La parte que casi ningun sistema muestra y la que
   * mas falta hace para decidir. Recoge todo lo que debilita la lectura
   * dominante, para que quien lee no tenga que buscarlo por su cuenta.
   */
  const enContra = [];

  for (const a of analisis) {
    const dir = normalizado > 0 ? 1 : normalizado < 0 ? -1 : 0;
    if (dir !== 0) {
      for (const s of a.senales) {
        if (s.voto !== 0 && Math.sign(s.voto) !== dir) {
          enContra.push('[' + a.temporalidad + '] ' + s.nombre + ': ' + s.lectura + '. ' + s.porque);
        }
      }
    }
  }

  for (const a of analisis) {
    const r = a.indicadores.rsi14;
    if (normalizado > 0 && r !== null && r >= 70) {
      enContra.push('[' + a.temporalidad + '] RSI en ' + r.toFixed(0)
        + ': el movimiento ya esta extendido, el recorrido restante puede ser menor.');
    }
    if (normalizado < 0 && r !== null && r <= 30) {
      enContra.push('[' + a.temporalidad + '] RSI en ' + r.toFixed(0)
        + ': la caida ya esta extendida, el recorrido restante puede ser menor.');
    }
    if (a.rango.posicion >= 0.9 && normalizado > 0) {
      enContra.push('[' + a.temporalidad + '] Precio al ' + (a.rango.posicion * 100).toFixed(0)
        + '% de su rango de 60 velas: entrar tarde en el recorrido.');
    }
    if (a.indicadores.volRel !== null && a.indicadores.volRel < 0.7) {
      enContra.push('[' + a.temporalidad + '] Volumen al ' + (a.indicadores.volRel * 100).toFixed(0)
        + '% de lo normal: el movimiento tiene poca participacion detras.');
    }
  }

  return {
    sesgo,
    puntuacion: Number(normalizado.toFixed(3)),
    votoPonderado: ponderado,
    votoMaximo: maximo,
    acuerdo: Number((Math.abs(normalizado) * 100).toFixed(0)),
    confluencias,
    conflictos,
    enContra,
  };
}

/**
 * Mapa del terreno: que hay encima y debajo del precio, en ATR.
 * Describe distancias, no sugiere entradas ni salidas.
 */
export function mapaDeNiveles(analisis, temporalidadReferencia = '1d') {
  const a = analisis.find((x) => x.temporalidad === temporalidadReferencia) ?? analisis[0];
  const res = a.niveles.resistenciaInmediata;
  const sop = a.niveles.soporteInmediato;

  return {
    temporalidad: a.temporalidad,
    precio: a.precio,
    atr: a.indicadores.atr14,
    resistenciaInmediata: res,
    soporteInmediato: sop,
    invalidacionEstructural: a.estructura.nivelDeInvalidacion,
    // Cuanto recorrido hay a cada lado hasta la primera zona relevante.
    // Es una descripcion geometrica del grafico, no una relacion de riesgo
    // y beneficio de ninguna operacion concreta.
    recorridoArribaATR: res ? res.distanciaATR : null,
    recorridoAbajoATR: sop ? sop.distanciaATR : null,
    simetria: res && sop
      ? Number((res.distanciaATR / sop.distanciaATR).toFixed(2))
      : null,
  };
}
