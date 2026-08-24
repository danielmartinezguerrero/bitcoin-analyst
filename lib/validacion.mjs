/**
 * MODULO 6 - Validacion estadistica al estilo Osler (2000).
 *
 * LA PREGUNTA: nuestros niveles de soporte y resistencia, funcionan mejor
 * que lineas horizontales puestas al azar?
 *
 * Es la pregunta correcta y casi nadie se la hace. El precio sube y baja
 * constantemente; cerca de CUALQUIER linea habra momentos en que se acerco,
 * giro y se alejo. Encontrar rebotes en tus niveles no demuestra nada. Lo
 * que hay que demostrar es que rebota MAS que en niveles arbitrarios.
 *
 * EL METODO (Osler, Fed de Nueva York, 2000):
 *   1. medir la tasa de rebote en los niveles reales
 *   2. generar miles de conjuntos de niveles falsos en el mismo rango
 *   3. medir la misma tasa en cada conjunto falso
 *   4. ver en que parte de esa distribucion cae el resultado real
 *
 * WALK-FORWARD, O EL TEST NO VALE NADA:
 * los niveles de cada ventana se construyen SOLO con velas anteriores a la
 * ventana de prueba. Construirlos con toda la serie y luego preguntar si el
 * precio reboto en ellos da que si por definicion: los niveles se dibujan
 * justo donde el precio ya reboto. Seria predecir el partido de ayer.
 */
import { atr, ultimo } from './indicadores.mjs';
import { pivotes, nivelesClave } from './estructura.mjs';

const POR_DEFECTO = {
  ventanaConstruccion: 200,  // velas para construir los niveles
  ventanaPrueba: 30,         // velas en las que se mide que paso
  velasSeguimiento: 10,      // cuanto se mira hacia delante tras un contacto
  toleranciaToque: 0.25,     // banda alrededor del nivel, en ATR
  umbralRebote: 1.0,         // alejarse esto (en ATR) cuenta como rebote
  umbralRuptura: 0.5,        // cerrar al otro lado esto (en ATR) es ruptura
  maxNiveles: 6,
  repeticiones: 2000,
};

/**
 * Que hizo el precio tras tocar un nivel.
 *
 *   ruptura  el precio CIERRA al otro lado del nivel, pasado el umbral.
 *            Se usa el cierre, no la mecha: una mecha que perfora y vuelve
 *            no es una ruptura, es exactamente lo contrario.
 *   rebote   el precio se ALEJA del nivel en la direccion esperada, medido
 *            con la mecha, que es donde llega realmente el movimiento.
 *
 * Se comprueba la ruptura antes que el rebote dentro de cada vela: es el
 * criterio conservador, penaliza a nuestros niveles en los casos ambiguos.
 */
export function evaluarContacto(velas, iContacto, nivel, tipo, atrRef, opc) {
  const esSoporte = tipo === 'soporte';
  const hasta = Math.min(iContacto + opc.velasSeguimiento, velas.length);

  for (let k = iContacto; k < hasta; k++) {
    const v = velas[k];

    if (esSoporte) {
      if (v.c < nivel - atrRef * opc.umbralRuptura) return 'ruptura';
      if (v.h > nivel + atrRef * opc.umbralRebote) return 'rebote';
    } else {
      if (v.c > nivel + atrRef * opc.umbralRuptura) return 'ruptura';
      if (v.l < nivel - atrRef * opc.umbralRebote) return 'rebote';
    }
  }
  // Ni una cosa ni otra dentro del plazo: no aporta informacion y se descarta.
  return 'indefinido';
}

/**
 * Mide la tasa de rebote de un conjunto de niveles sobre una ventana de prueba.
 * Cada nivel se contabiliza UNA sola vez por ventana: si no, un nivel rondado
 * durante diez velas cuenta diez veces y domina la estadistica entera.
 */
export function medirVentana(velasPrueba, niveles, atrRef, opc) {
  let rebotes = 0, rupturas = 0, indefinidos = 0;
  const resueltos = new Set();

  for (let i = 0; i < velasPrueba.length; i++) {
    const v = velasPrueba[i];

    for (let n = 0; n < niveles.length; n++) {
      if (resueltos.has(n)) continue;
      const { precio, tipo } = niveles[n];
      const banda = atrRef * opc.toleranciaToque;

      // Contacto: la vela entra en la banda alrededor del nivel.
      if (v.l <= precio + banda && v.h >= precio - banda) {
        const r = evaluarContacto(velasPrueba, i, precio, tipo, atrRef, opc);
        resueltos.add(n);
        if (r === 'rebote') rebotes++;
        else if (r === 'ruptura') rupturas++;
        else indefinidos++;
      }
    }
  }

  return { rebotes, rupturas, indefinidos };
}

/**
 * METRICA 2 — DESPLAZAMIENTO SIMETRICO.
 *
 * Por que hizo falta una segunda: en la metrica 1 las lineas ALEATORIAS
 * conseguian un 72,9% de "rebote". Si cualquier linea arbitraria acierta tres
 * de cada cuatro veces, la medida esta saturada y no puede distinguir un buen
 * nivel de uno inventado. La causa era una asimetria de diseno: el rebote se
 * detectaba con la MECHA a 1 ATR (facil) y la ruptura con el CIERRE a 0,5 ATR
 * (exige confirmacion). Eso media "el precio se movio", no "el nivel lo paro".
 *
 * Esta metrica arregla las dos cosas:
 *   - SIMETRICA: el mismo criterio a los dos lados (cierre contra cierre).
 *   - CONTINUA: mide CUANTO se alejo, no solo si se alejo. Una variable
 *     continua tiene mucha mas potencia estadistica que un si/no, porque
 *     conserva la magnitud en lugar de tirarla.
 *
 * Devuelve el desplazamiento en ATR en la direccion que el nivel deberia
 * defender: positivo si se respeto, negativo si se atraveso.
 */
export function medirDesplazamiento(velas, iContacto, nivel, tipo, atrRef, opc) {
  const iFinal = Math.min(iContacto + opc.velasSeguimiento, velas.length - 1);
  const cierreFinal = velas[iFinal].c;

  return tipo === 'soporte'
    ? (cierreFinal - nivel) / atrRef   // un soporte deberia dejar el precio ENCIMA
    : (nivel - cierreFinal) / atrRef;  // una resistencia, DEBAJO
}

/** Version de medirVentana para la metrica continua. */
export function medirVentanaDesplazamiento(velasPrueba, niveles, atrRef, opc) {
  const desplazamientos = [];
  const resueltos = new Set();

  for (let i = 0; i < velasPrueba.length; i++) {
    const v = velasPrueba[i];
    for (let n = 0; n < niveles.length; n++) {
      if (resueltos.has(n)) continue;
      const { precio, tipo } = niveles[n];
      const banda = atrRef * opc.toleranciaToque;
      if (v.l <= precio + banda && v.h >= precio - banda) {
        resueltos.add(n);
        desplazamientos.push(medirDesplazamiento(velasPrueba, i, precio, tipo, atrRef, opc));
      }
    }
  }
  return desplazamientos;
}

/**
 * Niveles aleatorios de control. Deben parecerse a los reales en TODO menos
 * en como se eligio el precio: misma cantidad, mismo rango, y el tipo
 * (soporte/resistencia) asignado por su posicion respecto al precio, igual
 * que en los reales. Si los falsos fueran menos o estuvieran en otro rango,
 * la comparacion mediria esa diferencia y no la calidad de los niveles.
 */
export function nivelesAleatorios(cantidad, minimo, maximo, precioActual, rng = Math.random) {
  const out = [];
  for (let i = 0; i < cantidad; i++) {
    const precio = minimo + rng() * (maximo - minimo);
    out.push({ precio, tipo: precio < precioActual ? 'soporte' : 'resistencia' });
  }
  return out;
}

/** Generador pseudoaleatorio con semilla: el test debe ser reproducible. */
export function rngConSemilla(semilla) {
  let s = semilla >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Recorre la serie en modo walk-forward y devuelve, por ventana, los niveles
 * reales construidos con datos pasados y todo lo necesario para evaluarlos.
 * Se calcula una sola vez y se reutiliza para las miles de repeticiones.
 */
export function prepararVentanas(velas, opc) {
  const ventanas = [];

  for (let t = opc.ventanaConstruccion; t + opc.ventanaPrueba <= velas.length; t += opc.ventanaPrueba) {
    const construccion = velas.slice(t - opc.ventanaConstruccion, t);
    const prueba = velas.slice(t, t + opc.ventanaPrueba);

    const atrRef = ultimo(atr(construccion, 14));
    if (!atrRef) continue;

    const precioEnT = construccion[construccion.length - 1].c;
    const p = pivotes(construccion, 5, 5);
    const reales = nivelesClave(construccion, p, atrRef, {
      toleranciaATR: 0.5,
      maxNiveles: opc.maxNiveles,
      semivida: 50,
    }).map((n) => ({ precio: n.precio, tipo: n.tipo }));

    if (!reales.length) continue;

    ventanas.push({
      indice: t,
      fecha: prueba[0].fecha,
      prueba,
      atrRef,
      precioEnT,
      reales,
      // Rango de la ventana de construccion: es donde se sortean los falsos.
      minimo: Math.min(...construccion.map((v) => v.l)),
      maximo: Math.max(...construccion.map((v) => v.h)),
    });
  }

  return ventanas;
}

/**
 * Agrega la metrica continua sobre todas las ventanas.
 * El estadistico principal es el desplazamiento MEDIO en ATR; se informa
 * tambien la fraccion de contactos respetados, que es el equivalente
 * simetrico y honesto de la "tasa de rebote" de la metrica 1.
 */
function agregarDesplazamiento(ventanas, obtenerNiveles, opc) {
  const todos = [];
  for (const w of ventanas) {
    todos.push(...medirVentanaDesplazamiento(w.prueba, obtenerNiveles(w), w.atrRef, opc));
  }
  if (!todos.length) return { media: 0, contactos: 0, fraccionRespetados: 0 };

  const media = todos.reduce((s, x) => s + x, 0) / todos.length;
  return {
    media,
    contactos: todos.length,
    fraccionRespetados: todos.filter((x) => x > 0).length / todos.length,
  };
}

/** Suma los resultados de todas las ventanas y calcula la tasa de rebote. */
function agregar(ventanas, obtenerNiveles, opc) {
  let rebotes = 0, rupturas = 0, indefinidos = 0;

  for (const w of ventanas) {
    const r = medirVentana(w.prueba, obtenerNiveles(w), w.atrRef, opc);
    rebotes += r.rebotes;
    rupturas += r.rupturas;
    indefinidos += r.indefinidos;
  }

  const resueltos = rebotes + rupturas;
  return {
    rebotes, rupturas, indefinidos,
    contactos: resueltos + indefinidos,
    tasaRebote: resueltos > 0 ? rebotes / resueltos : 0,
  };
}

/**
 * El test completo.
 * Devuelve la tasa real, la distribucion del azar y el p-valor.
 */
export function testOsler(velas, opciones = {}) {
  const opc = { ...POR_DEFECTO, ...opciones };
  const ventanas = prepararVentanas(velas, opc);

  if (!ventanas.length) {
    throw new Error('No hay ventanas suficientes: serie demasiado corta para el test.');
  }

  if (opc.metrica === 'desplazamiento') return testDesplazamiento(ventanas, opc, opciones);

  const real = agregar(ventanas, (w) => w.reales, opc);

  const rng = rngConSemilla(opciones.semilla ?? 12345);
  const tasasAzar = [];

  for (let rep = 0; rep < opc.repeticiones; rep++) {
    const r = agregar(
      ventanas,
      (w) => nivelesAleatorios(w.reales.length, w.minimo, w.maximo, w.precioEnT, rng),
      opc
    );
    tasasAzar.push(r.tasaRebote);
  }

  /**
   * p-valor de Monte Carlo, con la correccion (+1) habitual: evita informar
   * p = 0, que seria afirmar imposibilidad a partir de una muestra finita.
   */
  const alMenosIgual = tasasAzar.filter((t) => t >= real.tasaRebote).length;
  const p = (alMenosIgual + 1) / (opc.repeticiones + 1);

  const ordenadas = [...tasasAzar].sort((a, b) => a - b);
  const percentil = (q) => ordenadas[Math.min(ordenadas.length - 1, Math.floor(q * ordenadas.length))];
  const media = tasasAzar.reduce((s, x) => s + x, 0) / tasasAzar.length;
  const desviacion = Math.sqrt(
    tasasAzar.reduce((s, x) => s + (x - media) ** 2, 0) / tasasAzar.length
  );

  return {
    parametros: opc,
    ventanas: ventanas.length,
    periodo: { desde: ventanas[0].fecha, hasta: ventanas[ventanas.length - 1].fecha },
    real,
    azar: {
      repeticiones: opc.repeticiones,
      media,
      desviacion,
      p05: percentil(0.05),
      p50: percentil(0.5),
      p95: percentil(0.95),
      p99: percentil(0.99),
      maximo: ordenadas[ordenadas.length - 1],
    },
    pValor: p,
    // Cuantas desviaciones tipicas separan lo real de la media del azar.
    zScore: desviacion > 0 ? (real.tasaRebote - media) / desviacion : 0,
    significativo: p < 0.05,
  };
}

/**
 * INTENTO 2 — test con la metrica de desplazamiento continuo.
 *
 * Mismo andamiaje que el intento 1 (walk-forward, control aleatorio,
 * Monte Carlo); solo cambia lo que se mide en cada contacto.
 *
 * REGISTRO DE INTENTOS: este es el segundo estadistico que se prueba sobre
 * los mismos datos. Se anota a proposito. Probar medidas hasta que una salga
 * significativa es p-hacking: con veinte intentos, una da p < 0,05 por puro
 * azar. A partir del tercero habria que corregir por comparaciones multiples
 * (Bonferroni: exigir p < 0,05/n) o reservar datos que no se hayan tocado.
 */
function testDesplazamiento(ventanas, opc, opciones) {
  const real = agregarDesplazamiento(ventanas, (w) => w.reales, opc);

  const rng = rngConSemilla(opciones.semilla ?? 12345);
  const medias = [];

  for (let rep = 0; rep < opc.repeticiones; rep++) {
    const r = agregarDesplazamiento(
      ventanas,
      (w) => nivelesAleatorios(w.reales.length, w.minimo, w.maximo, w.precioEnT, rng),
      opc
    );
    medias.push(r.media);
  }

  const alMenosIgual = medias.filter((m) => m >= real.media).length;
  const p = (alMenosIgual + 1) / (opc.repeticiones + 1);

  const ordenadas = [...medias].sort((a, b) => a - b);
  const percentil = (q) => ordenadas[Math.min(ordenadas.length - 1, Math.floor(q * ordenadas.length))];
  const media = medias.reduce((s, x) => s + x, 0) / medias.length;
  const desviacion = Math.sqrt(medias.reduce((s, x) => s + (x - media) ** 2, 0) / medias.length);

  return {
    metrica: 'desplazamiento',
    intento: 2,
    parametros: opc,
    ventanas: ventanas.length,
    periodo: { desde: ventanas[0].fecha, hasta: ventanas[ventanas.length - 1].fecha },
    real,
    azar: {
      repeticiones: opc.repeticiones,
      media, desviacion,
      p05: percentil(0.05), p50: percentil(0.5),
      p95: percentil(0.95), p99: percentil(0.99),
      maximo: ordenadas[ordenadas.length - 1],
    },
    pValor: p,
    zScore: desviacion > 0 ? (real.media - media) / desviacion : 0,
    significativo: p < 0.05,
  };
}
